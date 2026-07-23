-- Ticket types for a one-off event ("Early bird $40 cap 20", "General $60").
-- On the package (the event's definition), like price and capacity — a run
-- inherits whatever the event sells.
-- Hand-written; @@map snake_case table + FK names.

-- CreateTable
CREATE TABLE "package_ticket_tiers" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "priceCents" INTEGER,
    "capacity" INTEGER,
    "xeroAccountCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_ticket_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "package_ticket_tiers_packageId_idx" ON "package_ticket_tiers"("packageId");

-- AddForeignKey
ALTER TABLE "package_ticket_tiers"
  ADD CONSTRAINT "package_ticket_tiers_packageId_fkey"
  FOREIGN KEY ("packageId") REFERENCES "packages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
