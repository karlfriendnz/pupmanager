-- Trainer-facing "sample data" loader: tag seeded config rows so they can be
-- removed without touching the trainer's real data. Additive + idempotent.
-- (ClientProfile already has an isSample column; client-side content — dogs,
-- sessions, homework, badges — is removed by following the sample clients.)

ALTER TABLE "packages"           ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products"           ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "achievements"       ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "library_types"      ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "custom_fields"      ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "embed_forms"        ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "enquiries"          ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "availability_slots" ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "class_runs"         ADD COLUMN IF NOT EXISTS "isSample" BOOLEAN NOT NULL DEFAULT false;
