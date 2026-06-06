-- Dedup log for client session reminders.
CREATE TABLE IF NOT EXISTS "client_reminders_sent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "leadMinutes" INTEGER NOT NULL,
  "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_reminders_sent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "client_reminders_sent_sessionId_userId_leadMinutes_key" ON "client_reminders_sent"("sessionId", "userId", "leadMinutes");
CREATE INDEX IF NOT EXISTS "client_reminders_sent_sessionId_idx" ON "client_reminders_sent"("sessionId");
