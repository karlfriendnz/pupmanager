-- Draft vs sent markers for session notes (1:1 form responses) and group-class
-- per-attendee reports. Null = saved draft (client cannot see it yet); set =
-- recap has been sent.
ALTER TABLE "session_form_responses" ADD COLUMN "sentAt" TIMESTAMP(3);
ALTER TABLE "session_attendance" ADD COLUMN "reportSentAt" TIMESTAMP(3);

-- Backfill: under the old behaviour, saving a note WAS sending it (the client
-- was notified and could see the recap the moment the row existed). So every
-- existing note is already "sent" — stamp it from its creation time so nothing
-- silently un-sends when the visibility gate goes live.
UPDATE "session_form_responses" SET "sentAt" = "createdAt" WHERE "sentAt" IS NULL;

-- Class reports only counted as sent once they actually had a written report.
UPDATE "session_attendance" SET "reportSentAt" = "markedAt" WHERE "report" IS NOT NULL AND "reportSentAt" IS NULL;
