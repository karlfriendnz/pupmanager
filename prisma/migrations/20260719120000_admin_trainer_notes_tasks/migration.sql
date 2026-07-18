-- Super-admin internal notes + to-dos per trainer business (not visible to the
-- trainer). trainerId is a TrainerProfile.id (loosely coupled).

CREATE TABLE "admin_trainer_notes" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_trainer_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_trainer_notes_trainerId_createdAt_idx" ON "admin_trainer_notes"("trainerId", "createdAt");

CREATE TABLE "admin_trainer_tasks" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "admin_trainer_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_trainer_tasks_trainerId_done_createdAt_idx" ON "admin_trainer_tasks"("trainerId", "done", "createdAt");
