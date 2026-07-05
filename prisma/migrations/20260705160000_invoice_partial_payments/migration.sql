-- Inbound Xero → PupManager payment reconciliation. Track how much of each
-- invoice has been settled so we can reflect Xero's AmountPaid, including
-- partial payments (status "PARTIAL").

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "amountPaidCents" INTEGER NOT NULL DEFAULT 0;

-- Backfill: fully-paid invoices are paid in full; everything else starts at 0.
UPDATE "invoices" SET "amountPaidCents" = "amountCents" WHERE "status" = 'PAID';
