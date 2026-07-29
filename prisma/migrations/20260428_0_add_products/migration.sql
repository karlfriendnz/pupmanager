-- Trainer-owned shop products (physical or digital)
-- Idempotent: safe to re-run against a database where these objects already exist.
-- Renamed from 20260428_add_products so it sorts BEFORE
-- 20260428_add_product_requests, which declares an FK to "products".
DO $$ BEGIN
  CREATE TYPE "ProductKind" AS ENUM ('PHYSICAL', 'DIGITAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "products" (
  "id"          TEXT PRIMARY KEY,
  "trainerId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "kind"        "ProductKind" NOT NULL DEFAULT 'PHYSICAL',
  "priceCents"  INTEGER,
  "imageUrl"    TEXT,
  "downloadUrl" TEXT,
  "category"    TEXT,
  "featured"    BOOLEAN NOT NULL DEFAULT false,
  "active"      BOOLEAN NOT NULL DEFAULT true,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "products_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "products_trainerId_idx" ON "products"("trainerId");
CREATE INDEX IF NOT EXISTS "products_category_idx" ON "products"("category");
