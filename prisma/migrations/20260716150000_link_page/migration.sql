-- Instagram "link in bio" add-on: a customizable Linktree-style PUBLIC page
-- for a trainer, served at /l/<slug>. One config row per trainer (link_pages)
-- plus an ordered set of custom link buttons (link_page_buttons).
--
-- NOTE: table names are the @@map snake_case ones (link_pages /
-- link_page_buttons), NOT the Prisma model names — a model-name migration
-- fails 42P01 on deploy. Column names are the camelCase Prisma FIELD names
-- (no @map), quoted. Additive only — no data loss.

-- CreateTable
CREATE TABLE "link_pages" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "showBooking" BOOLEAN NOT NULL DEFAULT true,
    "showWebsite" BOOLEAN NOT NULL DEFAULT true,
    "showContact" BOOLEAN NOT NULL DEFAULT true,
    "instagram" TEXT,
    "facebook" TEXT,
    "tiktok" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_page_buttons" (
    "id" TEXT NOT NULL,
    "linkPageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_page_buttons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "link_pages_trainerId_key" ON "link_pages"("trainerId");

-- CreateIndex
CREATE INDEX "link_page_buttons_linkPageId_idx" ON "link_page_buttons"("linkPageId");

-- AddForeignKey
ALTER TABLE "link_pages" ADD CONSTRAINT "link_pages_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_page_buttons" ADD CONSTRAINT "link_page_buttons_linkPageId_fkey" FOREIGN KEY ("linkPageId") REFERENCES "link_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
