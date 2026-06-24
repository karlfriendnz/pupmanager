-- CreateTable
CREATE TABLE "session_time_entries" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "rateCents" INTEGER,
    "note" TEXT,
    "loggedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_time_entries_sessionId_idx" ON "session_time_entries"("sessionId");

-- CreateIndex
CREATE INDEX "session_time_entries_membershipId_idx" ON "session_time_entries"("membershipId");

-- AddForeignKey
ALTER TABLE "session_time_entries" ADD CONSTRAINT "session_time_entries_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_time_entries" ADD CONSTRAINT "session_time_entries_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "trainer_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

