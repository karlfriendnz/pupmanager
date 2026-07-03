-- Per-trainer feature toggles set during onboarding (and editable in Settings):
-- whether the business runs classes, records session notes, and wants a
-- client-facing app. Default TRUE so existing accounts keep every surface.
ALTER TABLE "trainer_profiles"
  ADD COLUMN "clientAppEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "classesEnabled"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notesEnabled"     BOOLEAN NOT NULL DEFAULT true;

-- Team emails captured during onboarding but not yet invited (sent later from
-- the dashboard). Postgres text array, default empty.
ALTER TABLE "trainer_profiles"
  ADD COLUMN "pendingTeamInvites" TEXT[] NOT NULL DEFAULT '{}';
