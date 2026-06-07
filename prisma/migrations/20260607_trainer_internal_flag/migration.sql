-- Flag PupManager-owned (internal/test) trainer accounts.
-- Additive + defaulted so existing rows are unaffected.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "isInternal" BOOLEAN NOT NULL DEFAULT false;
