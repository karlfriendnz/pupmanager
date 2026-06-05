-- Multiple reminder lead times per preference (client can pick 1 day + 2h etc.).
ALTER TABLE "notification_preferences" ADD COLUMN IF NOT EXISTS "leadMinutes" INTEGER[] NOT NULL DEFAULT '{}';
