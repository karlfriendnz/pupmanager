-- Route manager: client visit locations + trainer base (start/end) point.
-- Captured via Places Autocomplete, so lat/lng come from the picked place.
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "addressLine" TEXT;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "addressLat" DOUBLE PRECISION;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "addressLng" DOUBLE PRECISION;
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "addressPlaceId" TEXT;
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "baseAddress" TEXT;
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "baseLat" DOUBLE PRECISION;
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "baseLng" DOUBLE PRECISION;
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "basePlaceId" TEXT;
