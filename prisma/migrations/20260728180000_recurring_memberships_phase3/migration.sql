-- Recurring memberships, Phase 3: polish.
--
-- One new state. A trainer looking at a package request now has three answers
-- rather than two: give it to them, say no, or ask them to subscribe and pay for
-- it themselves. That last one had been collapsing into FULFILLED, which told
-- the trainer a plan was running when nobody had paid for anything yet.
--
-- Postgres 12+ allows ADD VALUE inside a transaction as long as the new label is
-- not USED in the same transaction — it isn't.
ALTER TYPE "MembershipRequestStatus" ADD VALUE IF NOT EXISTS 'INVITED';
