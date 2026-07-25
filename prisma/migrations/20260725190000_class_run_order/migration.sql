-- Trainer-arranged display order for class runs (group classes, casual classes,
-- events). Table name is the @@map'd snake_case one — using the model name here
-- fails 42P01 on deploy and breaks the build.
ALTER TABLE "class_runs" ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;
