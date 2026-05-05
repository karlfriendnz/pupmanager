-- Default User.role to TRAINER so OAuth (Apple/Google) sign-ins via
-- PrismaAdapter can insert rows without supplying a role. Existing flows
-- (credentials sign-up, invite acceptance) set role explicitly.

ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'TRAINER';
