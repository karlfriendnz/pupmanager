-- Billing items (per-seat "extra trainer" + toggleable add-ons) and the
-- per-trainer join that records which add-ons are switched on.
--
-- The Core software base stays in subscription_plans (id "core"). Seats and
-- add-ons live here, carrying the same Stripe price shape (NZD default in
-- stripePriceId + per-currency overrides in stripePriceIdsByCurrency).
--
-- Idempotent (IF NOT EXISTS / guarded enum) so re-running against prod is safe.

-- Enum: BillingItemKind
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingItemKind') THEN
    CREATE TYPE "BillingItemKind" AS ENUM ('SEAT', 'ADDON');
  END IF;
END
$$;

-- Table: billing_items
CREATE TABLE IF NOT EXISTS "billing_items" (
  "id"                       TEXT NOT NULL,
  "kind"                     "BillingItemKind" NOT NULL,
  "name"                     TEXT NOT NULL,
  "description"              TEXT,
  "priceMonthly"             DOUBLE PRECISION NOT NULL,
  "stripePriceId"            TEXT,
  "stripePriceIdsByCurrency" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "isActive"                 BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"                INTEGER NOT NULL DEFAULT 0,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_items_stripePriceId_key"
  ON "billing_items"("stripePriceId");

-- Table: trainer_addons
CREATE TABLE IF NOT EXISTS "trainer_addons" (
  "id"                       TEXT NOT NULL,
  "trainerId"                TEXT NOT NULL,
  "itemId"                   TEXT NOT NULL,
  "stripeSubscriptionItemId" TEXT,
  "active"                   BOOLEAN NOT NULL DEFAULT true,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trainer_addons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trainer_addons_stripeSubscriptionItemId_key"
  ON "trainer_addons"("stripeSubscriptionItemId");

CREATE INDEX IF NOT EXISTS "trainer_addons_trainerId_idx"
  ON "trainer_addons"("trainerId");

CREATE UNIQUE INDEX IF NOT EXISTS "trainer_addons_trainerId_itemId_key"
  ON "trainer_addons"("trainerId", "itemId");

-- Foreign keys (guarded — ADD CONSTRAINT has no IF NOT EXISTS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainer_addons_trainerId_fkey') THEN
    ALTER TABLE "trainer_addons"
      ADD CONSTRAINT "trainer_addons_trainerId_fkey"
      FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trainer_addons_itemId_fkey') THEN
    ALTER TABLE "trainer_addons"
      ADD CONSTRAINT "trainer_addons_itemId_fkey"
      FOREIGN KEY ("itemId") REFERENCES "billing_items"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;
