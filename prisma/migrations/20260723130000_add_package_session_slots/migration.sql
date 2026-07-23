-- Drop-in class schedule slots. A drop-in offering is a LIST of slots ("Tuesdays
-- 3-5pm at the park, $25, 8 spaces") rather than one (sessionCount x weeksBetween)
-- cadence, because each slot prices, caps, staffs and locates itself. Expanding a
-- slot's recurrenceRule generates the actual training_sessions.
-- Hand-written; @@map snake_case table + FK names.

-- CreateTable
CREATE TABLE "package_session_slots" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3),
    "day" INTEGER NOT NULL DEFAULT 1,
    "startTime" TEXT NOT NULL DEFAULT '15:00',
    "endTime" TEXT NOT NULL DEFAULT '17:00',
    "gapMins" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "priceCents" INTEGER,
    "specialPriceCents" INTEGER,
    "xeroAccountCode" TEXT,
    "requirePayment" BOOLEAN NOT NULL DEFAULT false,
    "locationId" TEXT,
    "recurrenceRule" TEXT,
    "assignedMembershipIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_session_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_session_slots_packageId_idx" ON "package_session_slots"("packageId");

-- CreateIndex
CREATE INDEX "package_session_slots_locationId_idx" ON "package_session_slots"("locationId");

-- AddForeignKey
ALTER TABLE "package_session_slots"
  ADD CONSTRAINT "package_session_slots_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "packages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_session_slots"
  ADD CONSTRAINT "package_session_slots_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Link each generated session back to the slot that priced it. SET NULL (not
-- CASCADE): re-editing a class's schedule must never delete sessions that are
-- already in the diary.
-- AlterTable
ALTER TABLE "training_sessions" ADD COLUMN "packageSessionSlotId" TEXT;

-- CreateIndex
CREATE INDEX "training_sessions_packageSessionSlotId_idx" ON "training_sessions"("packageSessionSlotId");

-- AddForeignKey
ALTER TABLE "training_sessions"
  ADD CONSTRAINT "training_sessions_packageSessionSlotId_fkey"
  FOREIGN KEY ("packageSessionSlotId") REFERENCES "package_session_slots"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
