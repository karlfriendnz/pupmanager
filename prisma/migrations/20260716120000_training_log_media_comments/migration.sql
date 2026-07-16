-- Photos on a client's practice log + a trainer's reply-back comment. Column
-- additions target the @@map snake_case table (training_logs), not the model
-- name. imageUrls mirrors training_tasks.imageUrls (a JSON string[]).
ALTER TABLE "training_logs"
    ADD COLUMN "imageUrls" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "trainerComment" TEXT,
    ADD COLUMN "trainerCommentAt" TIMESTAMP(3);

-- New notification types. Postgres can't add an enum value and use it in the
-- same transaction, so these ADDs live alone in this file and are only
-- referenced from later migrations / runtime code.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_LOGGED_TRAINING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRAINER_COMMENTED_LOG';
