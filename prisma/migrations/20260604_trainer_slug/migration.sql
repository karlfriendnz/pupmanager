-- Public branded client-login page: a URL-safe slug per trainer
-- (app.pupmanager.com/c/<slug>). Additive + idempotent. Nullable, unique;
-- Postgres allows multiple NULLs under a unique index, so existing rows are
-- fine until a slug is generated on demand.

ALTER TABLE "trainer_profiles"
  ADD COLUMN IF NOT EXISTS "slug" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "trainer_profiles_slug_key"
  ON "trainer_profiles" ("slug");
