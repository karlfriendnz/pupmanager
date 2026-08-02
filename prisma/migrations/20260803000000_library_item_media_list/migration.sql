-- A library item's attachments become ONE ordered list.
--
-- The item carried a picture, a handout and a list of videos in separate
-- columns. Same job, three shapes — and no way to attach a second handout, or
-- to say which of them a client should meet first. `media` is the list:
--   [{ kind: 'image'|'video'|'document'|'link', url, title?, fileName? }]
--
-- The old columns are NOT dropped. videoUrl/videos/imageUrl/fileUrl/fileName
-- are now derived from the list and rewritten on every save (see
-- src/lib/library-media.ts), because the default-homework builder, the
-- offering's suggestion list and the demo seed all still select them. Dropping
-- a column out from under a reader is a silent blank on a client's screen,
-- which is the failure this change exists to stop.
--
-- training_tasks gets the same column: homework is a snapshot of the item, and
-- it is what finally carries a handout to a client — the assign path copied the
-- picture and the clips, but had nowhere to put a PDF.
--
-- Existing rows are backfilled here rather than in a script, so a database can
-- never sit at "new column, old data": videos in their order, then the picture,
-- then the handout — the left-to-right order those controls sat in on screen.
--
-- Table names are the @@map snake_case ones (library_tasks, training_tasks).
-- Prisma MODEL names would fail 42P01 under `migrate deploy` and take the prod
-- build down with them. Every statement is guarded so the file replays cleanly
-- against a database that already has it.

-- AlterTable
ALTER TABLE "library_tasks"
  ADD COLUMN IF NOT EXISTS "media" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "training_tasks"
  ADD COLUMN IF NOT EXISTS "media" JSONB NOT NULL DEFAULT '[]';

-- Backfill: library items.
--
-- Only rows whose media is still empty, so a replay never doubles anything up
-- and never overwrites a list a trainer has since edited.
UPDATE "library_tasks" SET "media" = sub.built
FROM (
  SELECT
    t.id,
    (
      -- Videos, in the order they were saved. `videos` is the list era;
      -- `videoUrl` is the single-column era, used only when the list is empty.
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN NULLIF(v->>'title', '') IS NOT NULL
                THEN jsonb_build_object('kind', 'video', 'url', v->>'url', 'title', v->>'title')
              ELSE jsonb_build_object('kind', 'video', 'url', v->>'url')
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(t."videos") = 'array' THEN t."videos" ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS e(v, ord)
          WHERE (v->>'url') LIKE 'http%'
        ),
        CASE
          WHEN t."videoUrl" LIKE 'http%'
            THEN jsonb_build_array(jsonb_build_object('kind', 'video', 'url', t."videoUrl"))
          ELSE '[]'::jsonb
        END
      )
      ||
      -- The picture.
      CASE
        WHEN t."imageUrl" LIKE 'http%'
          THEN jsonb_build_array(jsonb_build_object('kind', 'image', 'url', t."imageUrl"))
        ELSE '[]'::jsonb
      END
      ||
      -- The handout, keeping the filename that labels its download link.
      CASE
        WHEN t."fileUrl" LIKE 'http%' AND NULLIF(t."fileName", '') IS NOT NULL
          THEN jsonb_build_array(jsonb_build_object('kind', 'document', 'url', t."fileUrl", 'fileName', t."fileName"))
        WHEN t."fileUrl" LIKE 'http%'
          THEN jsonb_build_array(jsonb_build_object('kind', 'document', 'url', t."fileUrl"))
        ELSE '[]'::jsonb
      END
    ) AS built
  FROM "library_tasks" t
) AS sub
WHERE "library_tasks".id = sub.id
  AND "library_tasks"."media" = '[]'::jsonb
  AND sub.built <> '[]'::jsonb;

-- Backfill: homework snapshots.
--
-- Same rule, except TrainingTask keeps its images as a LIST and has no handout
-- column — a handout never reached a client before now, so there is nothing
-- here to recover, only somewhere for the next one to go.
UPDATE "training_tasks" SET "media" = sub.built
FROM (
  SELECT
    t.id,
    (
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN NULLIF(v->>'title', '') IS NOT NULL
                THEN jsonb_build_object('kind', 'video', 'url', v->>'url', 'title', v->>'title')
              ELSE jsonb_build_object('kind', 'video', 'url', v->>'url')
            END
            ORDER BY ord
          )
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(t."videos") = 'array' THEN t."videos" ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS e(v, ord)
          WHERE (v->>'url') LIKE 'http%'
        ),
        CASE
          WHEN t."videoUrl" LIKE 'http%'
            THEN jsonb_build_array(jsonb_build_object('kind', 'video', 'url', t."videoUrl"))
          ELSE '[]'::jsonb
        END
      )
      ||
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('kind', 'image', 'url', img #>> '{}') ORDER BY ord)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(t."imageUrls") = 'array' THEN t."imageUrls" ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS e(img, ord)
          WHERE (img #>> '{}') LIKE 'http%'
        ),
        '[]'::jsonb
      )
    ) AS built
  FROM "training_tasks" t
) AS sub
WHERE "training_tasks".id = sub.id
  AND "training_tasks"."media" = '[]'::jsonb
  AND sub.built <> '[]'::jsonb;
