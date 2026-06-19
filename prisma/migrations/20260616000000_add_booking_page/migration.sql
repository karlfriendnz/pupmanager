-- AlterTable
ALTER TABLE "enquiries" ADD COLUMN     "bookedPackageId" TEXT,
ADD COLUMN     "bookedPageId" TEXT,
ADD COLUMN     "bookedSlotAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "booking_pages" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Book a session',
    "order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "headline" TEXT,
    "intro" TEXT,
    "slotLengthMins" INTEGER NOT NULL DEFAULT 60,
    "slotIntervalMins" INTEGER NOT NULL DEFAULT 60,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "minNoticeHours" INTEGER NOT NULL DEFAULT 12,
    "windowDays" INTEGER NOT NULL DEFAULT 28,
    "packageId" TEXT,
    "sessionType" "SessionType" NOT NULL DEFAULT 'IN_PERSON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_pages_trainerId_idx" ON "booking_pages"("trainerId");

-- CreateIndex
CREATE INDEX "booking_pages_packageId_idx" ON "booking_pages"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_pages_trainerId_slug_key" ON "booking_pages"("trainerId", "slug");

-- AddForeignKey
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_pages" ADD CONSTRAINT "booking_pages_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

