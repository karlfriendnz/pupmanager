-- Tags: one flat list per trainer that reaches every kind of thing they sell.
--
-- A ProductCategory is a shelf in the shop and can only hold products. A tag
-- has to hold a 1:1 package, a group class and a product AT THE SAME TIME —
-- that is the whole feature, so it cannot be a column on either table.
--
-- Table names are the @@map snake_case ones (tags, tag_assignments, packages,
-- products, trainer_profiles). Prisma MODEL names would fail 42P01 under
-- `migrate deploy` and take the prod build down with them.
--
-- Every statement is guarded so this file can be replayed against a database
-- that already has it (drifted dev DBs, a re-run after a partial failure).

-- CreateTable
CREATE TABLE IF NOT EXISTS "tags" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Case-folded copy of "name". Postgres unique indexes are case-sensitive,
    -- so uniqueness is enforced on THIS column: "Puppy" and "puppy" have to
    -- collide, or the trainer ends up with two tags saying the same word.
    "nameKey" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- One row = one thing carrying one tag. Exactly one of packageId/productId is
-- set; see the CHECK below, which is the part Prisma cannot express.
CREATE TABLE IF NOT EXISTS "tag_assignments" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "packageId" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tags_trainerId_nameKey_key" ON "tags"("trainerId", "nameKey");
CREATE INDEX IF NOT EXISTS "tags_trainerId_idx" ON "tags"("trainerId");

-- A thing carries a tag once. NULLs are distinct in Postgres, so the product
-- rows (packageId NULL) never collide under the first index and the package
-- rows (productId NULL) never collide under the second — which is exactly why
-- two partial-looking uniques can coexist on one table.
CREATE UNIQUE INDEX IF NOT EXISTS "tag_assignments_tagId_packageId_key" ON "tag_assignments"("tagId", "packageId");
CREATE UNIQUE INDEX IF NOT EXISTS "tag_assignments_tagId_productId_key" ON "tag_assignments"("tagId", "productId");
CREATE INDEX IF NOT EXISTS "tag_assignments_packageId_idx" ON "tag_assignments"("packageId");
CREATE INDEX IF NOT EXISTS "tag_assignments_productId_idx" ON "tag_assignments"("productId");

-- AddCheckConstraint
-- The "exactly one target" guarantee, in the database rather than in whichever
-- route happens to write the row. A row with both set would show up twice in a
-- tag; a row with neither would be an orphan nothing could ever clean up.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tag_assignments_one_target'
  ) THEN
    ALTER TABLE "tag_assignments"
      ADD CONSTRAINT "tag_assignments_one_target"
      CHECK (num_nonnulls("packageId", "productId") = 1);
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_trainerId_fkey') THEN
    ALTER TABLE "tags"
      ADD CONSTRAINT "tags_trainerId_fkey"
      FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- Cascade on all three sides deletes only the JOIN row. Deleting a tag drops
  -- its assignments and leaves every offering and product exactly where it was
  -- — a trainer tidying their labels must never lose what was labelled.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_assignments_tagId_fkey') THEN
    ALTER TABLE "tag_assignments"
      ADD CONSTRAINT "tag_assignments_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_assignments_packageId_fkey') THEN
    ALTER TABLE "tag_assignments"
      ADD CONSTRAINT "tag_assignments_packageId_fkey"
      FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tag_assignments_productId_fkey') THEN
    ALTER TABLE "tag_assignments"
      ADD CONSTRAINT "tag_assignments_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
