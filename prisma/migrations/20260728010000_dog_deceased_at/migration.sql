-- Dog.deceasedAt
--
-- A real column rather than a custom field because it must change behaviour:
-- deceased dogs are excluded from class invites, rosters/enrolment pickers,
-- attendance lists and reminders, while remaining visible on the owner's
-- profile so their history is preserved.
ALTER TABLE "dogs" ADD COLUMN IF NOT EXISTS "deceasedAt" TIMESTAMP(3);
