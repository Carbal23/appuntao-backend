-- Transferencia de la propiedad de un negocio: el dueño la propone y el
-- miembro que la recibe la acepta o la rechaza. Vence a los 7 días.

-- CreateEnum
CREATE TYPE "OwnershipTransferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "BusinessOwnershipTransfer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" "OwnershipTransferStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessOwnershipTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BusinessOwnershipTransfer_businessId_status_idx" ON "BusinessOwnershipTransfer"("businessId", "status");

-- CreateIndex
CREATE INDEX "BusinessOwnershipTransfer_toUserId_status_idx" ON "BusinessOwnershipTransfer"("toUserId", "status");

-- AddForeignKey
ALTER TABLE "BusinessOwnershipTransfer" ADD CONSTRAINT "BusinessOwnershipTransfer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOwnershipTransfer" ADD CONSTRAINT "BusinessOwnershipTransfer_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessOwnershipTransfer" ADD CONSTRAINT "BusinessOwnershipTransfer_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

