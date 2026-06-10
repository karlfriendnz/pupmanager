-- Deferred-email fallback for new-message notifications. `emailFallbackSentAt`
-- marks a message as already handled by the message-email-fallback cron so it's
-- never emailed twice. Index supports the cron's "unread + un-emailed by age" scan.
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "emailFallbackSentAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "messages_channel_readAt_emailFallbackSentAt_createdAt_idx"
  ON "messages" ("channel", "readAt", "emailFallbackSentAt", "createdAt");
