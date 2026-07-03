-- What the business offers (onboarding personas). Drives which schedule
-- "add" options appear. Empty = unknown → show everything.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "businessRoles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
