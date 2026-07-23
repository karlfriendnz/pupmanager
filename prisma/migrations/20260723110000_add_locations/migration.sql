-- A reusable places library the trainer curates once and picks from when
-- creating packages, classes and sessions. One row per location, scoped to the
-- owning company (trainer_profiles) and cascade-deleted with it.

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "imageUrl" TEXT,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "locations_trainerId_idx" ON "locations"("trainerId");

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
