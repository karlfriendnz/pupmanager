-- Series — a run of 1:1 consults with a pre-defined curriculum.
--
-- A series is an ordinary 1:1 Package (isGroup = false) with two things added:
-- a CURRICULUM (what happens in each session, defined up front) and a per-session
-- record of WHICH step a given session actually covered.
--
-- The flag is labelling + routing only, exactly like isPuppySchool / isEvent: it
-- declares what the offering IS so the list pages and the offerings hub can tell
-- a series from a plain consult without re-deriving it from shape.
ALTER TABLE "packages" ADD COLUMN IF NOT EXISTS "isSeries" BOOLEAN NOT NULL DEFAULT false;

-- One step of the curriculum: "session 2 is loose-lead walking".
--
-- Lives on the Package, not the ClientPackage, because the curriculum is the
-- TEMPLATE — every client who buys the series gets the same plan. What varies
-- per client is which session covered which step, and that lives on the session.
--
-- Homework for a step is NOT duplicated here: package_default_tasks already keys
-- per-session homework off the same 1-based sessionIndex, so a step and its
-- homework are joined on that number and there is only ever one of each.
CREATE TABLE "package_session_plans" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    -- 1-based step number within the series ("session 3 of 6"). The same
    -- numbering package_default_tasks uses, deliberately.
    "sessionIndex" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "package_session_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "package_session_plans_packageId_idx" ON "package_session_plans"("packageId");
-- One step per number. Two "session 3"s would make "which step is this session
-- on" unanswerable, and the homework join ambiguous.
CREATE UNIQUE INDEX "package_session_plans_packageId_sessionIndex_key"
    ON "package_session_plans"("packageId", "sessionIndex");

ALTER TABLE "package_session_plans" ADD CONSTRAINT "package_session_plans_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which curriculum step this session actually covers.
--
-- NOT the same as its position. The trainer may SKIP a step for a client whose
-- dog already has it, so a client's 2nd session can be step 3 — which is why
-- this is stored rather than counted. Null = not decided yet; the natural order
-- is used until someone says otherwise (see lib/series.ts).
--
-- SetNull, not Cascade: retiring a curriculum step must never delete sessions
-- that are already in the diary.
ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "sessionPlanId" TEXT;

CREATE INDEX "training_sessions_sessionPlanId_idx" ON "training_sessions"("sessionPlanId");

ALTER TABLE "training_sessions" ADD CONSTRAINT "training_sessions_sessionPlanId_fkey"
    FOREIGN KEY ("sessionPlanId") REFERENCES "package_session_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;
