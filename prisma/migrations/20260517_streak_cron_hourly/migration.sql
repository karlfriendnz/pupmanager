-- The streak job was redesigned into an 8pm training-day notes
-- reminder. It must run HOURLY (Supabase pg_cron has no daily-only
-- limit) so the route can fire for each trainer when THEIR local time
-- is 8pm. Re-schedule the existing pm-streak-update job from the old
-- daily '0 20 * * *' to hourly '0 * * * *'. cron.schedule upserts by
-- name. Exception-wrapped so a missing extension/privilege can't fail
-- the build (see 20260517_supabase_crons for the one-time setup note).

DO $$
BEGIN
  PERFORM cron.schedule(
    'pm-streak-update', '0 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/streak-update',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pm-streak-update reschedule skipped (run manually in SQL editor): %', SQLERRM;
END $$;
