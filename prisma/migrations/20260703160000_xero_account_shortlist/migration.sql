-- Curated shortlist of Xero income accounts a trainer uses, offered when
-- assigning an account to a product/package/class. JSON array of { code, name }.
ALTER TABLE "xero_connections" ADD COLUMN "accountShortlist" JSONB;
