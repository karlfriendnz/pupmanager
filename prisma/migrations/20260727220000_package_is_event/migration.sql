-- An offering now DECLARES that it is an event, instead of the app guessing.
--
-- "Event" used to be inferred from the backing package's shape — isGroup AND
-- NOT allowDropIn AND sessionCount = 1 AND no recurrenceRule. That shape is not
-- unique to an event: a perfectly ordinary group class that happens to run once
-- ("Doesn't repeat (one-off)" in the class form writes exactly sessionCount 1)
-- matches it too. Those classes were filtered OUT of /classes and listed under
-- /events, so they vanished from the screen the trainer created them on. One
-- live customer had 55 of her 63 group classes disappear this way.
--
-- Table name is the @@map'd snake_case one; column names on this model are
-- camelCase, unquoted-lowercase would not match.
ALTER TABLE "packages" ADD COLUMN "isEvent" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: EVERYTHING becomes a class.
--
-- The column default already writes false; this states the decision explicitly
-- rather than leaving it as a side effect of the DDL.
--
-- Why false for every row, with no attempt to guess which ones were "meant" to
-- be events: at the time of writing, 62 runs platform-wide across 7 trainers
-- matched the inferred event shape and NOT ONE of them sold tickets (zero
-- package_ticket_tiers rows between them). Selling tickets is the only thing
-- that distinguishes a real event, so there is no signal to preserve — nothing
-- genuine is being re-labelled. Guessing would risk hiding someone's class all
-- over again, which is the bug this migration exists to end. Trainers who want
-- an event create one as an event from here on, and it is recorded as such.
UPDATE "packages" SET "isEvent" = false;
