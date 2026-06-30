-- Phase 1 of the Xero integration: per-product/package revenue account mapping.
-- Each product/package can post its invoice lines to a specific Xero account;
-- null falls back to the connection's default sales account.

-- AlterTable
ALTER TABLE "products" ADD COLUMN "xeroAccountCode" TEXT;

-- AlterTable
ALTER TABLE "packages" ADD COLUMN "xeroAccountCode" TEXT;
