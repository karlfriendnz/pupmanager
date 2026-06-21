-- Surcharge clients for the card processing fee instead of the trainer
-- absorbing it. On by default (existing trainers get true); trainers can opt
-- out. Idempotent so it's safe whether or not the column was added out-of-band.
ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "passProcessingFeeToClient" BOOLEAN NOT NULL DEFAULT true;
