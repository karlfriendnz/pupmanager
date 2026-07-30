-- What a trainer calls the things in their own left menu.
--
-- A groomer says "Services", a daycare says "Programmes", we say "Offerings". The
-- software shouldn't insist. Stored as a map of nav key → their word
-- ({"/packages": "Private lessons"}), and only deliberate renames go in — so NULL
-- means "our words", and a menu item we rename later picks up the new default for
-- everyone who never chose their own.
--
-- Hand-written and idempotent (see the review_comments migration for why). Table
-- name is the @@map value, not the model name.

ALTER TABLE "trainer_profiles" ADD COLUMN IF NOT EXISTS "navLabels" JSONB;
