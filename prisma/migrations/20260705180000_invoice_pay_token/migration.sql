-- Public pay-token for invoices — the unguessable key to the no-login pay page
-- at /pay/<payToken>. New rows auto-get a cuid2 from the Prisma client; existing
-- rows are backfilled here with a random token so every invoice is payable.

ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "payToken" TEXT;

-- Backfill existing rows (gen_random_uuid is built into Postgres 13+).
UPDATE "invoices" SET "payToken" = replace(gen_random_uuid()::text, '-', '') WHERE "payToken" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "invoices_payToken_key" ON "invoices"("payToken");
