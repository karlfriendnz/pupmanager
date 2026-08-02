-- Homework knows whether it is preparation or practice.
--
-- "Bring a hungry dog and a pot of chicken" is useless if the client reads it
-- after the class. "Practise the recall twice a day" is noise if they read it
-- before. One flag on the offering's default-homework row, copied onto the
-- handed-out task, decides which — and the client screens gate on it.
--
-- AFTER_SESSION is the default because it is what every existing row means:
-- homework has always been written up at the end of a session.
--
-- Table names are the @@map snake_case ones (package_default_tasks,
-- training_tasks). Prisma MODEL names would fail 42P01 under `migrate deploy`
-- and take the prod build down with them.
--
-- Every statement is guarded so this file can be replayed against a database
-- that already has it (drifted dev DBs, a re-run after a partial failure).

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HomeworkTiming') THEN
    CREATE TYPE "HomeworkTiming" AS ENUM ('BEFORE_SESSION', 'AFTER_SESSION');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "package_default_tasks"
  ADD COLUMN IF NOT EXISTS "timing" "HomeworkTiming" NOT NULL DEFAULT 'AFTER_SESSION';

ALTER TABLE "training_tasks"
  ADD COLUMN IF NOT EXISTS "timing" "HomeworkTiming" NOT NULL DEFAULT 'AFTER_SESSION';

-- CreateIndex
-- The client's "this week" list filters on (clientId, date) and then has to ask
-- "has this task's session run yet". The timing column joins that decision, so
-- index it alongside the session it hangs off — the gate reads
-- (timing, sessionId) on every client screen that shows homework.
CREATE INDEX IF NOT EXISTS "training_tasks_timing_sessionId_idx" ON "training_tasks"("timing", "sessionId");
