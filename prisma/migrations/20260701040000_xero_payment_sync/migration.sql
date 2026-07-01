-- Phase 4 of the Xero integration: track the Xero Payment applied against a
-- Payment's invoice. Presence == reconciled in Xero, so webhook re-delivery is
-- a no-op.

-- AlterTable
ALTER TABLE "payments" ADD COLUMN "xeroPaymentId" TEXT;
