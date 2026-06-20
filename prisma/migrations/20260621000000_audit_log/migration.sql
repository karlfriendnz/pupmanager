-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('USER_SIGNUP', 'USER_LOGIN', 'USER_LOGIN_FAILED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'EMAIL_CHANGED', 'ROLE_CHANGED', 'PERMISSIONS_CHANGED', 'INVITE_CREATED', 'INVITE_ACCEPTED', 'MEMBER_REMOVED', 'BILLING_CHANGED', 'PAYMENTS_TOGGLED', 'DATA_EXPORTED', 'ACCOUNT_DELETION_REQUESTED', 'ACCOUNT_DELETED', 'ADMIN_ACTION');

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorUserId" TEXT,
    "action" "AuditAction" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_companyId_createdAt_idx" ON "audit_logs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

