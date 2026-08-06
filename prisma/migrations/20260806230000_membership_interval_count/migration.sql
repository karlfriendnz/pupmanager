-- A recurring plan can bill every N weeks / N months.
--
-- Additive and defaulted: `intervalCount = 1` reproduces exactly today's
-- behaviour for every existing row, so a plan this deploy has not reached still
-- bills and reads as it always has. No enum value is added and no existing
-- FORTNIGHT row is rewritten — a fortnight is already `week × 2` at Stripe and
-- rewriting live billing rows to prove it is not worth the risk.
--
-- Table names are the @@map snake_case ones. Replay-safe: IF NOT EXISTS on both.

ALTER TABLE "membership_plans"
  ADD COLUMN IF NOT EXISTS "intervalCount" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "membership_consents"
  ADD COLUMN IF NOT EXISTS "intervalCount" INTEGER NOT NULL DEFAULT 1;
