-- Trainer engagement gamification. Additive. Weekly activity rows +
-- badge awards (badge catalogue lives in code). Plus the STREAK_UPDATE
-- notification type enum value.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STREAK_UPDATE';

CREATE TABLE IF NOT EXISTS "trainer_activity_weeks" (
  "id"              TEXT NOT NULL,
  "trainerId"       TEXT NOT NULL,
  "isoWeek"         TEXT NOT NULL,
  "firstActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trainer_activity_weeks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "trainer_activity_weeks_trainerId_isoWeek_key"
  ON "trainer_activity_weeks"("trainerId", "isoWeek");
CREATE INDEX IF NOT EXISTS "trainer_activity_weeks_trainerId_idx"
  ON "trainer_activity_weeks"("trainerId");

CREATE TABLE IF NOT EXISTS "trainer_badge_awards" (
  "id"        TEXT NOT NULL,
  "trainerId" TEXT NOT NULL,
  "badgeKey"  TEXT NOT NULL,
  "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trainer_badge_awards_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "trainer_badge_awards_trainerId_badgeKey_key"
  ON "trainer_badge_awards"("trainerId", "badgeKey");
CREATE INDEX IF NOT EXISTS "trainer_badge_awards_trainerId_idx"
  ON "trainer_badge_awards"("trainerId");

DO $$ BEGIN
  ALTER TABLE "trainer_activity_weeks" ADD CONSTRAINT "trainer_activity_weeks_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "trainer_badge_awards" ADD CONSTRAINT "trainer_badge_awards_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
