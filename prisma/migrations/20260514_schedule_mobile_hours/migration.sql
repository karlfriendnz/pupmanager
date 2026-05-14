-- Per-device schedule visible-hours: a nullable mobile pair that
-- overrides scheduleStart/EndHour on phones. Null = fall back to the
-- desktop value so existing trainers see no behaviour change until
-- they set a mobile-specific range.

ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "scheduleMobileStartHour" INTEGER,
  ADD COLUMN IF NOT EXISTS "scheduleMobileEndHour"   INTEGER;
