-- Photos in chat.
--
-- One table for both kinds of message, with an exclusive arc: exactly one of
-- "messageId" / "groupMessageId" is set. The CHECK is what makes that a fact
-- rather than a convention — Prisma cannot express it, so it lives here.
--
-- Purely ADDITIVE: no existing column changes, no existing row is touched, and
-- every message that predates this reads back with an empty attachment list.
--
-- Table names are the @@map snake_case ones (message_attachments, messages,
-- group_messages). Replay-safe: run it twice and the second run is a no-op.

CREATE TABLE IF NOT EXISTS "message_attachments" (
  "id"             TEXT NOT NULL,
  "messageId"      TEXT,
  "groupMessageId" TEXT,
  -- Blob PATHNAME, not a url. The blob is private; the path is worthless
  -- without the store token.
  "storagePath"    TEXT NOT NULL,
  -- Sniffed from magic bytes at upload, never the browser's Content-Type.
  "contentType"    TEXT NOT NULL,
  "sizeBytes"      INTEGER NOT NULL,
  -- Layout hints only (aspect-ratio box), so the thread doesn't jump as photos
  -- load. Nothing trusts these for anything else.
  "width"          INTEGER,
  "height"         INTEGER,
  "position"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- Exactly one parent. Without this, a row with BOTH set would be visible from
-- two threads at once, and a row with NEITHER would be an orphan the serving
-- route could never authorise (so it would 404 — but it should not exist).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"message_attachments"'::regclass
      AND conname = 'message_attachments_one_parent'
  ) THEN
    ALTER TABLE "message_attachments"
      ADD CONSTRAINT "message_attachments_one_parent"
      CHECK (num_nonnulls("messageId", "groupMessageId") = 1);
  END IF;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Both FK columns lead an index (schema-integrity rule), and both indexes carry
-- "position" because the only way this table is ever read is "the photos on
-- this message, in order".
CREATE INDEX IF NOT EXISTS "message_attachments_messageId_position_idx"
  ON "message_attachments"("messageId", "position");
CREATE INDEX IF NOT EXISTS "message_attachments_groupMessageId_position_idx"
  ON "message_attachments"("groupMessageId", "position");

-- Deleting a message takes its photos with it. The blob itself is left in the
-- store — a chat message is not deleted by any UI today, and reaping orphaned
-- blobs is a housekeeping job, not something an FK should be doing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"message_attachments"'::regclass
      AND conname = 'message_attachments_messageId_fkey'
  ) THEN
    ALTER TABLE "message_attachments"
      ADD CONSTRAINT "message_attachments_messageId_fkey"
      FOREIGN KEY ("messageId") REFERENCES "messages"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = '"message_attachments"'::regclass
      AND conname = 'message_attachments_groupMessageId_fkey'
  ) THEN
    ALTER TABLE "message_attachments"
      ADD CONSTRAINT "message_attachments_groupMessageId_fkey"
      FOREIGN KEY ("groupMessageId") REFERENCES "group_messages"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
