-- "During the session" — the middle one of Karl's three stages.
--
-- NOTHING ELSE MAY GO IN THIS FILE.
--
-- Postgres refuses to USE an enum value that was added in the same transaction,
-- and Prisma wraps each migration in one. So a migration that adds a value and
-- then writes it (a DEFAULT, an UPDATE, a CHECK) succeeds on `db push` against a
-- dev database and fails only in production, at `migrate deploy`, with
-- "unsafe use of new value". The value gets its own file; anything that reads or
-- writes it belongs in a later migration.
--
-- Replay-safe: IF NOT EXISTS, so running this twice is a no-op.

ALTER TYPE "CommsFlowDirection" ADD VALUE IF NOT EXISTS 'DURING_SESSION';

-- FlowTrigger mirrors CommsFlowDirection one-for-one on its clock-anchored
-- values, and flowTriggerFor() resolves a step's trigger by looking the
-- direction up by name. Adding one without the other would make that lookup
-- miss and read a "during" step as BEFORE_SESSION.
ALTER TYPE "FlowTrigger" ADD VALUE IF NOT EXISTS 'DURING_SESSION';
