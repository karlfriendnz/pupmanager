-- Dual-mode billing: a sandbox flag on trainers + parallel TEST-mode price
-- columns on the plan + billing items, so the demo account can run against
-- Stripe test mode while everyone else is on live. Additive + idempotent.

ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "sandboxBilling" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "stripePriceIdTest" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePriceIdsByCurrencyTest" JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE "billing_items"
  ADD COLUMN IF NOT EXISTS "stripePriceIdTest" TEXT,
  ADD COLUMN IF NOT EXISTS "stripePriceIdsByCurrencyTest" JSONB NOT NULL DEFAULT '{}'::jsonb;
