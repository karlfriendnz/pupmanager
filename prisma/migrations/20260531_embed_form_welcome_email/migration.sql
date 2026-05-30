-- Per-form welcome-email controls for embed forms.
--
-- acceptEnquiry sends a magic-link "Access my training diary" email when a
-- trainer accepts an enquiry. These columns let the trainer customise that
-- email per form: the subject, the intro paragraph, whether the diary CTA
-- button shows, and its label. NULL/default values fall back to the platform
-- copy in src/lib/enquiries.ts, so existing forms keep their current email.

ALTER TABLE "embed_forms"
  ADD COLUMN IF NOT EXISTS "welcomeSubject"         TEXT,
  ADD COLUMN IF NOT EXISTS "welcomeIntro"           TEXT,
  ADD COLUMN IF NOT EXISTS "welcomeShowDiaryButton" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "welcomeButtonLabel"     TEXT;
