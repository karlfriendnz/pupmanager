-- Client notification system. Additive + idempotent.
--   NotificationType: 4 client-facing categories.
--   NotificationChannel: IN_APP (the notifications feed).
--   notifications.type / .link: categorise + deep-link feed items.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_ADDED_TO_PLAN';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_SESSION_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_SESSION_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_RECAP_READY';

ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'IN_APP';

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "type" "NotificationType";
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "link" TEXT;
CREATE INDEX IF NOT EXISTS "notifications_userId_idx" ON "notifications"("userId");
