-- Register the automated communication-flows cron (pg_cron + pg_net). Mirrors
-- 20260616020000_booking_automations_cron, but every 5 minutes because these
-- flows promise minute-level offsets ("15 minutes before"). Authenticates with
-- the prod CRON_SECRET via current_setting('app.cron_secret'). Wrapped so a
-- missing extension / insufficient privilege never fails the migration — if
-- skipped, run this block once in the Supabase SQL editor (superuser).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Every 5 min: the route dedups per (step, session, recipient) so frequent
  -- ticks only keep offset timing tight (±2.5 min), never double-send.
  PERFORM cron.schedule(
    'pm-comms-flows', '*/5 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/comms-flows',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
