-- Soft delete for accounts. Null = active; timestamp = deactivated.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
