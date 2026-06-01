-- Client-app accent gradient (start + end hex) on the trainer, driving
-- --accent / --accent-strong in the client shell.
ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "appGradientStart" TEXT,
  ADD COLUMN IF NOT EXISTS "appGradientEnd"   TEXT;
