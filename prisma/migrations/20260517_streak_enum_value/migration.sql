-- Isolated enum addition. Postgres requires `ALTER TYPE ... ADD VALUE`
-- to run on its own (not in a transaction with other DDL); Prisma runs a
-- migration containing only this statement outside a transaction. Safe
-- and idempotent if the original (failed) migration somehow added it.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STREAK_UPDATE';
