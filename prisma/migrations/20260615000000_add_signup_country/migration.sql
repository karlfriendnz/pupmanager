-- Country of signup (ISO 3166-1 alpha-2), captured from the request IP geo
-- (Vercel x-vercel-ip-country) at account creation. Surfaced as a flag in
-- /admin/trainers.
ALTER TABLE "trainer_profiles" ADD COLUMN "signupCountry" TEXT;

-- One-time backfill of the existing cohort: all New Zealand except Summit
-- (Australia). New signups get their country from the capture code going forward.
UPDATE "trainer_profiles" SET "signupCountry" = 'NZ' WHERE "signupCountry" IS NULL;
UPDATE "trainer_profiles" SET "signupCountry" = 'AU' WHERE "businessName" ILIKE '%Summit%';
