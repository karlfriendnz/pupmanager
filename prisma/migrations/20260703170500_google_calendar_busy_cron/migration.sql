-- Register the "refresh Google Calendar busy times" cron (pg_cron + pg_net).
-- Mirrors the other PupManager crons: authenticates with the prod CRON_SECRET via
-- current_setting('app.cron_secret'). Wrapped so a missing extension /
-- insufficient privilege never fails the migration — if skipped, run this block
-- once in the Supabase SQL editor (superuser).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Every 3 hours: re-pull each connected member's busy window (now → ~60 days)
  -- so overlap warnings stay fresh.
  PERFORM cron.schedule(
    'pm-google-calendar-busy-refresh', '0 */3 * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/google-calendar-busy-refresh',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
