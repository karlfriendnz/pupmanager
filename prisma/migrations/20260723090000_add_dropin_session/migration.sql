-- Single-session drop-ins: a DROP_IN enrolment is for ONE specific session
-- (flat per-session price, per-session capacity, appears on that session's
-- roster only). FULL enrolments leave this null and attend every session.
-- Hand-written; @@map snake_case table + FK name.

-- AlterTable
ALTER TABLE "class_enrollments" ADD COLUMN "dropInSessionId" TEXT;

-- CreateIndex
CREATE INDEX "class_enrollments_dropInSessionId_idx" ON "class_enrollments"("dropInSessionId");

-- AddForeignKey
ALTER TABLE "class_enrollments"
  ADD CONSTRAINT "class_enrollments_dropInSessionId_fkey"
  FOREIGN KEY ("dropInSessionId") REFERENCES "training_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
