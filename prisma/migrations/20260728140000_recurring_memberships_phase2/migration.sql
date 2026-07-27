-- Recurring memberships, Phase 2: the failure surface.
--
-- The headline decision this encodes (Karl, 2026-07-27): access stops on the
-- FIRST failed payment, not after Stripe exhausts its ~4 retries. Stripe keeps
-- retrying underneath, so a retry that succeeds has to restore everything —
-- which means a paused grant must be RECOVERABLE, never deleted. Hence
-- suspendedAt timestamps rather than removing rows.
--
-- Table names are the @@map snake_case ones. Using the Prisma model names here
-- fails `migrate deploy` with 42P01 and takes the production build down.

-- ─── The trainer left ───────────────────────────────────────────────────────
-- ORPHANED is deliberately distinct from CANCELLED: the CLIENT did not choose
-- this, and the wording they see must not imply they did.
-- Postgres 12+ allows ADD VALUE inside a transaction as long as the new label is
-- not USED in the same transaction — it isn't.
ALTER TYPE "MembershipPurchaseStatus" ADD VALUE IF NOT EXISTS 'ORPHANED';

ALTER TABLE "trainer_profiles"
    ADD COLUMN "connectDeauthorizedAt" TIMESTAMP(3);

-- ─── Which card, and when access was paused ─────────────────────────────────
-- The card snapshot is so a client can be told exactly WHICH card needs
-- attention ("your card ending 4242 expires before your next payment"). Never
-- the full number — these four are all Stripe itself exposes.
ALTER TABLE "membership_purchases"
    ADD COLUMN "cardBrand"        TEXT,
    ADD COLUMN "cardLast4"        TEXT,
    ADD COLUMN "cardExpMonth"     INTEGER,
    ADD COLUMN "cardExpYear"      INTEGER,
    ADD COLUMN "accessPausedAt"   TIMESTAMP(3),
    ADD COLUMN "accessRestoredAt" TIMESTAMP(3);

-- The bank demanded authentication on a renewal (3DS/SCA off-session). Nothing
-- in the app can act for the client — the payment does not happen until they tap
-- through to Stripe's hosted page — so this is a first-class field, not just
-- another failure.
ALTER TABLE "membership_invoices"
    ADD COLUMN "actionRequiredAt" TIMESTAMP(3);

-- ─── Pausable grants ────────────────────────────────────────────────────────
-- membershipPurchaseId ties a granted assignment/seat back to the plan that paid
-- for it, so a failed payment can find exactly what to pause.
--
-- suspendedAt is a reversible timestamp, NOT a delete and NOT a withdrawal. A
-- withdrawal frees a class place for the next person on the waitlist, which
-- cannot be undone — and a client whose card is replaced two days later must get
-- their own seat back, not find it sold.
ALTER TABLE "client_packages"
    ADD COLUMN "membershipPurchaseId" TEXT,
    ADD COLUMN "suspendedAt"          TIMESTAMP(3);

ALTER TABLE "class_enrollments"
    ADD COLUMN "membershipPurchaseId" TEXT,
    ADD COLUMN "suspendedAt"          TIMESTAMP(3);

CREATE INDEX "client_packages_membershipPurchaseId_idx"
    ON "client_packages"("membershipPurchaseId");
CREATE INDEX "class_enrollments_membershipPurchaseId_idx"
    ON "class_enrollments"("membershipPurchaseId");
