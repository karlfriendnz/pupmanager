-- A library item can hold several instructional videos, not one.
--
-- One exercise is usually several short clips ("Step 1 — approach", "Step 2 —
-- reward"): it teaches better than one long take, and each file stays small
-- enough to upload and to play on mobile data.
--
-- `videoUrl` is DELIBERATELY LEFT IN PLACE on both tables and is still
-- written, always as the FIRST entry of `videos`. Plenty of readers still
-- select it — the session screen, training templates, default homework, the
-- client's own task page — and a rolling deploy runs the old code for a minute
-- either way. The backfill below means the two agree from the first request.
-- Dropping it is a separate change, once nothing reads it.
--
-- Table names are the @@map snake_case ones (library_tasks, training_tasks),
-- not the Prisma model names — `migrate deploy` fails 42P01 otherwise and takes
-- the build down with it. COLUMNS are camelCase ("videoUrl"): only tables are
-- mapped in this schema.

ALTER TABLE "library_tasks"  ADD COLUMN IF NOT EXISTS "videos" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "training_tasks" ADD COLUMN IF NOT EXISTS "videos" JSONB NOT NULL DEFAULT '[]';

-- Everything that already has a video gets a one-entry list, so nothing has to
-- fall back to the old column at read time. Untitled on purpose: the trainer
-- named nothing, and inventing "Video 1" as stored data would be a title they
-- never wrote.
UPDATE "library_tasks"
   SET "videos" = jsonb_build_array(jsonb_build_object('url', "videoUrl"))
 WHERE "videoUrl" IS NOT NULL
   AND "videoUrl" <> ''
   AND "videos" = '[]'::jsonb;

UPDATE "training_tasks"
   SET "videos" = jsonb_build_array(jsonb_build_object('url', "videoUrl"))
 WHERE "videoUrl" IS NOT NULL
   AND "videoUrl" <> ''
   AND "videos" = '[]'::jsonb;
