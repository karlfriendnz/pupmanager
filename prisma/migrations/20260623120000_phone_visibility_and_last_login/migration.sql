-- Trainer phone is a single field, shown to clients only when they opt in.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "showPhoneToClients" BOOLEAN NOT NULL DEFAULT false;

-- Preserve current behaviour: a phone set before this flag existed was shown to
-- clients unconditionally, so keep it visible for those accounts.
UPDATE "trainer_profiles" SET "showPhoneToClients" = true WHERE "phone" IS NOT NULL;

-- Most recent successful sign-in, written by the NextAuth signIn event and
-- shown in the admin trainers table as "Last seen".
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
