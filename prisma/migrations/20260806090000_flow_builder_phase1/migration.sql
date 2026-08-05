-- Flow builder, phase 1 — the ENGINE seam only. No trainer UI, no new step type
-- wired to a client, and no change to what any existing reminder does.
--
-- Two house rules, both learned the hard way here:
--   • Table names are the @@map'd snake_case ones (comms_flow_steps, forms,
--     trainer_profiles…). A Prisma MODEL name fails `migrate deploy` with
--     42P01, in production, during the build.
--   • Everything is REPLAY-SAFE. Production has had `prisma db push` run
--     against it, so objects can already exist with _prisma_migrations knowing
--     nothing about them — on 2026-08-05 one 42710 took a whole deploy and the
--     nineteen migrations queued behind it down.

-- ─── CreateEnum ─────────────────────────────────────────────────────────────
-- What a step asks for. Every existing row is a MESSAGE.
DO $$ BEGIN
  CREATE TYPE "FlowStepKind" AS ENUM (
    'MESSAGE', 'FORM', 'UPLOAD', 'TASK', 'ACCOUNT', 'CHOOSE_OFFERING', 'APPROVAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Who performs it. The acquisition journey ends with the TRAINER accepting or
-- moving a time, so "the client does every step" was never true.
DO $$ BEGIN
  CREATE TYPE "FlowStepActor" AS ENUM ('CLIENT', 'TRAINER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- What starts a flow. The first four mirror "CommsFlowDirection" one-for-one;
-- that type is deliberately neither renamed nor dropped — every existing row,
-- the API, the editor and the engine still read it.
DO $$ BEGIN
  CREATE TYPE "FlowTrigger" AS ENUM (
    'BEFORE_SESSION', 'AFTER_SESSION', 'AFTER_PURCHASE', 'BEFORE_PERIOD_END',
    'ON_ENQUIRY_SUBMITTED', 'ON_SIGNUP', 'ON_BOOKING'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "FlowRunStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── AlterTable: comms_flow_steps ───────────────────────────────────────────
-- kind defaults to MESSAGE so every row already in the table reads back as
-- exactly what it is today. NOT NULL + DEFAULT is safe: Postgres 11+ stores the
-- default in the catalogue rather than rewriting the table.
ALTER TABLE "comms_flow_steps"
  ADD COLUMN IF NOT EXISTS "kind"     "FlowStepKind"  NOT NULL DEFAULT 'MESSAGE',
  ADD COLUMN IF NOT EXISTS "actor"    "FlowStepActor" NOT NULL DEFAULT 'CLIENT',
  -- NULL on every session/purchase-anchored step: its trigger IS `direction`.
  -- Deliberately NOT backfilled from direction — two columns holding the same
  -- fact is how they drift. Resolved by flowTriggerFor() in lib/flow-steps.ts.
  ADD COLUMN IF NOT EXISTS "trigger"  "FlowTrigger",
  ADD COLUMN IF NOT EXISTS "blocking" BOOLEAN         NOT NULL DEFAULT false,
  -- Kind-specific config (which form, what to upload). MESSAGE leaves it null.
  ADD COLUMN IF NOT EXISTS "payload"  JSONB,
  -- A person-anchored journey's steps hang off the Form it starts from.
  ADD COLUMN IF NOT EXISTS "formId"   TEXT;

-- A non-message step has no message copy. A MESSAGE step still requires both —
-- enforced in stepFieldsSchema, which is the only thing that can express
-- "required, but only for one kind". DROP NOT NULL is idempotent.
ALTER TABLE "comms_flow_steps" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "comms_flow_steps" ALTER COLUMN "body"  DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "comms_flow_steps_formId_idx" ON "comms_flow_steps"("formId");

DO $$ BEGIN
  ALTER TABLE "comms_flow_steps"
    ADD CONSTRAINT "comms_flow_steps_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── CreateTable: flow_runs ─────────────────────────────────────────────────
-- One person's journey through a PERSON-anchored flow, plus the cursor.
-- Session-anchored flows have no row here and never will: they are a stateless
-- scan, which is what lets one cron tick cover every trainer.
CREATE TABLE IF NOT EXISTS "flow_runs" (
    "id"            TEXT NOT NULL,
    "trainerId"     TEXT NOT NULL,
    "formId"        TEXT,
    "packageId"     TEXT,
    "trigger"       "FlowTrigger" NOT NULL,
    "userId"        TEXT,
    "clientId"      TEXT,
    "enquiryId"     TEXT,
    "status"        "FlowRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentStepId" TEXT,
    "context"       JSONB,
    "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"   TIMESTAMP(3),
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_runs_pkey" PRIMARY KEY ("id")
);

-- ─── CreateTable: flow_step_completions ─────────────────────────────────────
-- The sibling of comms_flow_sends: that one records "we sent it", this one
-- records "they did it". Exactly one anchor is set, and the unique index on
-- that anchor is what makes a double-submit idempotent.
CREATE TABLE IF NOT EXISTS "flow_step_completions" (
    "id"          TEXT NOT NULL,
    "stepId"      TEXT NOT NULL,
    "runId"       TEXT,
    "sessionId"   TEXT,
    "purchaseId"  TEXT,
    "userId"      TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result"      JSONB,

    CONSTRAINT "flow_step_completions_pkey" PRIMARY KEY ("id")
);

-- ─── CreateIndex ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "flow_runs_trainerId_idx"     ON "flow_runs"("trainerId");
CREATE INDEX IF NOT EXISTS "flow_runs_formId_idx"        ON "flow_runs"("formId");
CREATE INDEX IF NOT EXISTS "flow_runs_packageId_idx"     ON "flow_runs"("packageId");
CREATE INDEX IF NOT EXISTS "flow_runs_userId_idx"        ON "flow_runs"("userId");
CREATE INDEX IF NOT EXISTS "flow_runs_clientId_idx"      ON "flow_runs"("clientId");
CREATE INDEX IF NOT EXISTS "flow_runs_enquiryId_idx"     ON "flow_runs"("enquiryId");
CREATE INDEX IF NOT EXISTS "flow_runs_currentStepId_idx" ON "flow_runs"("currentStepId");
CREATE INDEX IF NOT EXISTS "flow_runs_status_idx"        ON "flow_runs"("status");

CREATE INDEX IF NOT EXISTS "flow_step_completions_runId_idx"      ON "flow_step_completions"("runId");
CREATE INDEX IF NOT EXISTS "flow_step_completions_sessionId_idx"  ON "flow_step_completions"("sessionId");
CREATE INDEX IF NOT EXISTS "flow_step_completions_purchaseId_idx" ON "flow_step_completions"("purchaseId");

CREATE UNIQUE INDEX IF NOT EXISTS "flow_step_completions_stepId_sessionId_userId_key"
  ON "flow_step_completions"("stepId", "sessionId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "flow_step_completions_stepId_purchaseId_userId_key"
  ON "flow_step_completions"("stepId", "purchaseId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "flow_step_completions_stepId_runId_userId_key"
  ON "flow_step_completions"("stepId", "runId", "userId");

-- ─── AddForeignKey ──────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_formId_fkey"
    FOREIGN KEY ("formId") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_enquiryId_fkey"
    FOREIGN KEY ("enquiryId") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SetNull, not Cascade: deleting one step of a journey must not delete the
-- people walking through it.
DO $$ BEGIN
  ALTER TABLE "flow_runs" ADD CONSTRAINT "flow_runs_currentStepId_fkey"
    FOREIGN KEY ("currentStepId") REFERENCES "comms_flow_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_step_completions" ADD CONSTRAINT "flow_step_completions_stepId_fkey"
    FOREIGN KEY ("stepId") REFERENCES "comms_flow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_step_completions" ADD CONSTRAINT "flow_step_completions_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "flow_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_step_completions" ADD CONSTRAINT "flow_step_completions_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flow_step_completions" ADD CONSTRAINT "flow_step_completions_purchaseId_fkey"
    FOREIGN KEY ("purchaseId") REFERENCES "membership_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
