-- Optional hero image (public Blob URL) for an onboarding/trial email.
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
