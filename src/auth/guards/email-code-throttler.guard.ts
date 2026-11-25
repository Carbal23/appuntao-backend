import { applyDecorators, ExecutionContext, Injectable } from '@nestjs/common';
import {
  Throttle,
  ThrottlerException,
  ThrottlerGuard,
} from '@nestjs/throttler';
import { normalizeEmail } from 'src/common/validation/contact.validators';

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

/**
 * Contador que usa cada ruta. Las que piden un código comparten uno; las que
 * lo prueban, otro. Recuperar la contraseña y verificar el correo no se
 * mezclan.
 */
const GROUP_BY_HANDLER: Record<string, string> = {
  forgotPassword: 'password-reset:request',
  verifyResetCode: 'password-reset:code',
  resetPassword: 'password-reset:code',
  sendCode: 'email-verification:request',
  verify: 'email-verification:code',
};

/**
 * Límite por IP + correo en las rutas de códigos al correo: recuperar la
 * contraseña y verificar el correo. Frena a quien pide códigos sin parar
 * (cada uno es un correo que se manda) o prueba códigos al azar. Lo que no se
 * esquiva cambiando de IP lo cuenta la base: 5 intentos por código y 5
 * códigos al día por cuenta.
 */
@Injectable()
export class EmailCodeThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const body = req.body as { email?: unknown } | undefined;
    const email = normalizeEmail(body?.email);
    const ip = req.ip as string | undefined;
    return Promise.resolve(
      `${ip ?? 'unknown'}:${typeof email === 'string' ? email : ''}`,
    );
  }

  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const handler = context.getHandler().name;
    const group = GROUP_BY_HANDLER[handler] ?? handler;
    return `email-code:${group}:${name}:${suffix}`;
  }

  protected throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(
      'Demasiados intentos. Espera 15 minutos e intenta de nuevo.',
    );
  }
}

/** 3 códigos cada 15 minutos por IP + correo. */
export const CodeRequestLimit = () =>
  applyDecorators(Throttle({ default: { limit: 3, ttl: FIFTEEN_MINUTES_MS } }));

/** 10 intentos con código cada 15 minutos por IP + correo. */
export const CodeAttemptLimit = () =>
  applyDecorators(
    Throttle({ default: { limit: 10, ttl: FIFTEEN_MINUTES_MS } }),
  );
