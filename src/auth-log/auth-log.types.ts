import { AuthLogEvent } from '@prisma/client';

/** Datos de la petición HTTP que acompañan a cada evento. */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthLogParams {
  event: AuthLogEvent;
  userId?: string | null;
  identifier?: string;
  reason?: string;
  deviceId?: string | null;
  deviceName?: string | null;
  context?: RequestContext;
}

/** Motivos de fallo que se guardan en `reason`. */
export enum AuthLogReason {
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  AMBIGUOUS_IDENTIFIER = 'AMBIGUOUS_IDENTIFIER',
  WRONG_CURRENT_PASSWORD = 'WRONG_CURRENT_PASSWORD',
  // Login con contraseña correcta pero cuenta no activa.
  ACCOUNT_DISABLED = 'ACCOUNT_DISABLED',
  ACCOUNT_DEACTIVATED = 'ACCOUNT_DEACTIVATED',
  ACCOUNT_DELETION_PENDING = 'ACCOUNT_DELETION_PENDING',
  // Detalle de eventos del ciclo de vida de la cuenta.
  BY_ADMIN = 'BY_ADMIN',
  BUSINESS_CLOSURE_ACKNOWLEDGED = 'BUSINESS_CLOSURE_ACKNOWLEDGED',
  DELETION_REQUESTED = 'DELETION_REQUESTED',
  INACTIVE_RETENTION_EXPIRED = 'INACTIVE_RETENTION_EXPIRED',
}
