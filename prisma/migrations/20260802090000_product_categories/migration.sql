-- Product categories become rows.
--
-- They were a free-form string on each product, which grouped the shop but
-- could not be managed: no way to create an empty category and fill it later,
-- no way to rename one without editing every product in it, and nowhere to keep
-- the order they appear in.
--
-- `products.category` is DELIBERATELY LEFT IN PLACE and still written. Anything
-- that has not moved across keeps working, and the backfill below means the two
-- agree on day one. Dropping it is a separate change, once nothing reads it.
--
-- Table names are the @@map snake_case ones (product_categories, products,
-- trainer_profiles). Prisma MODEL names would fail 42P01 under `migrate deploy`.

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One "Treats" per business; a second would split the shelf in two.
CREATE UNIQUE INDEX "product_categories_trainerId_name_key" ON "product_categories"("trainerId", "name");
CREATE INDEX "product_categories_trainerId_idx" ON "product_categories"("trainerId");

-- AlterTable
ALTER TABLE "products" ADD COLUMN "categoryId" TEXT;

-- AddForeignKey
ALTER TABLE "product_categories"
  ADD CONSTRAINT "product_categories_trainerId_fkey"
  FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: deleting a category must not delete the things in it.
-- They fall back to Uncategorised and stay on sale.
ALTER TABLE "products"
  ADD CONSTRAINT "products_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one row per distinct name a trainer has actually used, ordered the
-- way the list already showed them (alphabetically), then point the products at
-- them. Without this every existing shop would open Uncategorised.
INSERT INTO "product_categories" ("id", "trainerId", "name", "order", "createdAt", "updatedAt")
SELECT
  md5(random()::text || clock_timestamp()::text)::uuid::text,
  s."trainerId",
  s."category",
  (row_number() OVER (PARTITION BY s."trainerId" ORDER BY s."category"))::int - 1,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT "trainerId", btrim("category") AS "category"
  FROM "products"
  WHERE "category" IS NOT NULL AND btrim("category") <> ''
) s;

UPDATE "products" p
SET "categoryId" = c."id"
FROM "product_categories" c
WHERE c."trainerId" = p."trainerId"
  AND c."name" = btrim(p."category")
  AND p."category" IS NOT NULL;
