-- Public contact email shown to clients (may differ from the login email).
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "publicEmail" TEXT;
