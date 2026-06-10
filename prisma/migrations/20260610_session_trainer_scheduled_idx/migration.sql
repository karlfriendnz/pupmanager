-- Composite index for the hot "trainer's sessions in a date range" query used
-- by the schedule grid, dashboard, and route day view. Non-destructive.
CREATE INDEX IF NOT EXISTS "training_sessions_trainerId_scheduledAt_idx"
  ON "training_sessions" ("trainerId", "scheduledAt");
