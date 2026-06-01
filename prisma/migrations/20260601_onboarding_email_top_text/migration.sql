-- Optional intro text shown above the hero image in an onboarding/trial email.
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "topText" TEXT;
