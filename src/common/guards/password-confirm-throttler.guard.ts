import { applyDecorators, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  Throttle,
  ThrottlerException,
  ThrottlerGuard,
  ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthLogEvent } from '@prisma/client';
import { AuthLogService } from 'src/auth-log/auth-log.service';
import { AuthLogReason } from 'src/auth-log/auth-log.types';
import { requestContextFrom } from 'src/common/decorators/request-context.decorator';

/** Intentos con contraseña por usuario, sumando todas las rutas que la piden. */
export const PASSWORD_CONFIRM_LIMIT = 5;
/** Ventana de esos intentos: 15 minutos. */
export const PASSWORD_CONFIRM_TTL_MS = 15 * 60 * 1000;

/** Qué se estaba confirmando, según el método del controller. */
const REASON_BY_HANDLER: Record<string, AuthLogReason> = {
  changePassword: AuthLogReason.CHANGE_PASSWORD,
  deactivateMe: AuthLogReason.DEACTIVATE_ACCOUNT,
  requestDeletion: AuthLogReason.DELETE_ACCOUNT,
  request: AuthLogReason.TRANSFER_BUSINESS,
};

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
 * `req.user`. El bloqueo queda en AuthLog (`PASSWORD_CONFIRM_BLOCKED`) una
 * vez por bloqueo, no en cada intento rechazado.
 */
@Injectable()
export class PasswordConfirmThrottlerGuard extends ThrottlerGuard {
  private readonly loggedBlocks = new Map<string, number>();

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly authLog: AuthLogService,
  ) {
    super(options, storageService, reflector);
  }

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

  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const now = Date.now();
    for (const [key, blockEndsAt] of this.loggedBlocks) {
      if (blockEndsAt <= now) this.loggedBlocks.delete(key);
    }

    if (!this.loggedBlocks.has(detail.key)) {
      this.loggedBlocks.set(detail.key, now + detail.timeToBlockExpire * 1000);
      const request = context
        .switchToHttp()
        .getRequest<Request & { user?: { id?: string } }>();
      await this.authLog.record({
        event: AuthLogEvent.PASSWORD_CONFIRM_BLOCKED,
        userId: request.user?.id ?? null,
        reason: REASON_BY_HANDLER[context.getHandler().name],
        context: requestContextFrom(request),
      });
    }

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
