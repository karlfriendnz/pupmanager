-- A user can hold multiple client relationships (one per trainer/tenant).
-- Replace the userId-only uniqueness with a (userId, trainerId) composite,
-- and add a plain userId index for lookups.

ALTER TABLE "client_profiles" DROP CONSTRAINT IF EXISTS "client_profiles_userId_key";
DROP INDEX IF EXISTS "client_profiles_userId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "client_profiles_userId_trainerId_key" ON "client_profiles" ("userId", "trainerId");
CREATE INDEX IF NOT EXISTS "client_profiles_userId_idx" ON "client_profiles" ("userId");
