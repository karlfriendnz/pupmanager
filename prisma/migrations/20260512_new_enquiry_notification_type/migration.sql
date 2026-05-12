-- Adds NEW_ENQUIRY to the NotificationType enum. Used to push the
-- trainer when a public embed-form or intake-form submission lands.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEW_ENQUIRY';
