-- Dog owners can now create their own PupManager login and ask a trainer to
-- add them (a trainer's client list is a business record, so a public link
-- must not write to it directly). That request reuses the enquiry pipeline
-- rather than growing a second approval mechanism — accepting still runs
-- acceptEnquiry -> findOrJoinClient.
--
-- `source` only exists so the trainer's list can say "wants to join" instead
-- of "enquiry"; every existing row is a form submission, hence the default.
ALTER TABLE "enquiries" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'FORM';
