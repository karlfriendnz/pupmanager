-- Link recurring "buddies walk" sessions so a dog added later can apply to
-- this walk, this + following, or the whole series. Additive + nullable.
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "walkSeriesId" TEXT;
CREATE INDEX IF NOT EXISTS "training_sessions_walkSeriesId_idx" ON "training_sessions" ("walkSeriesId");
