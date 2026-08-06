-- Register the "sweep expired booking holds" cron (pg_cron + pg_net).
--
-- Every ten minutes, and deliberately unimportant. A BookingHold stops making a
-- slot busy the instant it expires, because every read filters
-- `expiresAt > now()` — this job only deletes the dead rows. If it never ran,
-- the table would grow and nothing else would change.
--
-- That is the whole reason the interval can be this relaxed. Making the sweep
-- load-bearing would mean a slot stayed locked for up to ten minutes after it
-- should have been free, which is the exact failure the hold exists to prevent.
--
-- Same shape as the other jobs here: authenticates with the prod CRON_SECRET
-- via current_setting('app.cron_secret'). Wrapped so a missing extension or
-- insufficient privilege never fails the migration — if skipped, run this block
-- once in the Supabase SQL editor (superuser).
--
-- NOTE for whoever next rotates CRON_SECRET: this is one more job that has to
-- be rewritten, or it 401s silently. See the rotation runbook.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'pm-booking-holds', '*/10 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/booking-holds',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
