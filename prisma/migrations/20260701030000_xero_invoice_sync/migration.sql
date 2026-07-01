-- Phase 3 of the Xero integration: track each Payment's invoice sync into the
-- trainer's Xero org.

-- CreateEnum
CREATE TYPE "XeroSyncStatus" AS ENUM ('NOT_SYNCED', 'SYNCED', 'ERROR');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "xeroInvoiceId" TEXT;
ALTER TABLE "payments" ADD COLUMN "xeroSyncStatus" "XeroSyncStatus" NOT NULL DEFAULT 'NOT_SYNCED';
ALTER TABLE "payments" ADD COLUMN "xeroSyncError" TEXT;
