-- Store the Google event's title on imported busy blocks so the schedule can
-- show a hover popup of what the busy time is. Nullable (FreeBusy imports and
-- untitled events leave it null).
ALTER TABLE "google_busy_blocks" ADD COLUMN "title" TEXT;
