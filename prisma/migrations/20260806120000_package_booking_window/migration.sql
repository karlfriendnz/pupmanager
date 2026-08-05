-- When a client may self-book a 1:1 offering.
--
-- A third dimension of self-booking, alongside the two that already exist:
-- clientSelfBook (may they?) and selfBookRequiresApproval (what happens after?).
-- This one says WHICH TIMES were ever on offer.
--
-- Purely ADDITIVE and DEFAULTED, deliberately. Production is behind on
-- migrations, and every row that already exists must read back as ANY_TIME —
-- "the client picks from the trainer's general availability", which is exactly
-- what those offerings do today. No intent is migrated.
--
-- House rules, both learned the hard way here:
--   • Table names are the @@map'd snake_case ones ("packages", never
--     "Package"). A Prisma MODEL name fails `migrate deploy` with 42P01 in
--     production, during the build.
--   • Everything is REPLAY-SAFE. `prisma db push` has been run against prod, so
--     an object can already exist with _prisma_migrations knowing nothing about
--     it — one 42710 on 2026-08-05 took a whole deploy and the nineteen
--     migrations queued behind it down.

-- ─── CreateEnum ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "PackageBookingMode" AS ENUM ('ANY_TIME', 'WEEKLY_WINDOW', 'EXACT_TIMES');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── AlterTable ─────────────────────────────────────────────────────────────
-- bookingWindowDays: ISO weekdays (1=Mon..7=Sun) for WEEKLY_WINDOW.
-- bookingWindowTimes: [{"day":1,"time":"09:00"}] for EXACT_TIMES.
-- Both default to an empty array so an ANY_TIME row carries no window at all.
ALTER TABLE "packages"
  ADD COLUMN IF NOT EXISTS "bookingWindowMode" "PackageBookingMode" NOT NULL DEFAULT 'ANY_TIME',
  ADD COLUMN IF NOT EXISTS "bookingWindowDays" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "bookingWindowStart" TEXT,
  ADD COLUMN IF NOT EXISTS "bookingWindowEnd" TEXT,
  ADD COLUMN IF NOT EXISTS "bookingWindowTimes" JSONB NOT NULL DEFAULT '[]';
