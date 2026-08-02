-- Stripe Terminal / Tap to Pay: the trainer's Terminal Location id.
--
-- Table name is the @@map'd snake_case one ("trainer_profiles"), NOT the Prisma
-- model name — `migrate deploy` fails 42P01 on the model name and takes the
-- production build down with it.
--
-- Nullable with no default: a Location is created lazily on a trainer's first
-- tap, so "never tapped" and "no location" are the same state and neither is an
-- error.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "terminalLocationId" TEXT;
