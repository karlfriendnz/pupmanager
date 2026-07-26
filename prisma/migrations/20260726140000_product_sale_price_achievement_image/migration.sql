-- Optional sale price on a product. NULL = not on sale. Enforced below the
-- normal price in application code (the normal price may itself be NULL for
-- "Contact trainer" items, which can't be put on sale).
ALTER TABLE "products" ADD COLUMN "salePriceCents" INTEGER;

-- Optional uploaded badge artwork on an achievement. NULL = fall back to the
-- emoji in "icon".
ALTER TABLE "achievements" ADD COLUMN "imageUrl" TEXT;
