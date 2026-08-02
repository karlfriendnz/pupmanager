-- Stock gets a history.
--
-- `products.stockCount` was a bare number: you could see twelve on the shelf
-- and nothing about how it got there — what came in, what sold, what was
-- written off. It STAYS as the running balance (ten places read it, and a
-- SUM() per product on every shop render is not worth paying for); this table
-- is the ledger written beside it, in the same transaction as every change.
--
-- "variantId" is here before anything writes it. Variants (size/colour SKUs)
-- are coming, and NULL means "the product's only SKU" — so every row written
-- today stays true when they land, with no backfill.
--
-- Table names are the @@map snake_case ones (stock_movements, products,
-- trainer_profiles, client_profiles, users); COLUMN names are camelCase,
-- because this schema maps tables only. Prisma MODEL names would fail 42P01
-- under `migrate deploy` and take the build down.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StockMovementReason" AS ENUM ('RECEIVED', 'SOLD', 'RETURNED', 'DAMAGED', 'LOST', 'CORRECTION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "stock_movements" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "trainerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "note" TEXT,
    "balanceAfter" INTEGER,
    "clientId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One product's history, newest first — the modal's only query.
CREATE INDEX IF NOT EXISTS "stock_movements_productId_createdAt_idx" ON "stock_movements"("productId", "createdAt");
-- Everything that moved in one business, for a future stock report.
CREATE INDEX IF NOT EXISTS "stock_movements_trainerId_createdAt_idx" ON "stock_movements"("trainerId", "createdAt");

-- AddForeignKey
-- Deleting a product takes its history with it: the ledger describes a thing
-- that no longer exists in the shop.
DO $$ BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SET NULL, not CASCADE: history outlives the people in it. Removing a client
-- or a staff member blanks who it was, it does not erase that a unit moved.
DO $$ BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
