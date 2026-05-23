-- Multi-trainer businesses. Adds a membership layer on top of the existing
-- tenant model (TrainerProfile stays the tenant; everything still scopes by
-- trainerId). A business can now have multiple trainer logins, each with a
-- CompanyRole (OWNER/MANAGER/STAFF) + granular permission overrides. Sessions
-- and clients gain an optional "assigned trainer" pointing at a membership.
--
-- Additive + idempotent. Backfill creates one OWNER membership per existing
-- business; existing sessions/clients are left unassigned (null = owner-implied
-- for today's sole-trainer businesses — no mass UPDATE).

-- ─── Enum ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CompanyRole" AS ENUM ('OWNER', 'MANAGER', 'STAFF');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── trainer_memberships ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "trainer_memberships" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "role"        "CompanyRole" NOT NULL DEFAULT 'STAFF',
  "title"       TEXT,
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "invitedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acceptedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "trainer_memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trainer_memberships_companyId_userId_key"
  ON "trainer_memberships"("companyId", "userId");
CREATE INDEX IF NOT EXISTS "trainer_memberships_companyId_idx"
  ON "trainer_memberships"("companyId");
CREATE INDEX IF NOT EXISTS "trainer_memberships_userId_idx"
  ON "trainer_memberships"("userId");

DO $$ BEGIN
  ALTER TABLE "trainer_memberships" ADD CONSTRAINT "trainer_memberships_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "trainer_memberships" ADD CONSTRAINT "trainer_memberships_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── assigned trainer on sessions + clients ──────────────────────────────────
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "assignedMembershipId" TEXT;
ALTER TABLE "client_profiles"   ADD COLUMN IF NOT EXISTS "assignedMembershipId" TEXT;

CREATE INDEX IF NOT EXISTS "training_sessions_assignedMembershipId_idx"
  ON "training_sessions"("assignedMembershipId");
CREATE INDEX IF NOT EXISTS "client_profiles_assignedMembershipId_idx"
  ON "client_profiles"("assignedMembershipId");

DO $$ BEGIN
  ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_assignedMembershipId_fkey"
    FOREIGN KEY ("assignedMembershipId") REFERENCES "trainer_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_assignedMembershipId_fkey"
    FOREIGN KEY ("assignedMembershipId") REFERENCES "trainer_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Backfill: one OWNER membership per existing business ─────────────────────
-- gen_random_uuid() is built into Postgres 13+ (Supabase enables it). The id
-- column is plain TEXT so a uuid string is a valid value alongside cuids.
INSERT INTO "trainer_memberships" ("id", "companyId", "userId", "role", "permissions", "invitedAt", "acceptedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, tp."id", tp."userId", 'OWNER', '{}', now(), now(), now(), now()
FROM "trainer_profiles" tp
WHERE NOT EXISTS (
  SELECT 1 FROM "trainer_memberships" m
  WHERE m."companyId" = tp."id" AND m."userId" = tp."userId"
);
