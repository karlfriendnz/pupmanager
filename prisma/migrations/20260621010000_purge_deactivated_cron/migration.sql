-- Register the "purge soft-deleted accounts after the 30-day grace" cron
-- (pg_cron + pg_net). Mirrors the booking-automations cron: authenticates with
-- the prod CRON_SECRET via current_setting('app.cron_secret'). Wrapped so a
-- missing extension / insufficient privilege never fails the migration — if
-- skipped, run this block once in the Supabase SQL editor (superuser).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Daily at 03:15 UTC: finalise deletions whose grace window has elapsed.
  PERFORM cron.schedule(
    'pm-purge-deactivated', '15 3 * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/purge-deactivated',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
