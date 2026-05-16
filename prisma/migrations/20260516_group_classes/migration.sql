-- Group classes. All additive: existing 1:1 Package/ClientPackage path is
-- untouched. A group Package can have many ClassRuns (cohorts); each run
-- owns one shared TrainingSession series that many clients enrol into.

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ClassRunStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EnrollmentType" AS ENUM ('FULL', 'DROP_IN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EnrollmentStatus" AS ENUM ('ENROLLED', 'WAITLISTED', 'WITHDRAWN', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'LATE', 'EXCUSED', 'MAKEUP');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Package: group-class config ─────────────────────────────────────────────
ALTER TABLE "packages"
  ADD COLUMN IF NOT EXISTS "isGroup"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "capacity"         INTEGER,
  ADD COLUMN IF NOT EXISTS "allowDropIn"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "dropInPriceCents" INTEGER,
  ADD COLUMN IF NOT EXISTS "allowWaitlist"    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "publicEnrollment" BOOLEAN NOT NULL DEFAULT false;

-- ─── TrainingSession: belongs-to-run ─────────────────────────────────────────
ALTER TABLE "training_sessions"
  ADD COLUMN IF NOT EXISTS "classRunId"   TEXT,
  ADD COLUMN IF NOT EXISTS "sessionIndex" INTEGER;
CREATE INDEX IF NOT EXISTS "training_sessions_classRunId_idx" ON "training_sessions"("classRunId");

-- ─── class_runs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "class_runs" (
  "id"           TEXT NOT NULL,
  "trainerId"    TEXT NOT NULL,
  "packageId"    TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "scheduleNote" TEXT,
  "startDate"    TIMESTAMP(3) NOT NULL,
  "capacity"     INTEGER,
  "status"       "ClassRunStatus" NOT NULL DEFAULT 'SCHEDULED',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "class_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "class_runs_trainerId_idx" ON "class_runs"("trainerId");
CREATE INDEX IF NOT EXISTS "class_runs_packageId_idx" ON "class_runs"("packageId");

-- ─── class_enrollments ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "class_enrollments" (
  "id"               TEXT NOT NULL,
  "classRunId"       TEXT NOT NULL,
  "clientId"         TEXT NOT NULL,
  "dogId"            TEXT,
  "type"             "EnrollmentType" NOT NULL DEFAULT 'FULL',
  "status"           "EnrollmentStatus" NOT NULL DEFAULT 'ENROLLED',
  "waitlistPosition" INTEGER,
  "joinedAtIndex"    INTEGER,
  "source"           TEXT NOT NULL DEFAULT 'TRAINER',
  "invoicedAt"       TIMESTAMP(3),
  "enrolledAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "withdrawnAt"      TIMESTAMP(3),
  CONSTRAINT "class_enrollments_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "class_enrollments_classRunId_clientId_dogId_key"
  ON "class_enrollments"("classRunId", "clientId", "dogId");
CREATE INDEX IF NOT EXISTS "class_enrollments_classRunId_idx" ON "class_enrollments"("classRunId");
CREATE INDEX IF NOT EXISTS "class_enrollments_clientId_idx" ON "class_enrollments"("clientId");

-- ─── session_attendance ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session_attendance" (
  "id"           TEXT NOT NULL,
  "sessionId"    TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "status"       "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "note"         TEXT,
  "scores"       JSONB NOT NULL DEFAULT '{}',
  "markedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "session_attendance_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "session_attendance_sessionId_enrollmentId_key"
  ON "session_attendance"("sessionId", "enrollmentId");
CREATE INDEX IF NOT EXISTS "session_attendance_sessionId_idx" ON "session_attendance"("sessionId");
CREATE INDEX IF NOT EXISTS "session_attendance_enrollmentId_idx" ON "session_attendance"("enrollmentId");

-- ─── Foreign keys (idempotent — safe to re-run on the shared DB) ─────────────
DO $$ BEGIN
  ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_classRunId_fkey"
    FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "class_runs" ADD CONSTRAINT "class_runs_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "class_runs" ADD CONSTRAINT "class_runs_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_classRunId_fkey"
    FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "class_enrollments" ADD CONSTRAINT "class_enrollments_dogId_fkey"
    FOREIGN KEY ("dogId") REFERENCES "dogs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "session_attendance" ADD CONSTRAINT "session_attendance_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "class_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
