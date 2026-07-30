-- Two additions, both nullable/defaulted so nothing existing has to change.
--
-- 1. ClassEnrollment.sessionFormId — THIS CLIENT's write-up form for a class.
--    A class is one group but not one kind of client: a puppy on foundations and a
--    dog in for reactivity need different questions answered, in the same room, on
--    the same night. Resolution order is enrolment → session → class default, so
--    null means "whatever the class says" and nothing changes for anyone until a
--    trainer picks a form for a person.
--
-- 2. wantsLog on library_tasks and training_tasks — does the client log a session
--    against this, or just read it? Plenty of the library is reference material
--    ("how to fit a harness") where asking for reps and a rating is noise.
--    Defaults to TRUE so every existing item and every piece of homework already
--    handed out behaves exactly as it does today.
--
-- Hand-written (see the review_comments migration for why), and idempotent so a
-- re-run is a no-op. Table names are the @@map values, not the model names.

ALTER TABLE "class_enrollments" ADD COLUMN IF NOT EXISTS "sessionFormId" TEXT;

CREATE INDEX IF NOT EXISTS "class_enrollments_sessionFormId_idx"
  ON "class_enrollments"("sessionFormId");

-- SetNull, not Cascade: deleting a form must not delete the enrolment. The client
-- is still in the class; they just fall back to the class's default form.
DO $$
BEGIN
  ALTER TABLE "class_enrollments"
    ADD CONSTRAINT "class_enrollments_sessionFormId_fkey"
    FOREIGN KEY ("sessionFormId") REFERENCES "session_forms"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "library_tasks"  ADD COLUMN IF NOT EXISTS "wantsLog" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "training_tasks" ADD COLUMN IF NOT EXISTS "wantsLog" BOOLEAN NOT NULL DEFAULT true;
