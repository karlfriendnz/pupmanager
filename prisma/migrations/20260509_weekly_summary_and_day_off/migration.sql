-- Two notification additions:
--   1. WEEKLY_SUMMARY type — Sunday-evening wrap (sessions completed,
--      revenue, week-ahead glance).
--   2. NotificationPreference.dayOffSummary toggle — swap the morning
--      digest for a "take the day off" message when sessionCount = 0.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEEKLY_SUMMARY';

ALTER TABLE "notification_preferences"
  ADD COLUMN IF NOT EXISTS "dayOffSummary" BOOLEAN NOT NULL DEFAULT true;
