-- An offering can be built now and shown later.
--
-- Trainers set next term up weeks ahead. Until now the only way to keep it off
-- the client's booking screen was not to build it yet. `visibleFrom` is the
-- instant clients start seeing it; NULL — the default, and what every existing
-- row means — is "visible immediately", so nothing changes for anything that
-- already exists.
--
-- An INSTANT, not a DATE. The trainer picks a calendar day, but the day is
-- resolved to midnight in THEIR timezone at save time, so every read is a plain
-- instant comparison. A DATE column compared against instants is exactly the
-- bug that moved an NZ trainer's whole week once already.
--
-- Table name is the @@map snake_case one (packages). The Prisma MODEL name
-- would fail 42P01 under `migrate deploy` and take the prod build down with it.
--
-- Guarded so it can be replayed against a database that already has it.

-- AlterTable
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "visibleFrom" TIMESTAMP(3);

-- CreateIndex
-- Every client-facing offering query now carries `visibleFrom IS NULL OR
-- visibleFrom <= now()`. Almost every row is NULL, so this is mostly here to
-- keep the scheduled few cheap to exclude alongside the trainer scope.
CREATE INDEX IF NOT EXISTS "packages_trainerId_visibleFrom_idx" ON "packages"("trainerId", "visibleFrom");
