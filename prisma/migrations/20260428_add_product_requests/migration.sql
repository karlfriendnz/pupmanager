-- Client requests for products. Each pending request rolls forward across
-- upcoming sessions until the trainer marks it fulfilled or cancelled.
-- Idempotent: safe to re-run against a database where these objects already exist.
DO $$ BEGIN
  CREATE TYPE "ProductRequestStatus" AS ENUM ('PENDING', 'FULFILLED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "product_requests" (
  "id"                 TEXT PRIMARY KEY,
  "clientId"           TEXT NOT NULL,
  "productId"          TEXT NOT NULL,
  "status"             "ProductRequestStatus" NOT NULL DEFAULT 'PENDING',
  "note"               TEXT,
  "fulfilledSessionId" TEXT,
  "fulfilledAt"        TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "product_requests_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_requests_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "product_requests_fulfilledSessionId_fkey"
    FOREIGN KEY ("fulfilledSessionId") REFERENCES "training_sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_requests_clientId_status_idx"
  ON "product_requests"("clientId", "status");

CREATE INDEX IF NOT EXISTS "product_requests_productId_idx"
  ON "product_requests"("productId");

-- A client can only have one PENDING request per product. Other statuses
-- (FULFILLED / CANCELLED) can repeat freely so the same product can be
-- requested again later.
CREATE UNIQUE INDEX IF NOT EXISTS "product_requests_pending_unique"
  ON "product_requests"("clientId", "productId")
  WHERE status = 'PENDING';
