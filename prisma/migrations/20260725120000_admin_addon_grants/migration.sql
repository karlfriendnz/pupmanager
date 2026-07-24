-- Admin comp grants: free add-on previews with an optional expiry.
-- Columns are camelCase (Prisma default, matching the existing
-- "stripeSubscriptionItemId" column); table is @@map'd to trainer_addons.
ALTER TABLE "trainer_addons"
  ADD COLUMN "grantedByAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "expiryReminderSentAt" TIMESTAMP(3);
