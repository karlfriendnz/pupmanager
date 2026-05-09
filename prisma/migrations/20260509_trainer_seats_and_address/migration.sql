-- Seat count + business address on TrainerProfile.
--
-- Seats mirrors the Stripe subscription's quantity so the in-app billing
-- summary doesn't have to round-trip Stripe to render. Address fields
-- back the new /billing/setup page (collected before Stripe Checkout so
-- we can pre-fill the customer + invoice with what the trainer typed).

ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "seatCount"       INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "addressLine1"    TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine2"    TEXT,
  ADD COLUMN IF NOT EXISTS "addressCity"     TEXT,
  ADD COLUMN IF NOT EXISTS "addressRegion"   TEXT,
  ADD COLUMN IF NOT EXISTS "addressPostcode" TEXT,
  ADD COLUMN IF NOT EXISTS "addressCountry"  TEXT;
