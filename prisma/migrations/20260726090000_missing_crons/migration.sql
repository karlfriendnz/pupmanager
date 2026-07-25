-- Three cron routes shipped without ever being scheduled: weekly summaries,
-- the unread-message email fallback, and the Xero payment poll. They've simply
-- never run in production. Registered here in the same shape as the others
-- (pg_cron + pg_net, GUC-authenticated), wrapped so missing extensions or
-- privileges can't fail a deploy — if skipped, run this block once in the
-- Supabase SQL editor as superuser.
--
-- NOTE: every GUC-form job sends an empty bearer, and 401s, until the database
-- knows the secret:
--   ALTER DATABASE postgres SET app.cron_secret = '<CRON_SECRET>';
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Hourly, matching daily-summary: the route itself picks out the trainers
  -- whose local time is the configured Sunday evening hour.
  PERFORM cron.schedule(
    'pm-weekly-summary', '0 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/weekly-summary',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );

  -- Every 15 min: it emails a client only once they've left a message unread
  -- past the defer window, so the tick rate just keeps that window honest.
  PERFORM cron.schedule(
    'pm-message-email-fallback', '*/15 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/message-email-fallback',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );

  -- Hourly: the fallback for any Xero payment webhook we miss.
  PERFORM cron.schedule(
    'pm-xero-reconcile', '25 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/xero-reconcile',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
