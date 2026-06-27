-- Lead Magnets add-on: a downloadable freebie behind a branded public form,
-- and a per-trainer mailing list of email-only subscribers captured from it.

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('SUBSCRIBED', 'UNSUBSCRIBED', 'BOUNCED');

-- CreateTable
CREATE TABLE "lead_magnets" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "headline" TEXT,
    "intro" TEXT,
    "layout" TEXT NOT NULL DEFAULT 'classic',
    "imageUrl" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "consentText" TEXT NOT NULL DEFAULT 'I agree to receive emails and accept the privacy policy.',
    "emailSubject" TEXT,
    "emailIntro" TEXT,
    "thankYouTitle" TEXT,
    "thankYouMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_magnets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'SUBSCRIBED',
    "sourceLeadMagnetId" TEXT,
    "consentText" TEXT,
    "consentAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_magnets_trainerId_idx" ON "lead_magnets"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_magnets_trainerId_slug_key" ON "lead_magnets"("trainerId", "slug");

-- CreateIndex
CREATE INDEX "subscribers_trainerId_status_idx" ON "subscribers"("trainerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_trainerId_email_key" ON "subscribers"("trainerId", "email");

-- AddForeignKey
ALTER TABLE "lead_magnets" ADD CONSTRAINT "lead_magnets_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_sourceLeadMagnetId_fkey" FOREIGN KEY ("sourceLeadMagnetId") REFERENCES "lead_magnets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
