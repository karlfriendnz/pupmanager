-- Trainer-configurable client cancellation fee.
--
-- cancellationFeeCents        — the fee amount in the trainer's payout-currency
--                               minor units. NULL or 0 = no cancellation fee.
-- cancellationFeeWindowHours  — the fee only applies to a client cancellation
--                               made within this many hours of the session start
--                               (a "late cancellation" window). NULL = the fee
--                               applies to ANY cancellation when a fee is set.
--
-- Table name is the @@map snake_case one (trainer_profiles), NOT the Prisma
-- model name — a model-name migration fails 42P01 on deploy.
ALTER TABLE "trainer_profiles"
  ADD COLUMN "cancellationFeeCents"       INTEGER,
  ADD COLUMN "cancellationFeeWindowHours" INTEGER;
