-- AlterTable
ALTER TABLE "class_runs" ADD COLUMN     "imageUrl" TEXT;

-- CreateTable
CREATE TABLE "class_run_trainers" (
    "id" TEXT NOT NULL,
    "classRunId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_run_trainers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_brain_dumps" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_brain_dumps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_todos" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "dueDate" TIMESTAMP(3),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_todos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_run_trainers_classRunId_idx" ON "class_run_trainers"("classRunId");

-- CreateIndex
CREATE INDEX "class_run_trainers_membershipId_idx" ON "class_run_trainers"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "class_run_trainers_classRunId_membershipId_key" ON "class_run_trainers"("classRunId", "membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_brain_dumps_companyId_userId_key" ON "trainer_brain_dumps"("companyId", "userId");

-- CreateIndex
CREATE INDEX "trainer_todos_companyId_idx" ON "trainer_todos"("companyId");

-- AddForeignKey
ALTER TABLE "class_run_trainers" ADD CONSTRAINT "class_run_trainers_classRunId_fkey" FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "class_run_trainers" ADD CONSTRAINT "class_run_trainers_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "trainer_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_brain_dumps" ADD CONSTRAINT "trainer_brain_dumps_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_brain_dumps" ADD CONSTRAINT "trainer_brain_dumps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_todos" ADD CONSTRAINT "trainer_todos_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_todos" ADD CONSTRAINT "trainer_todos_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_todos" ADD CONSTRAINT "trainer_todos_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "trainer_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

