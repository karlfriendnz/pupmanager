-- Platform announcements authored by a super-admin in the (admin) area. This is
-- the editable source of truth + history; broadcasting an announcement fans out
-- one Notification row per recipient User (the bell reads Notification).

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'SENT');

-- CreateEnum
CREATE TYPE "AnnouncementAudience" AS ENUM ('ALL_TRAINERS');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'ALL_TRAINERS',
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_status_createdAt_idx" ON "announcements"("status", "createdAt");
