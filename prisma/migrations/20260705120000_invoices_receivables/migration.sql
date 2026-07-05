-- Payment-method-agnostic receivables (see prisma/schema.prisma `Invoice`).
-- Lets trainers who bill by bank transfer / reconcile in Xero raise + track
-- invoices without any Stripe Connect setup. The Stripe `Payment` model is
-- untouched — invoices link to it only via the optional `paymentId` column.

-- Trainer opt-in: email the receivable to the client on creation vs leave unsent.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "autoSendInvoices" BOOLEAN NOT NULL DEFAULT false;

-- Receivables table.
CREATE TABLE IF NOT EXISTS "invoices" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "description" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "sentAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "xeroInvoiceId" TEXT,
    "xeroSyncStatus" TEXT,
    "xeroSyncError" TEXT,
    "paymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_paymentId_key" ON "invoices"("paymentId");
CREATE INDEX IF NOT EXISTS "invoices_trainerId_status_idx" ON "invoices"("trainerId", "status");
CREATE INDEX IF NOT EXISTS "invoices_clientId_idx" ON "invoices"("clientId");
CREATE INDEX IF NOT EXISTS "invoices_sourceType_sourceId_idx" ON "invoices"("sourceType", "sourceId");

-- FKs (idempotent guards so a re-run of migrate deploy is safe).
DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_trainerId_fkey"
        FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clientId_fkey"
        FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
