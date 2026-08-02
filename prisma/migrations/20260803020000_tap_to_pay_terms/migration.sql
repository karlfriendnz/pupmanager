-- Apple's Tap to Pay terms, recorded per trainer.
--
-- Table name is the @@map'd snake_case one ("trainer_profiles"), NOT the Prisma
-- model name — `migrate deploy` fails 42P01 on the model name and takes the
-- production build down with it.
--
-- IF NOT EXISTS on both, because this file is replayed twice under
-- `psql -v ON_ERROR_STOP=1` and a second ALTER would abort the run.
--
-- Nullable with no default: "never linked" and "never accepted" are ordinary
-- states for every trainer who has not taken a card by tap, which is nearly all
-- of them.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "tapToPayTermsLinkedAt" TIMESTAMP(3);
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "tapToPayTermsAcceptedAt" TIMESTAMP(3);
