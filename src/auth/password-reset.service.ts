import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AuthLogEvent,
  InactivationSource,
  PasswordReset,
  User,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { AuthLogReason, RequestContext } from 'src/auth-log/auth-log.types';
import { EmailProvider } from 'src/providers/email.provider';
import { ResetPasswordDto, VerifyResetCodeDto } from './dto/password-reset.dto';
import { CodeHasher, createCodeHasher, generateCode } from './one-time-code';

/** Minutos que vale un código. */
export const RESET_CODE_TTL_MINUTES = 15;
/** Intentos fallidos que admite un código antes de anularse. */
export const RESET_CODE_MAX_ATTEMPTS = 5;
/** Espera mínima entre dos códigos de la misma cuenta. */
export const RESET_CODE_RESEND_SECONDS = 60;
/** Códigos que se pueden pedir por cuenta en 24 horas. */
export const RESET_CODE_DAILY_LIMIT = 5;

/** Lo que responde `forgot`, exista o no la cuenta. */
const FORGOT_MESSAGE =
  'Si el correo está registrado, te enviamos un código para cambiar tu contraseña.';

const INVALID_CODE_MESSAGE =
  'El código no es válido o ya venció. Revísalo o pide uno nuevo.';

/**
 * Recuperar la contraseña olvidada con un código de 6 dígitos que llega al
 * correo de la cuenta.
 *
 * Nada de lo que responde revela si un correo tiene cuenta: `forgot` responde
 * siempre lo mismo y los errores del código son siempre el mismo. El código
 * se guarda como HMAC (nunca en claro) y cada uno admite
 * `RESET_CODE_MAX_ATTEMPTS` intentos fallidos. Cambiar la contraseña cierra
 * todas las sesiones de la cuenta.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);
  private readonly codes: CodeHasher;

  constructor(
    private readonly prisma: PrismaService,
    private readonly authLog: AuthLogService,
    private readonly emailProvider: EmailProvider,
    config: ConfigService,
  ) {
    this.codes = createCodeHasher(
      config.getOrThrow<string>('jwt.secret'),
      'password-reset-code',
    );
  }

  /**
   * Responde de inmediato y hace el trabajo después: si esperara a la base y
   * a Resend, la respuesta tardaría más cuando la cuenta existe y eso
   * delataría qué correos están registrados.
   */
  forgot(email: string, context?: RequestContext): { message: string } {
    this.issueCode(email, context).catch((error: unknown) =>
      this.logger.error(
        'No se pudo generar el código para cambiar la contraseña',
        error instanceof Error ? error.stack : String(error),
      ),
    );
    return { message: FORGOT_MESSAGE };
  }

  private async issueCode(email: string, context?: RequestContext) {
    const user = await this.findUser(email);
    if (!user || !this.canReset(user)) return;

    const now = new Date();
    const recent = await this.prisma.passwordReset.findMany({
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
    if (lastSentAgo < RESET_CODE_RESEND_SECONDS * 1000) return;

    if (recent.length >= RESET_CODE_DAILY_LIMIT) {
      await this.authLog.record({
        event: AuthLogEvent.PASSWORD_RESET_BLOCKED,
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
      this.prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: now } },
        data: { expiresAt: now },
      }),
      this.prisma.passwordReset.create({
        data: {
          userId: user.id,
          codeHash: this.codes.hash(code),
          expiresAt: new Date(now.getTime() + RESET_CODE_TTL_MINUTES * 60_000),
          ipAddress: context?.ipAddress,
        },
      }),
    ]);

    await this.authLog.record({
      event: AuthLogEvent.PASSWORD_RESET_REQUESTED,
      userId: user.id,
      identifier: email,
      context,
    });

    await this.send(
      () =>
        this.emailProvider.sendPasswordResetCode(
          email,
          code,
          RESET_CODE_TTL_MINUTES,
        ),
      'el código para cambiar la contraseña',
    );
  }

  async verifyCode(
    dto: VerifyResetCodeDto,
    context?: RequestContext,
  ): Promise<{ valid: true }> {
    await this.checkCode(dto, context);
    return { valid: true };
  }

  async reset(
    dto: ResetPasswordDto,
    context?: RequestContext,
  ): Promise<{ message: string }> {
    const { user, reset } = await this.checkCode(dto, context);
    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    const now = new Date();

    const used = await this.prisma.$transaction(async (tx) => {
      // Solo una petición puede usar el código, aunque lleguen dos a la vez.
      const { count } = await tx.passwordReset.updateMany({
        where: { id: reset.id, usedAt: null },
        data: { usedAt: now },
      });
      if (count === 0) return false;

      await tx.user.update({
        where: { id: user.id },
        // El código llegó a este correo: también prueba que es suyo.
        data: {
          password: hashedPassword,
          emailVerifiedAt: user.emailVerifiedAt ?? now,
        },
      });
      await tx.refreshToken.deleteMany({ where: { userId: user.id } });
      return true;
    });

    if (!used) throw new BadRequestException(INVALID_CODE_MESSAGE);

    await this.authLog.record({
      event: AuthLogEvent.PASSWORD_RESET_COMPLETED,
      userId: user.id,
      identifier: dto.email,
      context,
    });

    void this.send(
      () => this.emailProvider.sendPasswordChangedNotice(dto.email),
      'el aviso de contraseña cambiada',
    );

    return {
      message:
        'Tu contraseña se cambió. Inicia sesión con la nueva contraseña.',
    };
  }

  /**
   * Comprueba el código y lo devuelve junto con la cuenta. Cada intento se
   * descuenta antes de comparar, para que varias peticiones a la vez no se
   * pasen del límite; si acierta, se le devuelve el intento.
   */
  private async checkCode(
    dto: VerifyResetCodeDto,
    context?: RequestContext,
  ): Promise<{ user: User; reset: PasswordReset }> {
    const user = await this.findUser(dto.email);
    const reset =
      user && this.canReset(user)
        ? await this.prisma.passwordReset.findFirst({
            where: {
              userId: user.id,
              usedAt: null,
              expiresAt: { gt: new Date() },
            },
            orderBy: { createdAt: 'desc' },
          })
        : null;

    if (!user || !reset) {
      await this.recordFailure(
        user?.id ?? null,
        dto.email,
        AuthLogReason.NO_ACTIVE_CODE,
        context,
      );
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    const { count } = await this.prisma.passwordReset.updateMany({
      where: { id: reset.id, attempts: { lt: RESET_CODE_MAX_ATTEMPTS } },
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

    if (!this.codes.matches(dto.code, reset.codeHash)) {
      const attempts = reset.attempts + 1;
      await this.recordFailure(
        user.id,
        dto.email,
        AuthLogReason.INVALID_CODE,
        context,
      );
      if (attempts >= RESET_CODE_MAX_ATTEMPTS) {
        await this.authLog.record({
          event: AuthLogEvent.PASSWORD_RESET_BLOCKED,
          userId: user.id,
          identifier: dto.email,
          reason: AuthLogReason.TOO_MANY_ATTEMPTS,
          context,
        });
      }
      throw new BadRequestException(INVALID_CODE_MESSAGE);
    }

    await this.prisma.passwordReset.update({
      where: { id: reset.id },
      data: { attempts: { decrement: 1 } },
    });

    return { user, reset };
  }

  private findUser(email: string) {
    return this.prisma.user.findFirst({
      where: { email, anonymizedAt: null },
    });
  }

  /**
   * Una cuenta desactivada por un administrador no se recupera por aquí: es
   * un bloqueo, y cambiar la contraseña no debe saltárselo. Si la desactivó
   * el propio usuario (o pidió eliminarla), sí: luego la reactiva desde el
   * login.
   */
  private canReset(user: User) {
    return (
      Boolean(user.email) &&
      !(user.inactivatedAt && user.inactivatedBy !== InactivationSource.SELF)
    );
  }

  private recordFailure(
    userId: string | null,
    email: string,
    reason: AuthLogReason,
    context?: RequestContext,
  ) {
    return this.authLog.record({
      event: AuthLogEvent.PASSWORD_RESET_FAILED,
      userId,
      identifier: email,
      reason,
      context,
    });
  }

  private async send(
    sendEmail: () => Promise<{ error: { message: string } | null }>,
    what: string,
  ) {
    try {
      const result = await sendEmail();
      if (result.error) {
        this.logger.error(`No se pudo enviar ${what}: ${result.error.message}`);
      }
    } catch (error) {
      this.logger.error(
        `No se pudo enviar ${what}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
