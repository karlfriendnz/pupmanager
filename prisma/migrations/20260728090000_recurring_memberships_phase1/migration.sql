-- Recurring client→trainer memberships, Phase 1: a client can subscribe to a
-- recurring plan and cancel it. The money is a Stripe Subscription on the
-- TRAINER'S connected account (direct charge), exactly like the existing one-off
-- checkout — not a home-made "charge them every month" cron.
--
-- Nothing here is destructive. MembershipPurchase.currentPeriodEnd and
-- committedUntil already existed and were dead columns; this migration adds the
-- rest of the recurring shape around them and starts writing all of it.
--
-- Table names are the @@map snake_case ones (membership_purchases, not
-- MembershipPurchase). Using the Prisma model names here fails `migrate deploy`
-- with 42P01 and takes the production build down with it.

-- ─── Rollout gate ───────────────────────────────────────────────────────────
-- The CONNECT_LIVE_ALLOWLIST env var is gone, so this column IS the allowlist:
-- off for everyone, flipped per trainer from the admin Businesses screen.
ALTER TABLE "trainer_profiles"
    ADD COLUMN "recurringPaymentsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ─── The client's Stripe Customer, per connected account ────────────────────
-- A Stripe Customer lives on exactly ONE account, so a client who trains with
-- two businesses has two unrelated Customers and enters their card twice.
-- ClientProfile already IS the (userId, trainerId) pair, so it is the right home.
ALTER TABLE "client_profiles"
    ADD COLUMN "stripeCustomerId"     TEXT,
    ADD COLUMN "stripeCustomerIdTest" TEXT;

-- ─── New purchase states ────────────────────────────────────────────────────
-- PAST_DUE: a payment failed and Stripe is still retrying; access continues.
-- CANCELLING: cancelled but paid up to currentPeriodEnd — a different sentence
-- on the client's screen from CANCELLED, which is why it is a different state.
-- Postgres 12+ allows ADD VALUE inside a transaction as long as the new label is
-- not USED in the same transaction — it isn't. IF NOT EXISTS keeps this a no-op
-- on a database where the type was already created with these labels.
ALTER TYPE "MembershipPurchaseStatus" ADD VALUE IF NOT EXISTS 'PAST_DUE';
ALTER TYPE "MembershipPurchaseStatus" ADD VALUE IF NOT EXISTS 'CANCELLING';
ALTER TYPE "MembershipPurchaseStatus" ADD VALUE IF NOT EXISTS 'PAUSED';

CREATE TYPE "MembershipInvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'UNCOLLECTIBLE', 'VOID');

-- ─── Cached Stripe Product/Price per plan, per mode ─────────────────────────
-- Stripe Prices are immutable: editing a plan's price nulls these so the next
-- sale mints a fresh Price, and everyone already subscribed keeps the Price they
-- actually agreed to. That is what stops a price edit re-pricing existing
-- subscribers behind their backs.
-- archivedAt: a plan that still has live subscribers is ARCHIVED rather than
-- deleted when the trainer edits the membership. It stops being sold, but the
-- row and its immutable Stripe Price survive so existing subscribers keep
-- billing on what they agreed to. Deleting it would strip planId off their
-- purchase and lose the price, term and interval they signed up for.
ALTER TABLE "membership_plans"
    ADD COLUMN "stripeProductId"     TEXT,
    ADD COLUMN "stripeProductIdTest" TEXT,
    ADD COLUMN "stripePriceId"       TEXT,
    ADD COLUMN "stripePriceIdTest"   TEXT,
    ADD COLUMN "archivedAt"          TIMESTAMP(3);

-- ─── The recurring fields on a purchase ─────────────────────────────────────
ALTER TABLE "membership_purchases"
    ADD COLUMN "planId"                TEXT,
    ADD COLUMN "stripeSubscriptionId"  TEXT,
    ADD COLUMN "stripeCustomerId"      TEXT,
    ADD COLUMN "currentPeriodStart"    TIMESTAMP(3),
    ADD COLUMN "cancelAtPeriodEnd"     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "cancelledAt"           TIMESTAMP(3),
    ADD COLUMN "cancelReason"          TEXT,
    ADD COLUMN "lastPaymentFailedAt"   TIMESTAMP(3),
    ADD COLUMN "failedPaymentCount"    INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "applicationFeePercent" DECIMAL(5,2);

-- Unique so a replayed webhook or a double-tapped Subscribe can never produce
-- two purchase rows for one Stripe subscription — the database refuses it even
-- if a guard upstream is wrong.
CREATE UNIQUE INDEX "membership_purchases_stripeSubscriptionId_key"
    ON "membership_purchases"("stripeSubscriptionId");
CREATE INDEX "membership_purchases_planId_idx"  ON "membership_purchases"("planId");
CREATE INDEX "membership_purchases_status_idx"  ON "membership_purchases"("status");

ALTER TABLE "membership_purchases" ADD CONSTRAINT "membership_purchases_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "membership_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Consent ────────────────────────────────────────────────────────────────
-- Written BEFORE the Stripe redirect, so a consent always exists for any
-- subscription that can come into being. consentText is verbatim on purpose: in
-- a dispute, "here is exactly what they were shown" beats "our template said X".
CREATE TABLE "membership_consents" (
    "id"                   TEXT NOT NULL,
    "clientId"             TEXT NOT NULL,
    "membershipId"         TEXT NOT NULL,
    "planId"               TEXT,
    "priceCents"           INTEGER NOT NULL,
    "currency"             TEXT NOT NULL,
    "interval"             "MembershipInterval" NOT NULL,
    "consentText"          TEXT NOT NULL,
    "consentVersion"       TEXT NOT NULL,
    "stripeMandateId"      TEXT,
    "stripeSubscriptionId" TEXT,
    "ipAddress"            TEXT,
    "userAgent"            TEXT,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_consents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "membership_consents_clientId_idx"     ON "membership_consents"("clientId");
CREATE INDEX "membership_consents_membershipId_idx" ON "membership_consents"("membershipId");
CREATE INDEX "membership_consents_stripeSubscriptionId_idx"
    ON "membership_consents"("stripeSubscriptionId");

ALTER TABLE "membership_consents" ADD CONSTRAINT "membership_consents_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_consents" ADD CONSTRAINT "membership_consents_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── One row per billing cycle ──────────────────────────────────────────────
-- stripeInvoiceId is UNIQUE — that natural key is idempotency layer 2 for the
-- invoice.* handlers (layer 1 is the event ledger below, layer 3 is the re-check
-- inside the fulfilment transaction).
CREATE TABLE "membership_invoices" (
    "id"                   TEXT NOT NULL,
    "membershipPurchaseId" TEXT NOT NULL,
    "stripeInvoiceId"      TEXT NOT NULL,
    "periodStart"          TIMESTAMP(3),
    "periodEnd"            TIMESTAMP(3),
    "amountDue"            INTEGER NOT NULL,
    "amountPaid"           INTEGER NOT NULL DEFAULT 0,
    "currency"             TEXT NOT NULL,
    "status"               "MembershipInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "hostedInvoiceUrl"     TEXT,
    "attemptCount"         INTEGER NOT NULL DEFAULT 0,
    "paymentId"            TEXT,
    "sandbox"              BOOLEAN NOT NULL DEFAULT false,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "membership_invoices_stripeInvoiceId_key"
    ON "membership_invoices"("stripeInvoiceId");
CREATE INDEX "membership_invoices_membershipPurchaseId_idx"
    ON "membership_invoices"("membershipPurchaseId");
CREATE INDEX "membership_invoices_paymentId_idx" ON "membership_invoices"("paymentId");

ALTER TABLE "membership_invoices" ADD CONSTRAINT "membership_invoices_membershipPurchaseId_fkey"
    FOREIGN KEY ("membershipPurchaseId") REFERENCES "membership_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── Webhook idempotency ledger ─────────────────────────────────────────────
-- Keyed on Stripe's own event id. The existing PENDING→PAID transition stops
-- double-FULFILMENT but not a re-delivered invoice.paid creating a second
-- Payment row. Insert-or-skip at the top of the handler is the only thing that
-- reliably stops replays — and it protects the existing one-off flow too.
CREATE TABLE "stripe_webhook_events" (
    "id"          TEXT NOT NULL,
    "type"        TEXT NOT NULL,
    "accountId"   TEXT,
    "sandbox"     BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stripe_webhook_events_type_idx"      ON "stripe_webhook_events"("type");
CREATE INDEX "stripe_webhook_events_accountId_idx" ON "stripe_webhook_events"("accountId");

-- ─── Backfill: every RECURRING membership gets a plan row ───────────────────
-- A recurring Membership can carry its price/interval directly (no
-- MembershipPlan rows) OR offer several plans. Two shapes means two code paths
-- through the money, so instead we give the direct-price ones a plan row and let
-- MembershipPlan be the ONLY thing a subscription is ever sold against.
-- gen_random_uuid() is pgcrypto/PG13+ builtin; ids elsewhere are cuids but
-- nothing parses them, and these rows are only ever referenced by id.
INSERT INTO "membership_plans" ("id", "membershipId", "interval", "priceCents", "minTermCount", "earlyTermFeeCents", "order")
SELECT
    gen_random_uuid()::TEXT,
    m."id",
    COALESCE(m."interval", 'MONTH'::"MembershipInterval"),
    m."priceCents",
    m."minTermCount",
    m."earlyTermFeeCents",
    0
FROM "memberships" m
WHERE m."cadence" = 'RECURRING'
  AND NOT EXISTS (SELECT 1 FROM "membership_plans" p WHERE p."membershipId" = m."id");
