-- One payment can settle MANY invoices.
--
-- `invoices.paymentId` was UNIQUE, which said "a payment settles exactly one
-- invoice". That was never true: a client booking four drop-in dates, or two
-- dogs onto one class, pays once and gets one receivable per seat. The first
-- invoice claimed the payment and every later update failed the constraint —
-- inside settleInvoiceFromPayment's catch, so it failed silently and those
-- invoices sat on "Sent" while the money was in the bank.
--
-- Dropping a unique index cannot fail on existing data (it only ever removes a
-- restriction), so this is safe to run against a live table. The plain index
-- that replaces it keeps "find the invoices this payment settled" fast.

DROP INDEX IF EXISTS "invoices_paymentId_key";

CREATE INDEX IF NOT EXISTS "invoices_paymentId_idx" ON "invoices"("paymentId");
