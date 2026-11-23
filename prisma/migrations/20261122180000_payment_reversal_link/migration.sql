-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "reversedPaymentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversedPaymentId_key" ON "Payment"("reversedPaymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversedPaymentId_fkey" FOREIGN KEY ("reversedPaymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
