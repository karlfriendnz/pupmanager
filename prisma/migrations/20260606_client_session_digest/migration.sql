-- Split the client session reminder into two notification types so each has
-- independent per-channel control: a morning digest + a per-session heads-up.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLIENT_SESSION_DIGEST';
