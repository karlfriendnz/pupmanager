-- Founders Circle: flag the first 10 trainers who subscribe so we can
-- gate the founder Stripe coupon ("N of 10 left") and report on it.
-- The coupon itself (12-month repeating discount, max_redemptions = 10)
-- lives in Stripe; these columns are our side of the record. Stamped by
-- the Stripe webhook on checkout completion, so an abandoned checkout
-- never burns a seat.

ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "isFounder"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "founderClaimedAt" TIMESTAMP(3);
