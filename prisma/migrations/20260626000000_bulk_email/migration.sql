-- AlterTable: trainer sending domain (Resend) for bulk email
ALTER TABLE "trainer_profiles"
  ADD COLUMN     "sendingDomain" TEXT,
  ADD COLUMN     "resendDomainId" TEXT,
  ADD COLUMN     "sendingFromEmail" TEXT,
  ADD COLUMN     "domainVerifiedAt" TIMESTAMP(3);

-- AlterTable: per-relationship marketing/bulk email opt-out
ALTER TABLE "client_profiles"
  ADD COLUMN     "marketingEmailOptOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "marketingOptOutAt" TIMESTAMP(3),
  ADD COLUMN     "marketingOptOutReason" TEXT;

-- CreateTable
CREATE TABLE "email_broadcasts" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_broadcast_recipients" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "clientProfileId" TEXT,
    "email" TEXT NOT NULL,
    "resendEmailId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "complainedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_broadcast_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trainer_profiles_resendDomainId_key" ON "trainer_profiles"("resendDomainId");

-- CreateIndex
CREATE INDEX "email_broadcasts_trainerId_createdAt_idx" ON "email_broadcasts"("trainerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_broadcast_recipients_resendEmailId_key" ON "email_broadcast_recipients"("resendEmailId");

-- CreateIndex
CREATE INDEX "email_broadcast_recipients_broadcastId_idx" ON "email_broadcast_recipients"("broadcastId");

-- AddForeignKey
ALTER TABLE "email_broadcasts" ADD CONSTRAINT "email_broadcasts_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_broadcast_recipients" ADD CONSTRAINT "email_broadcast_recipients_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "email_broadcasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
