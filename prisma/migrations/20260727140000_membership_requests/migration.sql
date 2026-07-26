-- A client asking for a membership they can't check out themselves (a recurring
-- plan, or one published without a price). Mirrors product_requests.
CREATE TYPE "MembershipRequestReason" AS ENUM ('RECURRING', 'NO_PRICE');
CREATE TYPE "MembershipRequestStatus" AS ENUM ('PENDING', 'FULFILLED');

CREATE TABLE "membership_requests" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "reason" "MembershipRequestReason" NOT NULL,
    "status" "MembershipRequestStatus" NOT NULL DEFAULT 'PENDING',
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "membership_requests_clientId_status_idx" ON "membership_requests"("clientId", "status");
CREATE INDEX "membership_requests_membershipId_status_idx" ON "membership_requests"("membershipId", "status");

ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_requests" ADD CONSTRAINT "membership_requests_membershipId_fkey"
    FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
