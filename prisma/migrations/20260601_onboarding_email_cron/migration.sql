-- Hourly dispatcher for trainer onboarding + trial-process emails.
--
-- Drives /api/cron/onboarding-emails. The route only sends PUBLISHED
-- OnboardingEmail templates and self-guards against double-sends via the
-- unique (progressId, emailKey) on trainer_onboarding_email_logs, so an hourly
-- tick is safe even though most thresholds are day-granular. With every
-- template unpublished the tick is a harmless no-op.
--
-- Wrapped so a missing extension / insufficient privilege never fails the
-- migration — if skipped, run the same block once in the Supabase SQL editor
-- (superuser). Mirrors 20260517_supabase_crons / 20260530_enquiry_followup_reminders.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'pm-onboarding-emails', '0 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/onboarding-emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
