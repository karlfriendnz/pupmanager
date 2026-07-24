-- Register the add-on comp expiry-reminder cron (pg_cron + pg_net). Mirrors
-- 20260724120500_comms_flows_cron, but runs once a day (09:10 UTC) — this only
-- needs to catch grants crossing into their final 2 days, and the route dedups
-- per grant via expiryReminderSentAt so extra ticks never re-send.
-- Authenticates with the prod CRON_SECRET via current_setting('app.cron_secret').
-- Wrapped so a missing extension / insufficient privilege never fails the
-- migration — if skipped, run this block once in the Supabase SQL editor.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'pm-addon-grant-expiry', '10 9 * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/addon-grant-expiry',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
