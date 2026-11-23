import { applyDecorators, ExecutionContext, Injectable } from '@nestjs/common';
import {
  Throttle,
  ThrottlerException,
  ThrottlerGuard,
} from '@nestjs/throttler';

/** Intentos con contraseña por usuario, sumando todas las rutas que la piden. */
export const PASSWORD_CONFIRM_LIMIT = 5;
/** Ventana de esos intentos: 15 minutos. */
export const PASSWORD_CONFIRM_TTL_MS = 15 * 60 * 1000;

/**
 * Limita las confirmaciones con contraseña de alguien que ya inició sesión:
 * cambiar la contraseña, desactivar o eliminar la cuenta y transferir un
 * negocio.
 *
 * La contraseña está ahí para que quien tenga la sesión abierta (un teléfono
 * prestado o desbloqueado) no pueda hacer eso solo. Sin límite podría probar
 * contraseñas hasta acertar.
 *
 * El contador es por usuario y compartido entre las cuatro rutas: no se
 * esquiva repartiendo los intentos. Cuenta cada intento, acierte o no: son
 * acciones que se hacen muy rara vez. Va después de `JwtAuthGuard`, que pone
 * `req.user`.
 */
@Injectable()
export class PasswordConfirmThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const userId = (req.user as { id?: string } | undefined)?.id;
    return Promise.resolve(userId ?? `ip:${req.ip as string}`);
  }

  // Sin el nombre de la ruta en la clave: así el contador es uno solo.
  protected generateKey(
    _context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    return `password-confirm:${name}:${suffix}`;
  }

  protected throwThrottlingException(): Promise<void> {
    throw new ThrottlerException(
      'Demasiados intentos con tu contraseña. Espera 15 minutos e intenta de nuevo.',
    );
  }
}

/** El límite que aplica `PasswordConfirmThrottlerGuard`. */
export const PasswordConfirmLimit = () =>
  applyDecorators(
    Throttle({
      default: { limit: PASSWORD_CONFIRM_LIMIT, ttl: PASSWORD_CONFIRM_TTL_MS },
    }),
  );
