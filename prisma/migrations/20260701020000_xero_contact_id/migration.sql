-- Phase 2 of the Xero integration: the matching Xero Contact id per client,
-- once synced to the trainer's org. Scoped naturally to the (userId, trainerId)
-- client relationship — the same person maps to a different contact per trainer.

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN "xeroContactId" TEXT;
