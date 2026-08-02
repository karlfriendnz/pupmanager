-- One occurrence of a run, changed on its own.
--
-- A weekly casual class runs for months. One week is a public holiday; another
-- has to start an hour later. The only tool was DELETE, which took the register
-- and every drop-in booking with it (both cascade from training_sessions), and
-- which the nightly slot top-up would then undo — a deleted date leaves nothing
-- behind to say it was deliberate.
--
--   cancelledAt          — this one is off. The ROW STAYS, which is what keeps
--                          the bookings and what stops the top-up rebuilding it.
--   cancelReason         — what the client is told ("Labour Day").
--   scheduleOverriddenAt — this one was hand-set, so no class-wide rebuild or
--                          venue propagation may quietly put it back.
--   originalScheduledAt  — where the generator had put it, so the slot planner
--                          recognises a moved session instead of re-creating it
--                          at the old time.
--
-- Table name is the @@map snake_case one (training_sessions). The Prisma MODEL
-- name would fail 42P01 under `migrate deploy` and take the prod build down.
--
-- Guarded so it can be replayed against a database that already has it.

-- AlterTable
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "cancelReason" TEXT;
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "scheduleOverriddenAt" TIMESTAMP(3);
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "originalScheduledAt" TIMESTAMP(3);

-- CreateIndex
-- Every count, price, roster and reminder on a run now asks for its LIVE
-- sessions — "this run, not cancelled" is the new hot predicate.
CREATE INDEX IF NOT EXISTS "training_sessions_classRunId_cancelledAt_idx"
  ON "training_sessions"("classRunId", "cancelledAt");
