-- Client-facing "new message" notification so clients can control message
-- alerts (push/email/feed) the same way as their other notifications.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_NEW_MESSAGE';
