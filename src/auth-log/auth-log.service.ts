import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthLogParams } from './auth-log.types';
import { normalizeLoginIdentifier } from 'src/common/validation/user-identifier';

/** Lo que se guarda cuando lo escrito podría ser otra cosa (una contraseña). */
export const UNRECOGNIZED_IDENTIFIER = '(otro)';

/**
 * Qué se guarda de lo que se escribió al entrar, normalizado como en el
 * límite de intentos ("300 123 4567" → "3001234567", correo en minúsculas).
 *
 * Si corresponde a una cuenta (`hasUser`), se guarda: es de esa persona. Si
 * no, solo se guarda si es un correo o solo dígitos (celular, cédula, NIT):
 * quien se equivoca de campo y escribe la contraseña donde va el correo no la
 * deja guardada en texto plano. Un documento de extranjería que no existe se
 * guarda como "(otro)", porque tiene la misma forma que una contraseña.
 */
export const safeIdentifier = (
  value: string | undefined,
  hasUser: boolean,
): string | undefined => {
  if (value === undefined || !value.trim()) return undefined;
  const normalized = normalizeLoginIdentifier(value);
  if (hasUser) return normalized;
  if (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) &&
    normalized.length <= 254
  ) {
    return normalized;
  }
  if (/^\d{6,15}$/.test(normalized)) return normalized;
  return UNRECOGNIZED_IDENTIFIER;
};

/**
 * Eventos de seguridad: logins, bloqueos, sesiones, contraseñas y estado de
 * la cuenta. Es de mejor esfuerzo: si no se puede escribir, se deja en el log
 * del servidor y la petición sigue. Se borran a los
 * `AUTH_LOG_RETENTION_MONTHS` (12 por defecto) en la tarea diaria.
 */
@Injectable()
export class AuthLogService {
  private readonly logger = new Logger(AuthLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(params: AuthLogParams): Promise<void> {
    const { event, userId, identifier, reason, deviceId, deviceName, context } =
      params;

    try {
      await this.prisma.authLog.create({
        data: {
          event,
          userId: userId ?? null,
          identifier: safeIdentifier(identifier, Boolean(userId)),
          reason,
          deviceId: deviceId ?? null,
          deviceName: deviceName ?? null,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar el evento ${event}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
