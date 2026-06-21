-- Trainer opt-in to surcharge clients for the card processing fee instead of
-- absorbing it. Idempotent so it's safe whether or not the column was added
-- out-of-band during development.
ALTER TABLE "TrainerProfile" ADD COLUMN IF NOT EXISTS "passProcessingFeeToClient" BOOLEAN NOT NULL DEFAULT false;
