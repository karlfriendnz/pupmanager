-- Optional click-through links for the two image blocks (wraps each image in an
-- <a href> in the rendered email).
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "linkUrl" TEXT;
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "linkUrl2" TEXT;
