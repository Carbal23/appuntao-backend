import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthLogEvent, EmailVerification, User } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { AuthLogReason, RequestContext } from 'src/auth-log/auth-log.types';
import { EmailProvider } from 'src/providers/email.provider';
import {
  CodeHasher,
  createCodeHasher,
  generateCode,
} from 'src/auth/one-time-code';
import { VerifyEmailDto } from './dto/email-verification.dto';

/** Minutos que vale un código. */
export const VERIFY_CODE_TTL_MINUTES = 15;
/** Intentos fallidos que admite un código antes de anularse. */
export const VERIFY_CODE_MAX_ATTEMPTS = 5;
/** Espera mínima entre dos códigos de la misma cuenta. */
export const VERIFY_CODE_RESEND_SECONDS = 60;
/** Códigos que se pueden pedir por cuenta en 24 horas. */
export const VERIFY_CODE_DAILY_LIMIT = 5;

const SEND_MESSAGE =
  'Si el correo es de una cuenta sin verificar, te enviamos un código para confirmarlo.';

const INVALID_CODE_MESSAGE =
  'El código no es válido o ya venció. Revísalo o pide uno nuevo.';

/** Lo mínimo del usuario para saber si le falta verificar el correo. */
type VerifiableUser = Pick<User, 'email' | 'emailVerifiedAt'>;

/**
 * Verificar el correo con un código de 6 dígitos. Ver
 * docs/modulos/email-verification.md.
 *
 * Exigirlo depende de `account.requireEmailVerification`: en production
 * siempre, en local y QA según `REQUIRE_EMAIL_VERIFICATION`. Sin exigirlo, el
 * flujo funciona igual, pero nadie queda bloqueado por no hacerlo.
 *
 * Como en recuperar la contraseña, nada de lo que responde revela si un
 * correo tiene cuenta: pedir el código responde siempre lo mismo y los
 * errores del código son siempre el mismo.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  private readonly codes: CodeHasher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authLog: AuthLogService,
    private readonly emailProvider: EmailProvider,
    private readonly config: ConfigService,
  ) {
    this.codes = createCodeHasher(
      config.getOrThrow<string>('jwt.secret'),
      'email-verification-code',
    );
  }

  /** Si este entorno exige el correo verificado para entrar. */
  get required(): boolean {
    return (
      this.config.get<boolean>('account.requireEmailVerification') === true
    );
  }

  /** Si al usuario le falta verificar el correo y este entorno lo exige. */
  isPending(user: VerifiableUser): boolean {
    return this.required && !!user.email && !user.emailVerifiedAt;
  }

  /**
   * Pide un código. Responde de inmediato y hace el trabajo después: si
   * esperara a la base y a Resend, la respuesta tardaría más cuando la cuenta
   * existe y eso delataría qué correos están registrados.
   */
  sendCode(email: string, context?: RequestContext): { message: string } {
    this.issueCode(email, context).catch((error: unknown) =>
      this.logger.error(
        'No se pudo generar el código para verificar el correo',
        error instanceof Error ? error.stack : String(error),
      ),
    );
    return { message: SEND_MESSAGE };
  }

  async verify(
    dto: VerifyEmailDto,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    const { user, verification } = await this.checkCode(dto, context);
    const now = new Date();

    const verified = await this.prisma.$transaction(async (tx) => {
      // Solo una petición puede usar el código, aunque lleguen dos a la vez.
      const { count } = await tx.emailVerification.updateMany({
        where: { id: verification.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) return false;

      // Con la condición del correo: si un administrador lo cambió mientras
      // tanto, el código del correo viejo no verifica el nuevo.
      const updated = await tx.user.updateMany({
        where: { id: user.id, email: verification.email },
        data: { emailVerifiedAt: now },
      });
      return updated.count > 0;
    });

    if (!verified) throw new BadRequestException(INVALID_CODE_MESSAGE);

    await this.authLog.record({
      event: AuthLogEvent.EMAIL_VERIFIED,
      userId: user.id,
      identifier: dto.email,
      context,
    });

    return { message: 'Tu correo quedó verificado. Ya puedes iniciar sesión.' };
  }

  private async issueCode(email: string, context?: RequestContext) {
    const user = await this.findUser(email);
    if (!user || user.emailVerifiedAt) return;

    const now = new Date();
    const recent = await this.prisma.emailVerification.findMany({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const lastSentAgo = recent[0]
      ? now.getTime() - recent[0].createdAt.getTime()
      : Infinity;
    if (lastSentAgo < VERIFY_CODE_RESEND_SECONDS * 1000) return;

    if (recent.length >= VERIFY_CODE_DAILY_LIMIT) {
      await this.authLog.record({
        event: AuthLogEvent.EMAIL_VERIFICATION_BLOCKED,
        userId: user.id,
        identifier: email,
        reason: AuthLogReason.DAILY_LIMIT,
        context,
      });
      return;
    }

    const code = generateCode();

    // El código nuevo anula los anteriores: solo sirve el último que llegó.
    await this.prisma.$transaction([
      this.prisma.emailVerification.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.emailVerification.create({
        data: {
          userId: user.id,
          email,
          codeHash: this.codes.hash(code),
          expiresAt: new Date(now.getTime() + VERIFY_CODE_TTL_MINUTES * 60_000),
          ipAddress: context?.ipAddress,
        },
      }),
    ]);

    await this.authLog.record({
      event: AuthLogEvent.EMAIL_VERIFICATION_REQUESTED,
      userId: user.id,
      identifier: email,
      context,
    });

    try {
      const result = await this.emailProvider.sendEmailVerificationCode(
        email,
        code,
        VERIFY_CODE_TTL_MINUTES,
      );
      if (result.error) {
        this.logger.error(
          `No se pudo enviar el código para verificar el correo: ${result.error.message}`,
        );
      }
    } catch (error) {
      this.logger.error(
        'No se pudo enviar el código para verificar el correo',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Comprueba el código. Cada intento se descuenta antes de comparar, para
   * que varias peticiones a la vez no se pasen del límite; si acierta, se le
   * devuelve el intento.
   */
  private async checkCode(
    dto: VerifyEmailDto,
    context?: RequestContext,
  ): Promise<{ user: User; verification: EmailVerification }> {
    const user = await this.findUser(dto.email);
    const verification =
      user && !user.emailVerifiedAt
        ? await this.prisma.emailVerification.findFirst({
            where: {
              userId: user.id,
              email: dto.email,
              usedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    if (!user || !verification) {
      await this.recordFailure(
        user?.id ?? null,
        dto.email,
        AuthLogReason.NO_ACTIVE_CODE,
        context,
      );
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    const { count } = await this.prisma.emailVerification.updateMany({
      where: {
        id: verification.id,
        attempts: { lt: VERIFY_CODE_MAX_ATTEMPTS },
      },
      data: { attempts: { increment: 1 } },
    });
    if (count === 0) {
      await this.recordFailure(
        user.id,
        dto.email,
        AuthLogReason.TOO_MANY_ATTEMPTS,
        context,
      );
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    if (!this.codes.matches(dto.code, verification.codeHash)) {
      await this.recordFailure(
        user.id,
        dto.email,
        AuthLogReason.INVALID_CODE,
        context,
      );
      if (verification.attempts + 1 >= VERIFY_CODE_MAX_ATTEMPTS) {
        await this.authLog.record({
          event: AuthLogEvent.EMAIL_VERIFICATION_BLOCKED,
          userId: user.id,
          identifier: dto.email,
          reason: AuthLogReason.TOO_MANY_ATTEMPTS,
          context,
        });
      }
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    await this.prisma.emailVerification.update({
      where: { id: verification.id },
      data: { attempts: { decrement: 1 } },
    });

    return { user, verification };
  }

  private findUser(email: string) {
    return this.prisma.user.findFirst({
      where: { email, anonymizedAt: null },
    });
  }

  private recordFailure(
    userId: string | null,
    email: string,
    reason: AuthLogReason,
    context?: RequestContext,
  ) {
    return this.authLog.record({
      event: AuthLogEvent.EMAIL_VERIFICATION_FAILED,
      userId,
      identifier: email,
      reason,
      context,
    });
  }
}
