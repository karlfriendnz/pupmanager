-- Optional EMAIL version of a platform announcement, plus a universal opt-out
-- from product-update emails (the in-app bell announcement is never suppressed).

ALTER TABLE "announcements"
  ADD COLUMN "sendEmail" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "emailSubject" TEXT,
  ADD COLUMN "emailHtml" TEXT,
  ADD COLUMN "emailRecipientCount" INTEGER;

ALTER TABLE "users" ADD COLUMN "productEmailOptOut" BOOLEAN NOT NULL DEFAULT false;
