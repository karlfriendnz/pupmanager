-- Remember a "Not now" on an add-on nudge server-side, so the choice follows
-- the trainer across browsers and devices instead of living in localStorage.
-- Hand-written (see the auto-reply migration for why `migrate diff` can't be
-- used unmodified on this branch). Table name is the @@map snake_case one.

-- CreateTable
CREATE TABLE "nudge_dismissals" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nudgeId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nudge_dismissals_userId_idx" ON "nudge_dismissals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_dismissals_userId_nudgeId_key" ON "nudge_dismissals"("userId", "nudgeId");

-- AddForeignKey
ALTER TABLE "nudge_dismissals" ADD CONSTRAINT "nudge_dismissals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
