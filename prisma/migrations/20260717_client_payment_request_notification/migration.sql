-- Adds CLIENT_PAYMENT_REQUEST to the NotificationType enum.
--
-- Sent to a CLIENT when their trainer takes payment for something they booked
-- pay-later: the push's tap target is the invoice's own pay screen, so the
-- client can settle from their phone without scanning the trainer's QR.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; Prisma's
-- migrate runner executes statements individually so this is fine here.
-- (Same note as 20260530_enquiry_followup_reminders.)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_PAYMENT_REQUEST';
