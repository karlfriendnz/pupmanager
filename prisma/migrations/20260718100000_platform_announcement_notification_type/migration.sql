-- Adds PLATFORM_ANNOUNCEMENT to the NotificationType enum — product "what's new"
-- broadcasts from PupManager that land in every trainer's notification bell.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block; Prisma's
-- migrate runner executes statements individually so this is fine here.
-- (Same note as 20260717_client_payment_request_notification.)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PLATFORM_ANNOUNCEMENT';
