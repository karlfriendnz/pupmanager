-- Xero accounting integration: per-trainer OAuth connection to their own Xero
-- organisation. One row per connected trainer; deleting the row == disconnected.

-- CreateTable
CREATE TABLE "xero_connections" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT,
    "bankAccountCode" TEXT,
    "bankAccountName" TEXT,
    "salesAccountCode" TEXT,
    "taxType" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xero_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "xero_connections_trainerId_key" ON "xero_connections"("trainerId");

-- AddForeignKey
ALTER TABLE "xero_connections" ADD CONSTRAINT "xero_connections_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
