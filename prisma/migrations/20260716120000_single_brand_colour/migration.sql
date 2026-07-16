-- Collapse the per-trainer brand gradient into a single brand colour.
-- Preserve the more-visible app colour: prefer the old gradient start.
UPDATE "trainer_profiles" SET "emailAccentColor" = COALESCE("appGradientStart", "emailAccentColor");
ALTER TABLE "trainer_profiles" DROP COLUMN "appGradientStart";
ALTER TABLE "trainer_profiles" DROP COLUMN "appGradientEnd";
