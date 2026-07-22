-- Per-form auto-reply: email the person who filled in the form, on submit.
--
-- Hand-written rather than generated: `migrate diff` against this machine's dev
-- DB also wanted to drop the unified-Form tables (`forms`, plus the intake /
-- formAnswers columns), which exist locally only because the dev DB was pushed
-- from the `main` branch. Those are unrelated to this change and must not ride
-- along. Table names are the @@map snake_case ones, not the model names.

-- AlterTable
ALTER TABLE "embed_forms" ADD COLUMN     "autoReplyBody" TEXT,
ADD COLUMN     "autoReplyMode" TEXT NOT NULL DEFAULT 'OFF',
ADD COLUMN     "autoReplySubject" TEXT,
ADD COLUMN     "autoReplyTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "embed_forms" ADD CONSTRAINT "embed_forms_autoReplyTemplateId_fkey" FOREIGN KEY ("autoReplyTemplateId") REFERENCES "email_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
