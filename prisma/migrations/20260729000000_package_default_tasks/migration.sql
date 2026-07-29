-- Default homework a trainer configures on an offering (consult or group class).
CREATE TABLE "package_default_tasks" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "sessionIndex" INTEGER,
    "libraryTaskId" TEXT,
    "title" TEXT,
    "description" TEXT,
    "repetitions" INTEGER,
    "videoUrl" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_default_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "package_default_tasks_packageId_idx" ON "package_default_tasks"("packageId");
CREATE INDEX "package_default_tasks_libraryTaskId_idx" ON "package_default_tasks"("libraryTaskId");

ALTER TABLE "package_default_tasks" ADD CONSTRAINT "package_default_tasks_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "package_default_tasks" ADD CONSTRAINT "package_default_tasks_libraryTaskId_fkey"
    FOREIGN KEY ("libraryTaskId") REFERENCES "library_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
