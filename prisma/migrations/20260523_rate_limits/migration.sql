-- Rate-limit counters for abuse control (login, register, password reset,
-- public form submit). Additive + idempotent.
CREATE TABLE IF NOT EXISTS "rate_limits" (
  "key"     TEXT NOT NULL,
  "count"   INTEGER NOT NULL DEFAULT 0,
  "resetAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("key")
);

CREATE INDEX IF NOT EXISTS "rate_limits_resetAt_idx" ON "rate_limits"("resetAt");
