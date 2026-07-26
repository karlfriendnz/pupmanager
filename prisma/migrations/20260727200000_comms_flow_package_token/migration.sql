-- Trainer-facing copy renamed memberships to "Packages", so the merge token a
-- trainer inserts is now {{package}}. Saved CommsFlowStep rows hold the old
-- {{membership}} spelling as literal text.
--
-- ORDER MATTERS, and it is already satisfied: `fill()` in lib/comms-flows.ts
-- accepts BOTH spellings and ships in the same commit as this migration. That
-- makes this a tidy-up, not a cutover — every row renders correctly before it
-- runs, while it runs, and after it runs, and a row this misses (a
-- `{{ membership }}` with spaces, which the engine tolerates and REPLACE does
-- not) keeps working on the alias.
--
-- No schema change; data only. Idempotent — running it twice is a no-op.
UPDATE "comms_flow_steps"
SET
  "title"     = REPLACE("title",     '{{membership}}', '{{package}}'),
  "body"      = REPLACE("body",      '{{membership}}', '{{package}}'),
  "emailBody" = REPLACE("emailBody", '{{membership}}', '{{package}}')
WHERE
  "title" LIKE '%{{membership}}%'
  OR "body" LIKE '%{{membership}}%'
  OR "emailBody" LIKE '%{{membership}}%';

-- Saved flow TEMPLATES hold their steps as a JSON array of the same shape.
-- Rewritten through text, which is safe here because the replacement can't
-- produce or destroy a JSON metacharacter — it swaps one word for another
-- inside a string value.
UPDATE "comms_flow_templates"
SET "steps" = REPLACE("steps"::text, '{{membership}}', '{{package}}')::jsonb
WHERE "steps"::text LIKE '%{{membership}}%';
