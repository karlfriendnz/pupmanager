-- Unified forms: one authored questionnaire model (`forms`) that can act as a
-- client intake form and/or a public website enquiry form.
--
-- Dated 20260727230000 deliberately. The original of this change was written on
-- feature/forms as 20260719140000, which now sorts BEFORE ~40 migrations that
-- landed on this branch afterwards; replaying it at that timestamp would put
-- `prisma migrate deploy` out of order. Production has never seen either
-- version, so there is nothing to preserve — this is a fresh, correctly-ordered
-- statement of the same schema.
--
-- Table names are the @@map snake_case ones (forms, client_profiles, enquiries,
-- trainer_profiles) — model names here fail 42P01 at deploy and break the build.

-- CreateTable
CREATE TABLE "forms" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "usableAsIntake" BOOLEAN NOT NULL DEFAULT false,
    "usableAsEnquiry" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "questions" JSONB NOT NULL DEFAULT '[]',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "thankYouTitle" TEXT,
    "thankYouMessage" TEXT,
    "showBorder" BOOLEAN NOT NULL DEFAULT true,
    "buttonColor" TEXT,
    "inviteSubject" TEXT,
    "inviteBody" TEXT,
    "inviteShowDiaryButton" BOOLEAN NOT NULL DEFAULT true,
    "inviteButtonLabel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forms_trainerId_idx" ON "forms"("trainerId");

-- CreateIndex
CREATE UNIQUE INDEX "forms_trainerId_slug_key" ON "forms"("trainerId", "slug");

-- AddForeignKey
ALTER TABLE "forms" ADD CONSTRAINT "forms_trainerId_fkey"
    FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: the intake Form assigned to a client, and their answers.
-- Nullable throughout, so every existing client is ungated by default.
ALTER TABLE "client_profiles"
    ADD COLUMN "intakeFormId" TEXT,
    ADD COLUMN "intakeCompletedAt" TIMESTAMP(3),
    ADD COLUMN "intakeAnswers" JSONB;

-- AddForeignKey
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_intakeFormId_fkey"
    FOREIGN KEY ("intakeFormId") REFERENCES "forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: let a unified Form act as the source of an enquiry, alongside the
-- legacy EmbedForm (`formId`), which stays live.
ALTER TABLE "enquiries"
    ADD COLUMN "unifiedFormId" TEXT,
    ADD COLUMN "formAnswers" JSONB;

-- AddForeignKey
ALTER TABLE "enquiries" ADD CONSTRAINT "enquiries_unifiedFormId_fkey"
    FOREIGN KEY ("unifiedFormId") REFERENCES "forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
