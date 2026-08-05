-- Negotiating a booking time.
--
-- A booking request could only ever be confirmed or declined. This adds the
-- third path: a COUNTER-OFFER either side can make, that the other side
-- approves or answers with one of their own, for as many rounds as it takes.
--
-- One table, two brand-new enum TYPES. Note that neither enum here is a VALUE
-- added to an existing type: `ALTER TYPE … ADD VALUE` cannot be used in the
-- same transaction that adds it, and Prisma wraps each migration in one, so
-- that combination fails ONLY in production at `migrate deploy`. Creating a
-- fresh type and using it immediately is fine, which is why the negotiation
-- does NOT add a status to BookingRequestStatus — a request stays PENDING for
-- the whole volley and "whose turn is it" is derived from the newest OPEN
-- proposal instead.
--
-- Additive: prod is behind on migrations, and a booking request with no
-- proposals reads back as exactly today's behaviour (waiting on the trainer).
--
-- Table names are the @@map snake_case ones (booking_proposals,
-- booking_requests, messages). Prisma MODEL names would fail 42P01 under
-- `migrate deploy` and take the production build down with them.
--
-- Every statement is guarded so the file can be replayed against a database
-- that already has it (a drifted dev DB, or a re-run after a partial failure).

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "BookingProposalParty" AS ENUM ('TRAINER', 'CLIENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BookingProposalStatus" AS ENUM ('OPEN', 'SUPERSEDED', 'ACCEPTED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "booking_proposals" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "proposedBy" "BookingProposalParty" NOT NULL,
    "proposedByUserId" TEXT NOT NULL,
    "sessionDates" JSONB NOT NULL DEFAULT '[]',
    "status" "BookingProposalStatus" NOT NULL DEFAULT 'OPEN',
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "booking_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One message carries at most one proposal. This unique is also what indexes
-- the messageId foreign key.
CREATE UNIQUE INDEX IF NOT EXISTS "booking_proposals_messageId_key"
  ON "booking_proposals"("messageId");

-- CreateIndex
-- The hot read is "the newest proposal on this request" — that is what decides
-- whose turn it is and what an approval is allowed to book.
CREATE INDEX IF NOT EXISTS "booking_proposals_requestId_createdAt_idx"
  ON "booking_proposals"("requestId", "createdAt");

-- AddForeignKey
-- Cascade from the request: a deleted request's negotiation is meaningless.
DO $$ BEGIN
  ALTER TABLE "booking_proposals"
    ADD CONSTRAINT "booking_proposals_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "booking_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- AddForeignKey
-- Cascade from the message: the proposal IS the message's card. A message that
-- has gone (with its client's profile, say) leaves no orphan offer behind that
-- something could still try to approve.
DO $$ BEGIN
  ALTER TABLE "booking_proposals"
    ADD CONSTRAINT "booking_proposals_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "messages"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
