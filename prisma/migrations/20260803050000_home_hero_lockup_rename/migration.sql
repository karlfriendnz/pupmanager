-- The home-hero toggle governs the whole lockup, not just the logo.
--
-- Karl: "by unticking 'show my logo' it should hide 'Good evening, demo' as
-- well" — and his original wording was "whether they want their logo AND WORDS
-- there or not". The words are the greeting. So one control covers both, and
-- "homeHeroShowLogo" was left describing half of what it does.
--
-- A rename rather than living with the name: the column shipped in the
-- migration immediately before this one and has never been deployed, so there
-- is no data and no reader to break. A misleading column name outlives every
-- conversation about it.
--
-- Forward-only rather than editing 20260803040000 in place. Prisma stores a
-- checksum per applied migration, so rewriting a file that has already run
-- anywhere makes `migrate deploy` fail on a mismatch — and "anywhere" includes
-- any dev database that has already replayed it.
--
-- Table name is the @@map'd snake_case one ("trainer_profiles"), NOT the Prisma
-- model name — `migrate deploy` fails 42P01 on the model name and takes the
-- production build down with it.
--
-- Guarded rather than a bare RENAME because this file is replayed twice under
-- `psql -v ON_ERROR_STOP=1`, and a second RENAME would abort the run on a
-- column that no longer exists under the old name.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'trainer_profiles' AND column_name = 'homeHeroShowLogo'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'trainer_profiles' AND column_name = 'homeHeroShowLockup'
    ) THEN
        ALTER TABLE "trainer_profiles"
            RENAME COLUMN "homeHeroShowLogo" TO "homeHeroShowLockup";
    END IF;
END $$;

-- Belt and braces for a database that somehow never saw 20260803040000.
ALTER TABLE "trainer_profiles"
    ADD COLUMN IF NOT EXISTS "homeHeroShowLockup" BOOLEAN NOT NULL DEFAULT true;
