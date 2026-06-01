-- First-run personalization wizard support.
-- 1. A trainer's personal welcome note shown to clients on the app home.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "clientWelcomeNote" TEXT;
-- 2. Marks the auto-seeded "Sample" client used for the preview-as look-through.
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
