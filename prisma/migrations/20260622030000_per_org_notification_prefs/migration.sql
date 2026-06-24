-- DropIndex
DROP INDEX "notification_preferences_userId_type_channel_key";

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_userId_companyId_type_channel_key" ON "notification_preferences"("userId", "companyId", "type", "channel");

