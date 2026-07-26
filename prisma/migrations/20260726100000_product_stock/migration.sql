-- Simple stock count on a product. NULL means "not tracked", so every existing
-- product keeps behaving exactly as it does today rather than reading as sold
-- out. Table name is the @@map'd snake_case one.
ALTER TABLE "products" ADD COLUMN "stockCount" INTEGER;
