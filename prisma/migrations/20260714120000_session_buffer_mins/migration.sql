-- "Gap before the next session" — a configurable turnaround buffer (travel,
-- clean-up, reset) that hangs off the END of a session and can't be booked into.
--
--   packages.bufferMins           the trainer's default gap for this package/class template
--   class_runs.bufferMins         per-run override (NULL = inherit the package)
--   training_sessions.bufferMins  the gap the session was BOOKED with (a snapshot,
--                                 so editing the package later never moves bookings
--                                 that are already in the diary)
--
-- All default to 0, so every existing row keeps today's back-to-back behaviour.
-- NOTE: @@map table names (snake_case), not Prisma model names.

ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "bufferMins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "class_runs" ADD COLUMN IF NOT EXISTS "bufferMins" INTEGER;
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "bufferMins" INTEGER NOT NULL DEFAULT 0;
