-- The in-app review widget's comments (model ReviewComment).
--
-- Hand-written: `migrate diff` against this dev database picks up unrelated
-- drift and would emit DROP TABLEs for it, and the ledger-diff path wants a
-- shadow database this repo doesn't configure. One table with a self-referencing
-- FK is small enough to state directly.
--
-- Table name is the @@map value (snake_case), not the model name — a migration
-- naming the model fails 42P01 on deploy and takes the build with it.
-- Idempotent so a re-run (or an environment that already has it) is a no-op.

CREATE TABLE IF NOT EXISTS "review_comments" (
    "id" TEXT NOT NULL,
    "pageKey" TEXT NOT NULL,
    "seq" INTEGER,
    "body" TEXT NOT NULL,
    "authorName" TEXT,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "context" JSONB,
    "attachments" JSONB,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "readyAt" TIMESTAMP(3),
    "queuedAt" TIMESTAMP(3),
    "claudeStatus" TEXT,
    "claudeNote" TEXT,
    "claudeAt" TIMESTAMP(3),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "review_comments_pageKey_idx" ON "review_comments"("pageKey");
CREATE INDEX IF NOT EXISTS "review_comments_resolved_idx" ON "review_comments"("resolved");
CREATE INDEX IF NOT EXISTS "review_comments_parentId_idx" ON "review_comments"("parentId");

-- A reply is deleted with its parent: it is a clarification, and on its own it
-- says nothing. Guarded so a re-run doesn't fail on the existing constraint.
DO $$
BEGIN
  ALTER TABLE "review_comments"
    ADD CONSTRAINT "review_comments_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "review_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
