-- Optional fixed display height (px) for an onboarding/trial email's image.
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "imageHeight" INTEGER;
