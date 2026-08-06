-- Pictures for the ways in.
--
-- The client's booking screen opens with rows that are ways in: the offering
-- categories (1:1 Sessions, Group Classes, Events, Packages) and the trainer's
-- tags. Neither had a picture of its own, so the row BORROWED one off the first
-- offering inside it. This lets a trainer set one deliberately, from the same
-- Settings screen where they set the word.
--
-- Two columns, no tables, no enums:
--
--   • tags.imageUrl      — the picture on one tag's row.
--   • trainer_profiles.navImages — nav key → image URL, mirroring the navLabels
--     column beside it, because "the picture for /classes" is the same shape of
--     fact as "the word for /classes" and a second mechanism would be two places
--     for the same trainer setting to live.
--
-- ADDITIVE AND NULLABLE ON PURPOSE. Production is behind on migrations, and NULL
-- here does not mean "no picture" — it means "borrow one", which is exactly what
-- every row did before this file. So an existing tag and an existing trainer read
-- back as today's behaviour with nothing to backfill.
--
-- Table names are the @@map snake_case ones (tags, trainer_profiles). Prisma
-- MODEL names would fail 42P01 under `migrate deploy` and take the production
-- build down with them.
--
-- Both statements are IF NOT EXISTS so the file can be replayed against a
-- database that already has it (a drifted dev DB, or a re-run after a partial
-- failure). Verified by running it twice.

-- AlterTable
ALTER TABLE "tags" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "navImages" JSONB;
