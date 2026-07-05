-- "Require payment to book" — per-item override + a trainer-level default.
--
-- Each priced package / class / product can be forced to pay-to-book (Stripe up
-- front) or book-now-pay-later (raise an invoice). NULL on an item = inherit the
-- trainer's default. The trainer default backfills to TRUE so existing behaviour
-- (priced item + payments on ⇒ pay-to-book) is preserved.

ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "requirePayment" BOOLEAN;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "requirePayment" BOOLEAN;
ALTER TABLE "class_runs" ADD COLUMN IF NOT EXISTS "requirePayment" BOOLEAN;

ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "defaultRequirePayment" BOOLEAN NOT NULL DEFAULT true;
