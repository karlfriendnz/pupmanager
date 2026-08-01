-- Package eligibility: WHO a package is for, as distinct from whether it can be
-- paid for.
--
-- The motivating case is a ladder — a junior client should not be able to buy
-- their way into a senior package. So the gate is a PREREQUISITE (something
-- already achieved) rather than a permission, which is why it is checked only
-- at the point of joining: raising the bar later must never evict someone who
-- is already paying.
--
-- Every default here is chosen so that EXISTING rows keep behaving exactly as
-- they do today: eligibility PUBLIC (anyone), showWhenLocked true (nothing
-- disappears from a storefront on deploy).
--
-- Table names are the @@map snake_case ones (memberships, achievements,
-- membership_prerequisites). Prisma MODEL names would fail 42P01 under
-- `migrate deploy` and take the production build down.

-- CreateEnum
CREATE TYPE "MembershipEligibility" AS ENUM ('PUBLIC', 'ACHIEVEMENT', 'INVITE_ONLY');

-- AlterEnum
-- An invitation runs the other way to every other reason: the TRAINER asked the
-- client. PENDING = invited and not yet taken up, FULFILLED = joined,
-- DECLINED = invitation withdrawn (which is how an invite is revoked).
ALTER TYPE "MembershipRequestReason" ADD VALUE 'INVITE';

-- An invitation needs its own notification type. CLIENT_ADDED_TO_PLAN reads
-- "you're booked in", which would tell a client they had joined a package they
-- have not paid for.
ALTER TYPE "NotificationType" ADD VALUE 'CLIENT_MEMBERSHIP_INVITE';

-- AlterTable
ALTER TABLE "memberships"
  ADD COLUMN "eligibility" "MembershipEligibility" NOT NULL DEFAULT 'PUBLIC',
  ADD COLUMN "showWhenLocked" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
-- ALL prerequisites are required, never any-of: a ladder is a sequence, and
-- "any one of these" would let someone skip a rung.
CREATE TABLE "membership_prerequisites" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_prerequisites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "membership_prerequisites_membershipId_achievementId_key"
  ON "membership_prerequisites"("membershipId", "achievementId");
CREATE INDEX "membership_prerequisites_achievementId_idx"
  ON "membership_prerequisites"("achievementId");

-- AddForeignKey
-- Both cascade: a deleted package has no prerequisites, and a deleted
-- achievement cannot go on gating anything.
ALTER TABLE "membership_prerequisites"
  ADD CONSTRAINT "membership_prerequisites_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_prerequisites"
  ADD CONSTRAINT "membership_prerequisites_achievementId_fkey"
  FOREIGN KEY ("achievementId") REFERENCES "achievements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
