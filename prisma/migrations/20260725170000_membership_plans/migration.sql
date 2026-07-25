-- Recurring membership billing options (per week/fortnight/month). One-off
-- memberships keep their single Membership.priceCents.
CREATE TABLE "membership_plans" (
  "id" TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "interval" "MembershipInterval" NOT NULL,
  "priceCents" INTEGER NOT NULL,
  "minTermCount" INTEGER NOT NULL DEFAULT 0,
  "earlyTermFeeCents" INTEGER,
  "order" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "membership_plans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "membership_plans_membershipId_idx" ON "membership_plans"("membershipId");
ALTER TABLE "membership_plans" ADD CONSTRAINT "membership_plans_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
