-- A trainer needs a way to close a membership request they are NOT going to
-- act on, otherwise the dashboard panel grows forever. FULFILLED already means
-- "accepted — the client is on the package"; DECLINED is the other outcome.
--
-- IF NOT EXISTS so this is a no-op on any database where
-- 20260727140000_membership_requests has not yet been applied and the type is
-- created fresh. Postgres 12+ allows ADD VALUE inside a transaction as long as
-- the new label is not USED in the same transaction — it isn't.
ALTER TYPE "MembershipRequestStatus" ADD VALUE IF NOT EXISTS 'DECLINED';
