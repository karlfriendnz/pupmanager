-- AlterTable: allow trainers to send bulk email on PupManager's shared sender
-- for testing, before verifying their own domain.
ALTER TABLE "trainer_profiles"
  ADD COLUMN     "useTrialSendingDomain" BOOLEAN NOT NULL DEFAULT false;
