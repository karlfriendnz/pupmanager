-- Rich-text (HTML) bodies for editor-composed emails, and platform-wide email templates.

-- AlterTable: enquiry reply messages keep a sanitized HTML body alongside plain text.
ALTER TABLE "enquiry_messages" ADD COLUMN "bodyHtml" TEXT;

-- AlterTable: client messages can carry a sanitized HTML body (e.g. logged emails).
ALTER TABLE "messages" ADD COLUMN "bodyHtml" TEXT;

-- AlterTable: notification body override may now hold HTML (EMAIL channel) — widen to TEXT.
ALTER TABLE "notification_preferences" ALTER COLUMN "customBody" SET DATA TYPE TEXT;

-- CreateTable: trainer-owned, reusable email templates the trainer composes from.
CREATE TABLE "email_templates" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_templates_trainerId_sortOrder_idx" ON "email_templates"("trainerId", "sortOrder");

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
