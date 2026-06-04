-- Promo codes: a shared code a trainer enters at signup that SETS their total
-- trial length (trialEndsAt = signup + trialDays) instead of the default 10.
-- Additive + idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "trialDays" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "maxRedemptions" INTEGER,
  "redeemedCount" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_key" ON "promo_codes" ("code");

-- Attribution: which code (if any) a trainer redeemed at signup.
ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "promoCodeId" TEXT;

CREATE INDEX IF NOT EXISTS "trainer_profiles_promoCodeId_idx"
  ON "trainer_profiles" ("promoCodeId");

-- FK is nullable + ON DELETE SET NULL so deleting a promo code never deletes
-- trainers. Wrapped for idempotency (ADD CONSTRAINT IF NOT EXISTS is unsupported).
DO $$ BEGIN
  ALTER TABLE "trainer_profiles"
    ADD CONSTRAINT "trainer_profiles_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
