-- A group offering's venue used to live only on its ClassRun. An offering that
-- had not been scheduled yet had no run, so the address the trainer typed was
-- accepted by the form and silently discarded. Give the offering its own venue
-- column; a new run inherits it when it does not name its own.
--
-- Nothing is backfilled from class_runs: the run remains the truth for a class
-- that is already scheduled, and copying up would be guesswork for an offering
-- with several cohorts at different venues.
ALTER TABLE "packages" ADD COLUMN "location" TEXT;
