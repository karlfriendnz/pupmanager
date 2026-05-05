-- "Time to write notes" reminder fired N minutes before a session ends.
-- New enum variant + a separate sent-marker column so it can't double-send
-- and is independent of the start-reminder marker.

ALTER TYPE "NotificationType" ADD VALUE 'SESSION_NOTES_REMINDER';

ALTER TABLE "training_sessions"
  ADD COLUMN "notesReminderPushSentAt" TIMESTAMP(3);
