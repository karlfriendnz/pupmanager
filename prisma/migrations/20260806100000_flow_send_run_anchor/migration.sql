-- Flow builder, phase 2 — the RUN anchor on comms_flow_sends.
--
-- CommsFlowSend has always answered "did we send this to them", keyed by the
-- anchor the step fired against: a session, or a membership purchase. A
-- person-anchored step has neither. It is delivered when the PREVIOUS step is
-- finished, and which step a run is up to is re-derived from the completion
-- ledger every time it advances — so with no row to find, every advance would
-- re-send the same "fill this in" notification to the same person.
--
-- The column is the exact mirror of flow_step_completions.runId: "we asked" to
-- its "they did it", same nullable-anchor shape, same unique index doing the
-- de-duplication.
--
-- House rules (both learned the hard way here, see phase 1's migration):
--   • @@map'd snake_case table names — a Prisma MODEL name fails migrate deploy
--     with 42P01, in production, during the build.
--   • Replay-safe throughout: production has had `prisma db push` run against
--     it, so an object can already exist with _prisma_migrations knowing
--     nothing about it.

-- ─── AlterTable ─────────────────────────────────────────────────────────────
-- Nullable, like the two anchors beside it. Every existing row keeps exactly
-- the anchor it already had.
ALTER TABLE "comms_flow_sends" ADD COLUMN IF NOT EXISTS "runId" TEXT;

-- ─── AddForeignKey ──────────────────────────────────────────────────────────
-- Cascade: a deleted run takes its own "we asked them" rows with it, exactly as
-- it takes its completions.
DO $$ BEGIN
  ALTER TABLE "comms_flow_sends"
    ADD CONSTRAINT "comms_flow_sends_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "flow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── CreateIndex ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "comms_flow_sends_runId_idx" ON "comms_flow_sends"("runId");

-- The de-duplication itself. Postgres treats NULL as distinct from NULL in a
-- unique index, so this constrains nothing on the rows that exist today (their
-- runId is null) and everything on a journey's.
CREATE UNIQUE INDEX IF NOT EXISTS "comms_flow_sends_stepId_runId_userId_key"
  ON "comms_flow_sends"("stepId", "runId", "userId");
