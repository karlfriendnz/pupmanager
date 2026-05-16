-- Move all scheduled jobs off Vercel crons onto Supabase pg_cron.
-- Vercel's crons block was removed from vercel.json; these pg_cron jobs
-- call the same /api/cron/* HTTPS endpoints via pg_net.
--
-- The whole body is wrapped so a missing extension or insufficient
-- privilege NEVER fails this migration (and therefore never breaks the
-- build / `prisma migrate deploy`). If it's skipped, run the same
-- statements once in the Supabase SQL editor (superuser) — see the
-- ONE-TIME SETUP note below.
--
-- ONE-TIME SETUP (Supabase SQL editor, not committed — secret stays out
-- of git): set the shared cron secret so the jobs can authenticate:
--   ALTER DATABASE postgres SET app.cron_secret = '<the CRON_SECRET env value>';
-- The job command reads current_setting('app.cron_secret', true); until
-- it's set the endpoints return 401 (safe no-op, nothing fires twice).
--
-- Schedules are UTC (same expressions as the old Vercel crons; streak is
-- new, once daily). Jobs are named so re-running just updates them.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  PERFORM cron.schedule(
    'pm-daily-reminders', '0 6 * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/daily-reminders',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );

  PERFORM cron.schedule(
    'pm-evaluate-achievements', '30 18 * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/evaluate-achievements',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );

  PERFORM cron.schedule(
    'pm-streak-update', '0 20 * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/streak-update',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
