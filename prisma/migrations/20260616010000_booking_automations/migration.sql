-- CreateEnum
CREATE TYPE "BookingAutomationTrigger" AS ENUM ('ON_BOOKING', 'BEFORE_SESSION', 'AFTER_SESSION');

-- AlterTable
ALTER TABLE "booking_requests" ADD COLUMN     "bookingPageId" TEXT;

-- AlterTable
ALTER TABLE "training_sessions" ADD COLUMN     "bookingPageId" TEXT;

-- CreateTable
CREATE TABLE "booking_automations" (
    "id" TEXT NOT NULL,
    "bookingPageId" TEXT NOT NULL,
    "trigger" "BookingAutomationTrigger" NOT NULL,
    "offsetMinutes" INTEGER NOT NULL DEFAULT 1440,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "booking_automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_automation_sends" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_automation_sends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "booking_automations_bookingPageId_idx" ON "booking_automations"("bookingPageId");

-- CreateIndex
CREATE INDEX "booking_automation_sends_sessionId_idx" ON "booking_automation_sends"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "booking_automation_sends_automationId_sessionId_key" ON "booking_automation_sends"("automationId", "sessionId");

-- CreateIndex
CREATE INDEX "training_sessions_bookingPageId_idx" ON "training_sessions"("bookingPageId");

-- AddForeignKey
ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_bookingPageId_fkey" FOREIGN KEY ("bookingPageId") REFERENCES "booking_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_automations" ADD CONSTRAINT "booking_automations_bookingPageId_fkey" FOREIGN KEY ("bookingPageId") REFERENCES "booking_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_automation_sends" ADD CONSTRAINT "booking_automation_sends_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "booking_automations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_automation_sends" ADD CONSTRAINT "booking_automation_sends_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

