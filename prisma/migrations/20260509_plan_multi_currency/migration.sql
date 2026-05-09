-- Per-currency Stripe Price IDs on each SubscriptionPlan. Shape:
--   { "AUD": "price_…", "USD": "price_…", … }
-- Empty {} default so existing rows don't break — the checkout flow
-- falls back to the single stripePriceId column (treated as NZD) when
-- the chosen currency isn't in the map.

ALTER TABLE "subscription_plans"
  ADD COLUMN IF NOT EXISTS "stripePriceIdsByCurrency" JSONB NOT NULL DEFAULT '{}'::jsonb;
