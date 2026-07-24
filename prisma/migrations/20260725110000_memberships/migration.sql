-- AlterEnum: a membership is a new purchasable (fulfilment grants its items).
ALTER TYPE "PurchasableKind" ADD VALUE 'MEMBERSHIP';

-- CreateEnum
CREATE TYPE "MembershipCadence" AS ENUM ('ONE_OFF', 'RECURRING');
CREATE TYPE "MembershipInterval" AS ENUM ('WEEK', 'FORTNIGHT', 'MONTH');
CREATE TYPE "MembershipItemKind" AS ENUM ('PACKAGE', 'CLASS', 'PRODUCT');
CREATE TYPE "MembershipPurchaseStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'LAPSED');

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "priceCents" INTEGER NOT NULL,
    "cadence" "MembershipCadence" NOT NULL DEFAULT 'ONE_OFF',
    "interval" "MembershipInterval",
    "minTermCount" INTEGER NOT NULL DEFAULT 0,
    "earlyTermFeeCents" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_items" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" "MembershipItemKind" NOT NULL,
    "packageId" TEXT,
    "classRunId" TEXT,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "regrantOnRenewal" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "membership_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_purchases" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "status" "MembershipPurchaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" TIMESTAMP(3),
    "committedUntil" TIMESTAMP(3),
    "paymentId" TEXT,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "membership_purchases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memberships_trainerId_idx" ON "memberships"("trainerId");
CREATE UNIQUE INDEX "memberships_trainerId_slug_key" ON "memberships"("trainerId", "slug");
CREATE INDEX "membership_items_membershipId_idx" ON "membership_items"("membershipId");
CREATE INDEX "membership_purchases_membershipId_idx" ON "membership_purchases"("membershipId");
CREATE INDEX "membership_purchases_trainerId_idx" ON "membership_purchases"("trainerId");
CREATE INDEX "membership_purchases_clientId_idx" ON "membership_purchases"("clientId");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_items" ADD CONSTRAINT "membership_items_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "membership_purchases" ADD CONSTRAINT "membership_purchases_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
