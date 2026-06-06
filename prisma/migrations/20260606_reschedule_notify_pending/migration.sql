-- Defer reschedule notifications: flag moved sessions so the trainer can
-- batch-send them from a banner instead of firing on every drag.
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "rescheduleNotifyPendingAt" TIMESTAMP(3);
