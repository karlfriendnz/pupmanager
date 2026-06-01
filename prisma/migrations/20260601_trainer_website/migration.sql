-- Public website URL shown to clients as a link in the app header.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "website" TEXT;
