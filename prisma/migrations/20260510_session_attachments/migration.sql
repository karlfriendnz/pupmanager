-- Trainer-uploaded media attached to a TrainingSession. Photos + short
-- clips, stored in Vercel Blob (no transcoding for v1). Cascade-deletes
-- when the parent session is deleted.

DO $$ BEGIN
  CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'VIDEO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "session_attachments" (
  "id"           TEXT NOT NULL,
  "sessionId"    TEXT NOT NULL,
  "trainerId"    TEXT NOT NULL,
  "kind"         "AttachmentKind" NOT NULL,
  "url"          TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "caption"      TEXT,
  "sizeBytes"    INTEGER NOT NULL,
  "durationMs"   INTEGER,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "session_attachments_sessionId_idx" ON "session_attachments"("sessionId");
CREATE INDEX IF NOT EXISTS "session_attachments_trainerId_idx" ON "session_attachments"("trainerId");

DO $$ BEGIN
  ALTER TABLE "session_attachments"
    ADD CONSTRAINT "session_attachments_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
