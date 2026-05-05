-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'ACCEPTED', 'DECLINED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "formId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "dogName" TEXT,
    "dogBreed" TEXT,
    "dogWeight" DOUBLE PRECISION,
    "dogDob" TIMESTAMP(3),
    "message" TEXT,
    "customFieldValues" JSONB NOT NULL DEFAULT '{}',
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "viewedAt" TIMESTAMP(3),
    "clientProfileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_messages" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUTBOUND',
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "sentByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enquiries_clientProfileId_key" ON "enquiries"("clientProfileId");

-- CreateIndex
CREATE INDEX "enquiries_trainerId_status_idx" ON "enquiries"("trainerId", "status");

-- CreateIndex
CREATE INDEX "enquiries_trainerId_createdAt_idx" ON "enquiries"("trainerId", "createdAt");

-- CreateIndex
CREATE INDEX "enquiry_messages_enquiryId_createdAt_idx" ON "enquiry_messages"("enquiryId", "createdAt");

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_formId_fkey" FOREIGN KEY ("formId") REFERENCES "embed_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_clientProfileId_fkey" FOREIGN KEY ("clientProfileId") REFERENCES "client_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_messages" ADD CONSTRAINT "enquiry_messages_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "enquiries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
