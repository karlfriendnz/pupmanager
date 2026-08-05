-- Register the "sweep up abandoned trade-show sandboxes" cron (pg_cron + pg_net).
--
-- Every FIVE minutes, not daily like the other purges. Nobody at a stand
-- presses "exit", so a sandbox that has gone quiet is the normal case rather
-- than the exception, and the whole point is that the next person to pick up a
-- phone is not inside the last person's workspace. Five minutes is also what
-- keeps the live-sandbox ceiling meaningful across a busy day.
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
    'pm-purge-demo', '*/5 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/purge-demo',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
