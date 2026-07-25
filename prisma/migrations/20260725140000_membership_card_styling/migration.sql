-- Storefront card styling for memberships (hex strings; null = default theme).
ALTER TABLE "memberships"
  ADD COLUMN "bgColor" TEXT,
  ADD COLUMN "headerColor" TEXT,
  ADD COLUMN "textColor" TEXT,
  ADD COLUMN "featuredColor" TEXT;
