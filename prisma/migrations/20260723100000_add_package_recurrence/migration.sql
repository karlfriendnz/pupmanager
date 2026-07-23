-- Repeating-class schedule as an iCalendar RRULE subset (see lib/recurrence.ts).
-- null / "" = one-off. Hand-written; @@map snake_case table name.

-- AlterTable
ALTER TABLE "packages" ADD COLUMN "recurrenceRule" TEXT;
