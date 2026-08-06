-- A form that genuinely holds up a booking.
--
-- Karl's groomer asks the same five questions before every groom, and the
-- booking is not confirmed until they are answered. Up to now a FORM step in a
-- flow was a NUDGE: the run waited and the client was chased, but the
-- TrainingSession was created the moment they tapped Book. This is the gate.
--
-- Three things, no enums and no enum VALUES (a value added in the same
-- transaction that uses it fails only in production, so there is nothing of
-- that shape in here):
--
--   1. comms_flow_steps.gatesBooking — "ask this before they can confirm".
--      Karl's three stages are before they confirm / during / after; direction
--      + offsetMinutes express the last two, and this is the first. It is not a
--      time, which is why it could not be another CommsFlowDirection value.
--
--   2. booking_holds — the claim on a slot while they answer. Deliberately NOT
--      a training_session: nothing that draws the calendar, counts bookings or
--      reports on them reads this table, so a held slot can never be mistaken
--      for a confirmed one. Expiry is enforced ON READ (every busy-interval
--      query filters expiresAt > now()), so a lapsed hold is bookable again
--      immediately; the cron only tidies the rows away afterwards.
--
--   3. booking_form_answers — what was actually said to get through the gate,
--      keyed to the SESSION / ENROLMENT / REQUEST, never to the client. Keying
--      it to the client is how "they answered once" would quietly satisfy every
--      future booking, which is the exact opposite of what a per-groom question
--      set is for.
--
-- ADDITIVE ONLY. gatesBooking defaults false, so every existing flow step keeps
-- behaving exactly as it does today and no offering gains a gate it wasn't
-- given. The two new tables start empty. Nothing to backfill.
--
-- Table names are the @@map snake_case ones (comms_flow_steps, trainer_profiles,
-- client_profiles, packages, forms, training_sessions, class_enrollments,
-- booking_requests). Prisma MODEL names would fail 42P01 under `migrate deploy`
-- and take the production build down with them.
--
-- Every statement is IF NOT EXISTS / guarded, so the file replays cleanly
-- against a database that already has it. Verified by running it twice.

-- AlterTable ─────────────────────────────────────────────────────────────────
ALTER TABLE "comms_flow_steps" ADD COLUMN IF NOT EXISTS "gatesBooking" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable: booking_holds ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "booking_holds" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT,
    "packageId" TEXT,
    "bookingPageId" TEXT,
    "slotAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "bufferMins" INTEGER NOT NULL DEFAULT 0,
    "formId" TEXT,
    "stepId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "answeredAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_holds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "booking_holds_trainerId_slotAt_idx" ON "booking_holds"("trainerId", "slotAt");
CREATE INDEX IF NOT EXISTS "booking_holds_expiresAt_idx" ON "booking_holds"("expiresAt");
CREATE INDEX IF NOT EXISTS "booking_holds_clientId_idx" ON "booking_holds"("clientId");
CREATE INDEX IF NOT EXISTS "booking_holds_packageId_idx" ON "booking_holds"("packageId");
CREATE INDEX IF NOT EXISTS "booking_holds_formId_idx" ON "booking_holds"("formId");

-- CreateTable: booking_form_answers ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "booking_form_answers" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "stepId" TEXT,
    "sessionId" TEXT,
    "enrollmentId" TEXT,
    "bookingRequestId" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_form_answers_pkey" PRIMARY KEY ("id")
);

-- One answer set per (thing booked, form). Postgres treats NULLs as distinct,
-- so each of these only ever fires on the anchor that is actually set.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_form_answers_sessionId_formId_key" ON "booking_form_answers"("sessionId", "formId");
CREATE UNIQUE INDEX IF NOT EXISTS "booking_form_answers_enrollmentId_formId_key" ON "booking_form_answers"("enrollmentId", "formId");
CREATE UNIQUE INDEX IF NOT EXISTS "booking_form_answers_bookingRequestId_formId_key" ON "booking_form_answers"("bookingRequestId", "formId");
CREATE INDEX IF NOT EXISTS "booking_form_answers_trainerId_idx" ON "booking_form_answers"("trainerId");
CREATE INDEX IF NOT EXISTS "booking_form_answers_clientId_idx" ON "booking_form_answers"("clientId");
CREATE INDEX IF NOT EXISTS "booking_form_answers_formId_idx" ON "booking_form_answers"("formId");

-- AddForeignKey ──────────────────────────────────────────────────────────────
-- Guarded individually: ADD CONSTRAINT has no IF NOT EXISTS in Postgres, so a
-- replay would otherwise fail 42710 on the second run.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_holds_trainerId_fkey') THEN
    ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_trainerId_fkey"
      FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_holds_clientId_fkey') THEN
    ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_holds_packageId_fkey') THEN
    ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_packageId_fkey"
      FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_holds_formId_fkey') THEN
    ALTER TABLE "booking_holds" ADD CONSTRAINT "booking_holds_formId_fkey"
      FOREIGN KEY ("formId") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_form_answers_trainerId_fkey') THEN
    ALTER TABLE "booking_form_answers" ADD CONSTRAINT "booking_form_answers_trainerId_fkey"
      FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_form_answers_clientId_fkey') THEN
    ALTER TABLE "booking_form_answers" ADD CONSTRAINT "booking_form_answers_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_form_answers_formId_fkey') THEN
    ALTER TABLE "booking_form_answers" ADD CONSTRAINT "booking_form_answers_formId_fkey"
      FOREIGN KEY ("formId") REFERENCES "forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_form_answers_sessionId_fkey') THEN
    ALTER TABLE "booking_form_answers" ADD CONSTRAINT "booking_form_answers_sessionId_fkey"
      FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_form_answers_enrollmentId_fkey') THEN
    ALTER TABLE "booking_form_answers" ADD CONSTRAINT "booking_form_answers_enrollmentId_fkey"
      FOREIGN KEY ("enrollmentId") REFERENCES "class_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_form_answers_bookingRequestId_fkey') THEN
    ALTER TABLE "booking_form_answers" ADD CONSTRAINT "booking_form_answers_bookingRequestId_fkey"
      FOREIGN KEY ("bookingRequestId") REFERENCES "booking_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
