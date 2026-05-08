-- Track invoiced-state independently from completion status. Backfill rows
-- that were previously flagged INVOICED via the status enum so the UI keeps
-- showing them as invoiced.
ALTER TABLE "training_sessions" ADD COLUMN "invoicedAt" TIMESTAMP(3);
UPDATE "training_sessions" SET "invoicedAt" = "updatedAt" WHERE "status" = 'INVOICED';
