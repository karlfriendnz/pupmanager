-- Per-item presentation overrides for membership items. Null = fall back to the
-- linked offering's own image/description. Columns are camelCase (Prisma
-- default), table is @@map'd to membership_items.
ALTER TABLE "membership_items"
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "description" TEXT;
