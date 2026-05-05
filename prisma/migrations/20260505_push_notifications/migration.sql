-- Push notifications: per-device APNs/FCM tokens and a marker on TrainingSession
-- so the "starting in ~20 min" reminder cron sends each push exactly once.

CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID');

CREATE TABLE "device_tokens" (
  "id"         TEXT PRIMARY KEY,
  "userId"     TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "platform"   "DevicePlatform" NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "device_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");
CREATE INDEX "device_tokens_userId_idx" ON "device_tokens"("userId");

ALTER TABLE "training_sessions"
  ADD COLUMN "reminderPushSentAt" TIMESTAMP(3);
