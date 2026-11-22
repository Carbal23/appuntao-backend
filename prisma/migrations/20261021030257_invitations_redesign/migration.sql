-- Invitaciones dirigidas a una persona: quién la creó, quién la aceptó,
-- cuándo se respondió, estados de rechazo y cancelación, e índices para
-- encontrar las invitaciones de un correo o teléfono.
-- Requiere PostgreSQL 12+ (varios valores nuevos en un enum).

-- AlterEnum
ALTER TYPE "InvitationStatus" ADD VALUE 'REJECTED';
ALTER TYPE "InvitationStatus" ADD VALUE 'CANCELLED';
-- AlterTable
ALTER TABLE "Invitation" ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "respondedAt" TIMESTAMP(3);
-- CreateIndex
CREATE INDEX "Invitation_businessId_status_idx" ON "Invitation"("businessId", "status");
-- CreateIndex
CREATE INDEX "Invitation_email_status_idx" ON "Invitation"("email", "status");
-- CreateIndex
CREATE INDEX "Invitation_phone_status_idx" ON "Invitation"("phone", "status");
-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
