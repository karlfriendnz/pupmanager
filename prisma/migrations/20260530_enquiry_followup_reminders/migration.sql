-- Unanswered-enquiry follow-up nudges (6/18/24/36h).
--
-- 1. New NotificationType enum variant + per-enquiry "highest nudge sent"
--    counter. These are plain DDL and run as part of `prisma migrate deploy`.
-- 2. The hourly pg_cron job that drives the new /api/cron/enquiry-followups
--    endpoint. Wrapped so a missing extension / insufficient privilege never
--    fails the migration — if skipped, run the same block once in the Supabase
--    SQL editor (superuser). Mirrors 20260517_supabase_crons.

-- ── Schema ────────────────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; Prisma's
-- migrate runner executes statements individually so this is fine here.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENQUIRY_FOLLOWUP_REMINDER';

ALTER TABLE "enquiries"
  ADD COLUMN IF NOT EXISTS "followupReminderLevel" INTEGER NOT NULL DEFAULT 0;

-- ── pg_cron job ───────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;

  -- Hourly: thresholds are ≥6h apart, so an hourly tick is plenty. The route
  -- resolves the exact threshold per enquiry and self-guards against
  -- double-sends via enquiries.followupReminderLevel.
  PERFORM cron.schedule(
    'pm-enquiry-followups', '0 * * * *',
    $cmd$ SELECT net.http_get(
      url     := 'https://app.pupmanager.com/api/cron/enquiry-followups',
      headers := jsonb_build_object('Authorization', 'Bearer ' || coalesce(current_setting('app.cron_secret', true), ''))
    ) $cmd$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Supabase pg_cron setup skipped (run manually in SQL editor): %', SQLERRM;
END $$;
