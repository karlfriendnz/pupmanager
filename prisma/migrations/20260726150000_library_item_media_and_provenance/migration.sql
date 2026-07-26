-- Library items can now carry one image and one attached document (PDF), both
-- stored in Vercel Blob. Nullable, so every existing item is unchanged.
-- Table names are the @@map'd snake_case ones.
ALTER TABLE "library_tasks" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "library_tasks" ADD COLUMN "fileUrl" TEXT;
ALTER TABLE "library_tasks" ADD COLUMN "fileName" TEXT;

-- Provenance link from a handed-out homework task back to the library item it
-- was created from. Homework stays a snapshot (title/description are still
-- copied); this only lets the library item show who currently has it. ON DELETE
-- SET NULL so deleting a library item never destroys a client's homework.
ALTER TABLE "training_tasks" ADD COLUMN "libraryTaskId" TEXT;
CREATE INDEX "training_tasks_libraryTaskId_idx" ON "training_tasks"("libraryTaskId");
ALTER TABLE "training_tasks"
  ADD CONSTRAINT "training_tasks_libraryTaskId_fkey"
  FOREIGN KEY ("libraryTaskId") REFERENCES "library_tasks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
