-- A library item may sit directly in its category, with no theme.
--
-- The library was three required levels — category (library_types) → theme
-- (library_themes) → item (library_tasks) — so adding one exercise meant
-- inventing a theme for it. Themes become optional GROUPING here.
--
-- Two changes, and the second is only safe because of the first:
--
--   1. library_tasks."typeId" — the category, direct and NOT NULL. Every
--      ownership filter in the app is `type.trainerId`, and an item with no
--      theme has nothing to walk up through, so the category link cannot be
--      derived any more.
--   2. library_tasks."themeId" becomes nullable, and its FK flips from
--      ON DELETE CASCADE to ON DELETE SET NULL. Deleting a theme used to delete
--      every item inside it; now the items stay, in the category they were
--      always in.
--
-- Every existing row is backfilled from its theme's category, so it reads back
-- exactly as it does today: same category, same theme, nothing re-parented.
--
-- Table names are the @@map snake_case ones (library_tasks, library_themes,
-- library_types). Replay-safe: run it twice and the second run is a no-op.

-- 1. The category column, nullable at first so the backfill has somewhere to go.
ALTER TABLE "library_tasks" ADD COLUMN IF NOT EXISTS "typeId" TEXT;

-- 2. Backfill from the theme every existing item already has. themeId is NOT
--    NULL with a FK at this point, so this reaches every row.
UPDATE "library_tasks" t
SET "typeId" = th."typeId"
FROM "library_themes" th
WHERE th."id" = t."themeId"
  AND t."typeId" IS NULL;

-- 3. Now it can be required. Guarded on the catalogue so a replay skips it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'library_tasks' AND column_name = 'typeId' AND is_nullable = 'YES') THEN
    ALTER TABLE "library_tasks" ALTER COLUMN "typeId" SET NOT NULL;
  END IF;
END $$;

-- 4. FK + index for the new column (schema-integrity requires every FK column
--    to lead some index).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"library_tasks"'::regclass AND conname = 'library_tasks_typeId_fkey') THEN
    ALTER TABLE "library_tasks"
      ADD CONSTRAINT "library_tasks_typeId_fkey"
      FOREIGN KEY ("typeId") REFERENCES "library_types"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "library_tasks_typeId_idx" ON "library_tasks"("typeId");

-- 5. A theme is optional grouping now. (DROP NOT NULL on a column that is
--    already nullable is itself a no-op, so this needs no guard.)
ALTER TABLE "library_tasks" ALTER COLUMN "themeId" DROP NOT NULL;

-- 6. And deleting one leaves its items in the category rather than deleting
--    them. The old constraint is looked up by its DEFINITION rather than by a
--    guessed name, so this works whichever way the table was first created —
--    and a replay finds it already ON DELETE SET NULL ('n') and stops.
DO $$
DECLARE existing_name text;
BEGIN
  SELECT conname INTO existing_name
  FROM pg_constraint
  WHERE conrelid = '"library_tasks"'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY ("themeId")%';

  IF existing_name IS NOT NULL THEN
    IF (SELECT confdeltype FROM pg_constraint WHERE conrelid = '"library_tasks"'::regclass AND conname = existing_name) = 'n' THEN
      RETURN;
    END IF;
    EXECUTE format('ALTER TABLE "library_tasks" DROP CONSTRAINT %I', existing_name);
  END IF;

  ALTER TABLE "library_tasks"
    ADD CONSTRAINT "library_tasks_themeId_fkey"
    FOREIGN KEY ("themeId") REFERENCES "library_themes"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
