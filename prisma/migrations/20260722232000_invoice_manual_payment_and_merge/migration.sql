-- Manually-recorded payments (bank transfer / cash) and combining several
-- invoices into one. Hand-written; @@map snake_case table name.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "paymentMethod" TEXT,
ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "mergedIntoId" TEXT;

-- CreateIndex: looking up "what was merged into this invoice" should not scan.
CREATE INDEX "invoices_mergedIntoId_idx" ON "invoices"("mergedIntoId");
