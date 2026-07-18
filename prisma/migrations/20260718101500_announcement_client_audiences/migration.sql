-- Extend announcement audiences beyond trainers so a platform message can also
-- reach clients (dog owners) or everyone. Postgres 12+ allows ADD VALUE inside
-- the migration transaction as long as the new value isn't USED in the same
-- transaction (it isn't — the send route reads it later). IF NOT EXISTS keeps
-- this idempotent against a dev DB already pushed from schema.prisma.
ALTER TYPE "AnnouncementAudience" ADD VALUE IF NOT EXISTS 'ALL_CLIENTS';
ALTER TYPE "AnnouncementAudience" ADD VALUE IF NOT EXISTS 'EVERYONE';
