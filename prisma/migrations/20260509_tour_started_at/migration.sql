-- Explicit opt-in flag for the onboarding tour. Gates the floating FAB
-- + pulsing dots so they don't fire until the trainer has clicked
-- "Start the quick setup" / "Take the tour" — the welcome modal &
-- backfill banner alone shouldn't trigger them.

ALTER TABLE "trainer_onboarding_progress"
  ADD COLUMN IF NOT EXISTS "tourStartedAt" TIMESTAMP(3);

-- No backfill: every trainer (existing OR new) needs to click into the
-- tour from the dashboard before the FAB / pulse dots appear. Earlier
-- iterations stamped trainers with prior step activity, but the
-- product call is strict opt-in — random progress from past testing
-- doesn't count as a positive choice.
