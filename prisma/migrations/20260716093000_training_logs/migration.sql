-- Client practice log for homework tasks. MANY rows per training_tasks row:
-- the client logs each time they practise, building a progress history. Table
-- name is the @@map snake_case one (training_logs); the FK targets training_tasks
-- (the @@map name of TrainingTask), not the model name — a model-name reference
-- fails 42P01 on deploy.
CREATE TABLE "training_logs" (
    "id"        TEXT NOT NULL,
    "taskId"    TEXT NOT NULL,
    "loggedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note"      TEXT,
    "repsDone"  INTEGER,
    "rating"    INTEGER,
    "videoUrl"  TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "training_logs_taskId_idx" ON "training_logs"("taskId");

ALTER TABLE "training_logs"
    ADD CONSTRAINT "training_logs_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "training_tasks"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
