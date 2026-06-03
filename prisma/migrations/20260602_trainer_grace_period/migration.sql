-- Admin-granted per-trainer grace period. When set and in the future, the
-- trainer keeps platform access regardless of trial/subscription state.
-- Additive + idempotent.

ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "gracePeriodUntil" TIMESTAMP(3);
