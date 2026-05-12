-- Per-form styling: toggle the card border and override the submit
-- button colour. Defaults preserve the current look: border on,
-- platform blue button.

ALTER TABLE "embed_forms"
  ADD COLUMN IF NOT EXISTS "showBorder"  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "buttonColor" TEXT;
