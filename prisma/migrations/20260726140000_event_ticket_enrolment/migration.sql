-- An event can sell several ticket types (package_ticket_tiers). Until now an
-- enrolment had no way to say WHICH one was bought or HOW MANY, so every event
-- seat invoiced at the package's single flat price — the number Karl saw on the
-- details page differing from the real ticket price.
--
-- ticketTierId is NULL for every existing row (and for every non-event run),
-- which keeps the old "price off the package" path exactly as it was.
-- quantity defaults to 1, so existing rows bill and consume capacity unchanged.
-- Table/column names are the @@map'd snake_case ones.
ALTER TABLE "class_enrollments" ADD COLUMN "ticketTierId" TEXT;
ALTER TABLE "class_enrollments" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "class_enrollments_ticketTierId_idx" ON "class_enrollments"("ticketTierId");

-- SET NULL, not CASCADE: retiring a ticket type must never delete the people
-- who already hold one — they fall back to the package price.
ALTER TABLE "class_enrollments"
  ADD CONSTRAINT "class_enrollments_ticketTierId_fkey"
  FOREIGN KEY ("ticketTierId") REFERENCES "package_ticket_tiers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
