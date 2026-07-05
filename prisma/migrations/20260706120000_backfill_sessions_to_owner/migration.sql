-- Backfill: assign every previously-UNASSIGNED training session to its company's
-- OWNER membership.
--
-- Why: a business often starts as a single (owner) trainer, whose sessions were
-- created with no explicit assignedMembershipId (null). Once they add a SECOND
-- trainer, the schedule's per-member switcher + per-person double-booking need
-- that history to belong to the first trainer (the owner), not sit as
-- "Unassigned". This stamps the owner explicitly so the past stays with them.
--
-- Safe + idempotent: only rows where assignedMembershipId IS NULL are touched,
-- and only for companies that actually have an OWNER membership. Re-running is a
-- no-op. Sessions in the rare owner-less company are left null (resolved to the
-- owner at read-time by the app's convention).

WITH company_owner AS (
  -- Exactly one owner per company (earliest-invited wins if somehow duplicated).
  SELECT DISTINCT ON ("companyId") "companyId", "id" AS owner_id
  FROM "trainer_memberships"
  WHERE "role" = 'OWNER'
  ORDER BY "companyId", "invitedAt" ASC
)
UPDATE "training_sessions" ts
SET "assignedMembershipId" = co.owner_id
FROM company_owner co
WHERE ts."assignedMembershipId" IS NULL
  AND co."companyId" = ts."trainerId";
