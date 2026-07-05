-- Private trainer-facing notes about a client (not client-visible; distinct from
-- per-session notes). Scoped to the (userId,trainerId) client relationship.
ALTER TABLE "client_profiles" ADD COLUMN "notes" TEXT;
