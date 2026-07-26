-- Buying several ticket types in ONE go ("3 General + 3 VIP") is one enrolment
-- row per ticket type: each has to price off its own tier and be capped by its
-- own tier's capacity, and the client expects to read a line per type on the
-- invoice. ticketGroupId is what ties those rows back into the single action
-- they came from, so the basket bills as ONE invoice with several lines rather
-- than an invoice per ticket type.
--
-- NULL for every existing row and for every single-ticket enrolment, which is
-- the old behaviour untouched. Table/column names are the @@map'd snake_case.
ALTER TABLE "class_enrollments" ADD COLUMN "ticketGroupId" TEXT;

CREATE INDEX "class_enrollments_ticketGroupId_idx" ON "class_enrollments"("ticketGroupId");
