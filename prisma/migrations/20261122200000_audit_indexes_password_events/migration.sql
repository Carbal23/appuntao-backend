-- Eventos de seguridad: contraseña equivocada al confirmar una acción
-- (desactivar, eliminar la cuenta, transferir un negocio) y bloqueo por el
-- límite de intentos.
ALTER TYPE "AuthLogEvent" ADD VALUE 'PASSWORD_CONFIRM_FAILED';
ALTER TYPE "AuthLogEvent" ADD VALUE 'PASSWORD_CONFIRM_BLOCKED';

-- La purga de un negocio borra su auditoría por entityId; el historial de un
-- usuario se consulta por userId y fecha.
CREATE INDEX "AuditLog_entityId_idx" ON "AuditLog"("entityId");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
