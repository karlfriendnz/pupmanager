-- Multi-line invoices. Each Invoice now owns one or more InvoiceLineItem rows;
-- Invoice.amountCents stays as the cached total (= sum of line amounts) so all
-- existing list/filter/Xero-total code keeps working unchanged.

CREATE TABLE IF NOT EXISTS "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "xeroAccountCode" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "invoice_line_items_invoiceId_idx" ON "invoice_line_items"("invoiceId");

DO $$ BEGIN
    ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey"
        FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Backfill: give every existing invoice a single line from its current
-- description + total, so all invoices have >=1 line.
INSERT INTO "invoice_line_items" ("id", "invoiceId", "description", "quantity", "unitAmountCents", "amountCents", "sortOrder", "createdAt")
SELECT
    'ili_' || "invoices"."id",
    "invoices"."id",
    COALESCE("invoices"."description", 'Invoice'),
    1,
    "invoices"."amountCents",
    "invoices"."amountCents",
    0,
    "invoices"."createdAt"
FROM "invoices"
WHERE NOT EXISTS (
    SELECT 1 FROM "invoice_line_items" l WHERE l."invoiceId" = "invoices"."id"
);
