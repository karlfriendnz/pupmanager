-- CreateEnum
CREATE TYPE "DiscountModifierType" AS ENUM ('PERCENT', 'FLAT', 'REPLACE');

-- CreateTable
CREATE TABLE "discounts" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "packageId" TEXT,
    "name" TEXT NOT NULL,
    "formText" TEXT,
    "modifierType" "DiscountModifierType" NOT NULL,
    "modifierValue" INTEGER NOT NULL,
    "applyTo" TEXT NOT NULL DEFAULT 'order_total',
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discounts_trainerId_idx" ON "discounts"("trainerId");

-- CreateIndex
CREATE INDEX "discounts_packageId_idx" ON "discounts"("packageId");

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discounts" ADD CONSTRAINT "discounts_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
