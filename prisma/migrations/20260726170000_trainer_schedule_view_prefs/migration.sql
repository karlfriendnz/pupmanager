-- The trainer's remembered schedule layout, stored per device size.
--
-- These two columns were added to schema.prisma and applied to the dev DB with
-- `db:push:dev`, which writes no migration. Production applies schema changes
-- with `prisma migrate deploy`, so without this file the columns would simply
-- never exist there and every query selecting them would fail — the schedule
-- page would break on deploy while working perfectly in dev.
--
-- Table name is the @@map'd `trainer_profiles`, and the column names are
-- camelCase (no @map on the fields), so they must stay quoted.
--
-- IF NOT EXISTS: any environment already pushed by hand is left alone.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "scheduleView" TEXT;
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "scheduleMobileView" TEXT;
