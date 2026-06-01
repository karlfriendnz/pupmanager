-- Trainer-curated photo/video gallery for a dog. Surfaced as the hero on the
-- client home + dog profile. Mirrors session_attachments.

CREATE TABLE IF NOT EXISTS "dog_media" (
  "id"           TEXT NOT NULL,
  "dogId"        TEXT NOT NULL,
  "trainerId"    TEXT NOT NULL,
  "kind"         "AttachmentKind" NOT NULL,
  "url"          TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "caption"      TEXT,
  "order"        INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dog_media_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "dog_media_dogId_idx" ON "dog_media"("dogId");
CREATE INDEX IF NOT EXISTS "dog_media_trainerId_idx" ON "dog_media"("trainerId");

DO $$ BEGIN
  ALTER TABLE "dog_media"
    ADD CONSTRAINT "dog_media_dogId_fkey"
    FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
