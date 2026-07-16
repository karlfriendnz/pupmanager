-- Stripe clearing-account model for Xero.
--
-- Stripe direct charges never pay the gross into the trainer's bank: Stripe
-- deducts its processing fee AND our application fee first. Posting payments
-- straight to the bank account therefore never reconciles against the bank feed.
--
-- Card payments now post to a Stripe CLEARING account (a Xero Type=BANK account),
-- with the two fees written out of it as SPEND bank transactions and a client-paid
-- card surcharge RECEIVEd into it as income. Stripe's payout then reconciles in
-- the bank feed as a clearing → bank transfer, to the cent.
--
-- NOTE: table names are the @@map snake_case ones (xero_connections / payments),
-- NOT the Prisma model names — a model-name migration fails 42P01 on deploy.

-- Account mapping the clearing model needs.
ALTER TABLE "xero_connections"
  ADD COLUMN "clearingAccountCode"  TEXT,
  ADD COLUMN "clearingAccountName"  TEXT,
  ADD COLUMN "feeAccountCode"       TEXT,
  ADD COLUMN "surchargeAccountCode" TEXT;

-- Idempotency ids for the three clearing-account bank transactions.
ALTER TABLE "payments"
  ADD COLUMN "xeroSurchargeTxnId"   TEXT,
  ADD COLUMN "xeroFeeTxnId"         TEXT,
  ADD COLUMN "xeroPlatformFeeTxnId" TEXT;
