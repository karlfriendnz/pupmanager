-- "When they enrol" — the moment somebody joins, rather than a moment in one of
-- the sessions they joined for. Karl: "hmm yeah when they enrol is better".
--
-- NOTHING ELSE MAY GO IN THIS FILE.
--
-- Postgres refuses to USE an enum value that was added in the same transaction,
-- and Prisma wraps each migration in one. So a migration that adds a value and
-- then writes it (a DEFAULT, an UPDATE, a CHECK) succeeds on `db push` against a
-- dev database and fails only in production, at `migrate deploy`, with
-- "unsafe use of new value". The value gets its own file; the columns that
-- ledger it live in the migration after this one.
--
-- Replay-safe: IF NOT EXISTS, so running this twice is a no-op.

ALTER TYPE "CommsFlowDirection" ADD VALUE IF NOT EXISTS 'ON_ENROLMENT';

-- FlowTrigger mirrors CommsFlowDirection one-for-one on its clock-anchored
-- values, and flowTriggerFor() resolves a step's trigger by looking the
-- direction up by name. Adding one without the other would make that lookup
-- miss and read a welcome-on-joining step as BEFORE_SESSION — i.e. turn a
-- thank-you into a session reminder.
ALTER TYPE "FlowTrigger" ADD VALUE IF NOT EXISTS 'ON_ENROLMENT';
