-- Optional schedule colour for a package (Tailwind palette key, eg "blue").
-- null means the schedule keeps using the status-based colour.
ALTER TABLE "packages"
  ADD COLUMN "color" TEXT;
