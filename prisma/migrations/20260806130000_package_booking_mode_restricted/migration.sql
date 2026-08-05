-- The booking window's two halves stop being alternatives.
--
-- A trainer wants "Monday 3–5 and Wednesday 1–7, plus Saturday 10:00 sharp".
-- That is per-day RANGES and named exact TIMES at once, so the two modes merge
-- into one: RESTRICTED, whose meaning is the union of both columns.
--
-- ─── Why this is a migration of its own ─────────────────────────────────────
-- `ALTER TYPE ... ADD VALUE` cannot be used by a statement in the SAME
-- transaction that adds it ("unsafe use of new value of enum type"). Prisma
-- runs each migration file in one transaction, so the value is committed HERE
-- and the backfill that uses it lives in the next migration. Splitting them is
-- the fix; putting them together fails in production only, at deploy time.
--
-- Replay-safe: IF NOT EXISTS, so a database that already has the value (a
-- `prisma db push` against prod, which has happened here) is left alone.

ALTER TYPE "PackageBookingMode" ADD VALUE IF NOT EXISTS 'RESTRICTED';
