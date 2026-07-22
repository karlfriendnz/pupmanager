-- When a business first became a paying customer (subscription went ACTIVE).
-- Doubles as the idempotency guard for the internal conversion alert.
-- Hand-written; table name is the @@map snake_case one.

-- AlterTable
ALTER TABLE "trainer_profiles" ADD COLUMN     "convertedAt" TIMESTAMP(3);

-- Backfill anyone ALREADY paying, so they don't trigger a spurious "just
-- converted" alert on their next customer.subscription.updated event. Their
-- real conversion date isn't recoverable here, so use updatedAt as the best
-- available approximation — the column's job from now on is the idempotency
-- guard, and a non-null value is what matters.
UPDATE "trainer_profiles"
   SET "convertedAt" = COALESCE("updatedAt", now())
 WHERE "subscriptionStatus" = 'ACTIVE'
   AND "convertedAt" IS NULL;
