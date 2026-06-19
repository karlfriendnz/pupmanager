-- Register the booking-page "before/after session" automation cron
-- (pg_cron + pg_net). Mirrors 20260606_client_reminder_cron: authenticates with
-- the prod CRON_SECRET via current_setting('app.cron_secret'). Wrapped so a
-- missing extension / insufficient privilege never fails the migration — if
-- skipped, run this block once in the Supabase SQL editor (superuser).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Every 15 min: the route dedups per (automation, session) so frequent ticks
  -- only keep reminder/follow-up timing tight, never double-send.
  PERFORM cron.schedule(
    'pm-booking-automations', '*/15 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/booking-automations',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
