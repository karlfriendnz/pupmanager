-- Track when a client was actually sent an invitation email (vs just being
-- added as a record). Powers the "Invite your first client" onboarding step,
-- which is now distinct from the new "Create a client" step. Nullable +
-- additive, so safe to apply to a populated table with no backfill.
ALTER TABLE "client_profiles" ADD COLUMN IF NOT EXISTS "invitedAt" TIMESTAMP(3);
