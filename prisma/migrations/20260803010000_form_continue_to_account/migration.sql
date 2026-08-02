-- One continuous run: enquiry → set a password → intake → their own diary.
--
-- A public enquiry used to end at a thank-you card. The person then waited for
-- the trainer to accept them, got an email, and started again from a login
-- screen. That break is what this removes: with `continueToAccount` on, the
-- submission hands straight over to a password step and then to the intake
-- form the trainer nominated, and the person ends up looking at their own
-- diary without ever leaving the run.
--
-- On `forms`:
--   continueToAccount     — the setting. Off by default, so no existing form
--                           changes behaviour when this deploys.
--   continueIntakeFormId  — which of the trainer's intake forms to ask next.
--                           Self-referencing FK, SetNull: deleting the intake
--                           form turns the handover off rather than taking the
--                           enquiry form down with it.
--
-- On `enquiries`, the handover token. The enquiry row is written FIRST and the
-- account second, deliberately — someone who walks away at the password step
-- still leaves the trainer a name, an email and a phone number to reply to.
-- The token is sha256(plain + AUTH_SECRET), the same shape as the accept
-- magic-link, so only the digest is ever stored:
--   continuationTokenHash — unique; the lookup key for the account step
--   continuationExpiresAt — 24h, long enough to come back from the email
--   continuationUsedAt    — single use, so a link in browser history or a
--                           forwarded email cannot re-run the handover
--
-- Table names are the @@map snake_case ones (forms, enquiries) — Prisma MODEL
-- names fail 42P01 under `migrate deploy` and take the prod build down with
-- them. Every statement is guarded so the file replays cleanly.

-- AlterTable
ALTER TABLE "forms"
  ADD COLUMN IF NOT EXISTS "continueToAccount" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "continueIntakeFormId" TEXT;

-- AlterTable
ALTER TABLE "enquiries"
  ADD COLUMN IF NOT EXISTS "continuationTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "continuationExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "continuationUsedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "enquiries_continuationTokenHash_key"
  ON "enquiries"("continuationTokenHash");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "forms"
    ADD CONSTRAINT "forms_continueIntakeFormId_fkey"
    FOREIGN KEY ("continueIntakeFormId") REFERENCES "forms"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
