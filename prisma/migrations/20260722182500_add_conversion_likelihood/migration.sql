-- Internal "how likely are they to convert" judgement, set by hand from the
-- Likely column on /admin/trainers. Nullable: null = not assessed yet.
-- Hand-written (see 20260722170219 for why `migrate diff` isn't used here).

-- AlterTable
ALTER TABLE "trainer_profiles" ADD COLUMN     "conversionLikelihood" TEXT;
