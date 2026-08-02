-- A photo behind the top of the trainer's home screen, and whether the logo
-- lockup shows over it.
--
-- On trainer_profiles, not on the membership: TrainerProfile.id IS the company
-- id (guard.companyId), so putting the two settings here makes them one
-- decision for the whole business — which is what was asked for. A grooming
-- company with five staff gets one home screen, not five.
--
-- homeHeroShowLogo DEFAULTs true because that is what every existing account
-- already sees: the lockup has always been on the phone home. A default of
-- false would silently take every trainer's logo off their own home screen the
-- moment this migration ran.
--
-- @db.Text on the URL rather than varchar: Vercel Blob URLs carry a random
-- suffix and a path per trainer, and there is no useful length to guess at.
--
-- Table name is the @@map'd snake_case one ("trainer_profiles"), NOT the Prisma
-- model name — `migrate deploy` fails 42P01 on the model name and takes the
-- production build down with it.
--
-- IF NOT EXISTS because this file is replayed twice under
-- `psql -v ON_ERROR_STOP=1` and a second ALTER would abort the run.
ALTER TABLE "trainer_profiles"
    ADD COLUMN IF NOT EXISTS "homeHeroImageUrl" TEXT;

ALTER TABLE "trainer_profiles"
    ADD COLUMN IF NOT EXISTS "homeHeroShowLogo" BOOLEAN NOT NULL DEFAULT true;
