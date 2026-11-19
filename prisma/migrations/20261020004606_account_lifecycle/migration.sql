-- Ciclo de vida de la cuenta: desactivación (reversible), solicitud de
-- eliminación con 15 días de gracia y anonimización definitiva.
-- Agregar varios valores a un enum en una migración requiere PostgreSQL 12+.

-- CreateEnum
CREATE TYPE "InactivationSource" AS ENUM ('SELF', 'ADMIN');

-- AlterEnum
ALTER TYPE "AuthLogEvent" ADD VALUE 'ACCOUNT_DEACTIVATED';
ALTER TYPE "AuthLogEvent" ADD VALUE 'ACCOUNT_REACTIVATED';
ALTER TYPE "AuthLogEvent" ADD VALUE 'ACCOUNT_DELETION_REQUESTED';
ALTER TYPE "AuthLogEvent" ADD VALUE 'ACCOUNT_DELETION_CANCELLED';
ALTER TYPE "AuthLogEvent" ADD VALUE 'ACCOUNT_ANONYMIZED';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "deletionRequestedAt" TIMESTAMP(3),
ADD COLUMN     "deletionScheduledAt" TIMESTAMP(3),
ADD COLUMN     "inactivatedBy" "InactivationSource";

-- Las cuentas que ya estaban inactivas las desactivó un administrador (antes
-- solo existía PATCH /users/:id/inactivate): se marcan así para que no puedan
-- reactivarse solas.
UPDATE "User" SET "inactivatedBy" = 'ADMIN' WHERE "inactivatedAt" IS NOT NULL;

-- AlterTable
ALTER TABLE "UserConsent" ADD COLUMN     "revokedAt" TIMESTAMP(3);
