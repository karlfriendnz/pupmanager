-- Tag sample session-form templates so the trainer "sample data" loader's
-- session recaps clear cleanly. Additive + idempotent.

ALTER TABLE "session_forms" ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
