-- Second optional image block + third text area for onboarding/trial emails,
-- plus a manual sort order for the admin "series" list.
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "imageUrl2" TEXT;
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "imageHeight2" INTEGER;
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "bottomText" TEXT;
ALTER TABLE "onboarding_emails" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill the activation (onboarding) series order.
UPDATE "onboarding_emails" SET "sortOrder" = 1 WHERE "key" = 'welcome';
UPDATE "onboarding_emails" SET "sortOrder" = 2 WHERE "key" = 'nudge_business_name_24h';
UPDATE "onboarding_emails" SET "sortOrder" = 3 WHERE "key" = 'invite_chase_24h';
UPDATE "onboarding_emails" SET "sortOrder" = 4 WHERE "key" = 'invite_other_channel_72h';
UPDATE "onboarding_emails" SET "sortOrder" = 5 WHERE "key" = 'founder_check_in_7d';
UPDATE "onboarding_emails" SET "sortOrder" = 6 WHERE "key" = 'aha_celebration';

-- Backfill the trial series order. The new "Here to Help your Business Thrive"
-- email slots in at position 3 (created by scripts/seed-trial-emails.ts). The
-- "How PupManager transforms your work day" email moves to position 7 and is
-- retimed to fire 5 days before the trial ends so it also SENDS in that slot.
UPDATE "onboarding_emails" SET "sortOrder" = 1  WHERE "key" = 'trial_welcome';
UPDATE "onboarding_emails" SET "sortOrder" = 2  WHERE "key" = 'trial_day3_value';
UPDATE "onboarding_emails" SET "sortOrder" = 4  WHERE "key" = 'trial_client_app';
UPDATE "onboarding_emails" SET "sortOrder" = 5  WHERE "key" = 'trial_brooke_routine';
UPDATE "onboarding_emails" SET "sortOrder" = 6  WHERE "key" = 'trial_halfway';
UPDATE "onboarding_emails"
  SET "sortOrder" = 7, "triggerRule" = '{"type":"trial_days_left","days":5}'::jsonb
  WHERE "key" = 'trial_transform_workday';
UPDATE "onboarding_emails" SET "sortOrder" = 8  WHERE "key" = 'trial_3days_left';
UPDATE "onboarding_emails" SET "sortOrder" = 9  WHERE "key" = 'trial_1day_left';
UPDATE "onboarding_emails" SET "sortOrder" = 10 WHERE "key" = 'trial_ended';

-- Slot the new email at position 3 if it already exists (idempotent — the seed
-- script creates it with sortOrder 3 too).
UPDATE "onboarding_emails" SET "sortOrder" = 3 WHERE "key" = 'trial_help_thrive';
