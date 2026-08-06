-- Where a "when they enrol" step records that it has fired.
--
-- comms_flow_sends already ledgers three anchors — the session a class/package
-- reminder fired for, the purchase a membership step fired for, and the run a
-- journey step was asked of. An ON_ENROLMENT step has none of them: a class has
-- many sessions and the welcome belongs to none of them, and a class enrolee has
-- no membership purchase. So it ledgers against the row that says they JOINED.
--
-- TWO columns, because "they enrolled" is two different rows:
--   * class_enrollments  — a ClassRun (class / casual class / event / puppy
--                          school). One row per client+dog per run.
--   * client_packages    — a 1:1 Package. The assignment IS the enrolment.
-- One shared id column would be a foreign key to nothing, so neither cascade
-- would clean up and a deleted enrolment would leave a row claiming to have
-- thanked somebody for a place that no longer exists.
--
-- Dedup is per ROW, which is the rule Karl asked for: a fresh enrolment row is a
-- fresh enrolment and may be thanked again; the same row must never be thanked
-- twice. Postgres treats NULLs as distinct, so each unique index only bites on
-- the anchor it names — exactly as the three that already exist do.
--
-- Additive: every existing row reads back unchanged with both columns NULL, and
-- none of the existing indexes is touched. Table names are the @@map snake_case
-- ones. Replay-safe: IF NOT EXISTS throughout, so running this twice is a no-op.

ALTER TABLE "comms_flow_sends" ADD COLUMN IF NOT EXISTS "enrollmentId" TEXT;
ALTER TABLE "comms_flow_sends" ADD COLUMN IF NOT EXISTS "clientPackageId" TEXT;

CREATE INDEX IF NOT EXISTS "comms_flow_sends_enrollmentId_idx" ON "comms_flow_sends"("enrollmentId");
CREATE INDEX IF NOT EXISTS "comms_flow_sends_clientPackageId_idx" ON "comms_flow_sends"("clientPackageId");

CREATE UNIQUE INDEX IF NOT EXISTS "comms_flow_sends_stepId_enrollmentId_userId_key"
  ON "comms_flow_sends"("stepId", "enrollmentId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "comms_flow_sends_stepId_clientPackageId_userId_key"
  ON "comms_flow_sends"("stepId", "clientPackageId", "userId");

-- ADD CONSTRAINT has no IF NOT EXISTS, so each FK is guarded by a lookup —
-- otherwise a replay fails on the constraint already being there.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comms_flow_sends_enrollmentId_fkey'
  ) THEN
    ALTER TABLE "comms_flow_sends"
      ADD CONSTRAINT "comms_flow_sends_enrollmentId_fkey"
      FOREIGN KEY ("enrollmentId") REFERENCES "class_enrollments"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'comms_flow_sends_clientPackageId_fkey'
  ) THEN
    ALTER TABLE "comms_flow_sends"
      ADD CONSTRAINT "comms_flow_sends_clientPackageId_fkey"
      FOREIGN KEY ("clientPackageId") REFERENCES "client_packages"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
