-- Products get variants.
--
-- A harness comes in Small/Medium/Large and a lead in two colours; until now
-- the shop could only say "harness", so a trainer either made three products
-- (three shelves, three photos, one price typed three times) or found out
-- which size was wanted by asking. A variant is a NAMED ROW under a product —
-- deliberately not a Shopify-style option × value matrix, which is several
-- times the work for a dog trainer's shop. Axes stay a possible upgrade: a
-- generator would write these same rows.
--
-- Everything here is ADDITIVE and nullable. A product with no variant rows
-- behaves exactly as it did — the price is its own, the count is its own, and
-- productRequests/paymentItems keep a NULL variantId.
--
-- Table names are the @@map snake_case ones (product_variants, products,
-- trainer_profiles, product_requests, payment_items); COLUMN names are
-- camelCase, because this schema maps tables only. Prisma MODEL names would
-- fail 42P01 under `migrate deploy` and take the build down.

-- CreateTable
CREATE TABLE IF NOT EXISTS "product_variants" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    -- NULL = inherit the product's. Five sizes at one price is typed once.
    "priceCents" INTEGER,
    "salePriceCents" INTEGER,
    "imageUrl" TEXT,
    -- NULL = not counted, the same meaning it has on products.stockCount.
    "stockCount" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One product's variants in the order the trainer dragged them into — the
-- only query the shop and the editor ever make.
CREATE INDEX IF NOT EXISTS "product_variants_productId_order_idx"
  ON "product_variants"("productId", "order");

-- AddForeignKey
-- Deleting a product takes its variants with it: a size of nothing.
DO $$ BEGIN
  ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Which variant was bought ────────────────────────────────────────────────
-- Without these you can tell that someone bought a harness and not which one,
-- which makes the whole feature unusable at the point it matters: handing the
-- thing over. NULL on every existing row, and nothing backfills them.

ALTER TABLE "product_requests" ADD COLUMN IF NOT EXISTS "variantId" TEXT;
ALTER TABLE "payment_items" ADD COLUMN IF NOT EXISTS "variantId" TEXT;

-- SET NULL, not CASCADE: a retired variant must not delete the order or the
-- paid line. Same rule the stock ledger already applies to clients and staff.
DO $$ BEGIN
  ALTER TABLE "product_requests"
    ADD CONSTRAINT "product_requests_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_items"
    ADD CONSTRAINT "payment_items_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- stock_movements."variantId" already exists (it was added with the ledger,
-- meaning "the product's only SKU"), so only the FK is new.
DO $$ BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── One PENDING request per (client, product, VARIANT) ──────────────────────
-- The old index was (clientId, productId) WHERE PENDING, which now reads as
-- "you may ask for a Small OR a Large, never both" — wrong, and it would fail
-- the second tap with a database error rather than a sentence.
--
-- COALESCE, not a plain three-column index: Postgres treats NULLs as DISTINCT
-- in a unique index, so (c1, p1, NULL) could appear twice and the duplicate
-- protection that products WITHOUT variants have today would silently vanish.
DROP INDEX IF EXISTS "product_requests_pending_unique";
CREATE UNIQUE INDEX IF NOT EXISTS "product_requests_pending_unique"
  ON "product_requests"("clientId", "productId", (COALESCE("variantId", '')))
  WHERE status = 'PENDING';
