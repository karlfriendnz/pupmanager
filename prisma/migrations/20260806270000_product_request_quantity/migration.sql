-- A product can be ordered more than once.
--
-- Karl: "when ordering a product i should be able to say I want 2 of these."
-- Until now the number was always one: there was no column to hold anything
-- else, `takeStock` took exactly one unit, and the invoice billed for one.
--
-- ONE COLUMN, DEFAULTED, ADDITIVE. `product_requests."quantity"` is NOT NULL
-- DEFAULT 1, which means:
--
--   • every existing row reads back exactly as it does today — an order was
--     always for one, so 1 is not a guess about those rows, it is what they
--     say;
--   • no backfill is needed, because the default fills them as the column is
--     added;
--   • code that predates the column keeps working against a database that has
--     it (INSERTs that omit quantity get 1), which matters here — prod is
--     behind on migrations, so the two can land apart.
--
-- The CHECK is the server-side floor (AGENTS.md #3: the browser's
-- `<input min="1">` is not the check). Zero or negative would be an order that
-- took nothing off the shelf and billed for nothing, and the app refuses it in
-- three places already; this is the one that cannot be routed around.
--
-- Table name is the @@map snake_case one (product_requests), not the model
-- name. Replay-safe: run it twice and the second run is a no-op.

-- 1. The column.
ALTER TABLE "product_requests" ADD COLUMN IF NOT EXISTS "quantity" INTEGER NOT NULL DEFAULT 1;

-- 2. Belt and braces for a replay against a database where the column was
--    somehow added nullable: an order with no quantity is an order for one.
UPDATE "product_requests" SET "quantity" = 1 WHERE "quantity" IS NULL;

-- 3. At least one, always. Named so a replay finds it rather than adding a
--    second copy of the same rule.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"product_requests"'::regclass
      AND conname = 'product_requests_quantity_positive'
  ) THEN
    ALTER TABLE "product_requests"
      ADD CONSTRAINT "product_requests_quantity_positive" CHECK ("quantity" >= 1);
  END IF;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
