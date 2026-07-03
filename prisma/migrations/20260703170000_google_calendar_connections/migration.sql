-- Google Calendar integration: per-STAFF-MEMBER, one-way sync (PupManager → the
-- member's own Google Calendar) + busy import (Google → PupManager) for soft
-- double-booking warnings. Connections are keyed by the individual's
-- trainer_memberships row, NOT the company. Additive to the rest of the schema;
-- the legacy per-trainer token columns on trainer_profiles are left in place.

-- CreateTable: per-member connection
CREATE TABLE "google_calendar_connections" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "calendarId" TEXT NOT NULL DEFAULT 'primary',
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "google_calendar_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "google_calendar_connections_membershipId_key" ON "google_calendar_connections"("membershipId");
CREATE INDEX "google_calendar_connections_companyId_idx" ON "google_calendar_connections"("companyId");

-- AddForeignKey
ALTER TABLE "google_calendar_connections" ADD CONSTRAINT "google_calendar_connections_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "trainer_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: imported busy times (delete + reinsert window per member)
CREATE TABLE "google_busy_blocks" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_busy_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "google_busy_blocks_membershipId_startsAt_idx" ON "google_busy_blocks"("membershipId", "startsAt");

-- AddForeignKey
ALTER TABLE "google_busy_blocks" ADD CONSTRAINT "google_busy_blocks_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "trainer_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Event-id back-references so updates/deletes can find and remove the mirrored
-- Google event. (training_sessions.googleCalendarEventId already exists.)
ALTER TABLE "availability_slots" ADD COLUMN "googleEventId" TEXT;
ALTER TABLE "blackout_periods" ADD COLUMN "googleEventId" TEXT;
