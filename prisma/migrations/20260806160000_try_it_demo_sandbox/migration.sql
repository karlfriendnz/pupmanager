-- Trade-show "Try It" demo sandbox.
--
-- Two new tables (the marketing record and the visit) plus two nullable columns
-- on trainer_profiles that mark a tenant as a throwaway sandbox.
--
-- Everything is additive and defaulted, so an existing row reads back as "not a
-- demo" — which is the safe answer for a deploy that has not reached it. No new
-- enum values (Postgres refuses to use one added in the same transaction, and
-- Prisma wraps a migration in one). Replay-safe: run it twice and the second run
-- is a no-op.

-- ─── The sandbox marker on the tenant ────────────────────────────────────────
-- Non-null ONLY on a tenant created by the /try flow. Nothing outside
-- src/lib/demo-tenant.ts ever writes them; the purge refuses any tenant where
-- they are null.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "demoSessionId" TEXT;
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "demoExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "trainer_profiles_demoSessionId_key"
  ON "trainer_profiles" ("demoSessionId");

-- ─── The lead — outlives the sandbox, by design ──────────────────────────────
CREATE TABLE IF NOT EXISTS "demo_leads" (
  "id"                 TEXT         NOT NULL,
  "name"               TEXT         NOT NULL,
  "companyName"        TEXT         NOT NULL,
  "email"              TEXT         NOT NULL,
  "persona"            TEXT         NOT NULL,
  "termsVersion"       TEXT         NOT NULL,
  "termsAcceptedAt"    TIMESTAMP(3) NOT NULL,
  "marketingOptIn"     BOOLEAN      NOT NULL DEFAULT false,
  "marketingVersion"   TEXT,
  "marketingOptInAt"   TIMESTAMP(3),
  "marketingRevokedAt" TIMESTAMP(3),
  "source"             TEXT         NOT NULL DEFAULT 'link',
  "campaign"           TEXT,
  "ipHash"             TEXT,
  "userAgent"          TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_leads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "demo_leads_email_idx"          ON "demo_leads" ("email");
CREATE INDEX IF NOT EXISTS "demo_leads_createdAt_idx"      ON "demo_leads" ("createdAt");
CREATE INDEX IF NOT EXISTS "demo_leads_marketingOptIn_idx" ON "demo_leads" ("marketingOptIn");

-- ─── The visit ───────────────────────────────────────────────────────────────
-- trainerId / ownerUserId are plain columns, NOT foreign keys: the tenant is
-- deleted out from under this row and they are nulled. A FK with a cascade
-- would take the lead's visit history with it, which is the one thing the purge
-- must never do.
CREATE TABLE IF NOT EXISTS "demo_sessions" (
  "id"                TEXT         NOT NULL,
  "leadId"            TEXT         NOT NULL,
  "trainerId"         TEXT,
  "ownerUserId"       TEXT,
  "persona"           TEXT         NOT NULL,
  "status"            TEXT         NOT NULL DEFAULT 'ACTIVE',
  "startedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"         TIMESTAMP(3) NOT NULL,
  "endedAt"           TIMESTAMP(3),
  "purgedAt"          TIMESTAMP(3),
  "entryTokenHash"    TEXT,
  "entryTokenExpires" TIMESTAMP(3),
  "entryTokenUsedAt"  TIMESTAMP(3),
  "wantsFollowUp"     BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "demo_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "demo_sessions_trainerId_key"      ON "demo_sessions" ("trainerId");
CREATE UNIQUE INDEX IF NOT EXISTS "demo_sessions_ownerUserId_key"    ON "demo_sessions" ("ownerUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "demo_sessions_entryTokenHash_key" ON "demo_sessions" ("entryTokenHash");
CREATE INDEX IF NOT EXISTS "demo_sessions_leadId_idx"                ON "demo_sessions" ("leadId");
CREATE INDEX IF NOT EXISTS "demo_sessions_status_expiresAt_idx"      ON "demo_sessions" ("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "demo_sessions_status_lastSeenAt_idx"     ON "demo_sessions" ("status", "lastSeenAt");

-- The one FK we DO want: losing a lead (an erasure request) takes its visits.
DO $$
BEGIN
  ALTER TABLE "demo_sessions"
    ADD CONSTRAINT "demo_sessions_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "demo_leads" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
