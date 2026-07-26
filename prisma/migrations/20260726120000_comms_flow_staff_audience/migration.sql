-- A comms-flow step can now target the trainer's own team instead of clients.
-- Postgres won't let a value added here be *used* in the same transaction, so
-- the IN_APP clean-up lives in the migration that follows this one.
ALTER TYPE "CommsFlowAudience" ADD VALUE IF NOT EXISTS 'STAFF';
