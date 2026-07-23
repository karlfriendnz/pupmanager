-- A drop-in client can now book SEVERAL sessions of the same run — one
-- enrolment row per session — so the unique key has to include the session.
--
-- Postgres treats NULLs as distinct, so this index no longer stops a second
-- FULL enrolment (dropInSessionId IS NULL) for the same client and dog.
-- enrollInRun enforces that in code; the partial index below backs it up.
-- Hand-written; @@map snake_case table + index names.

-- DropIndex
DROP INDEX "class_enrollments_classRunId_clientId_dogId_key";

-- CreateIndex
CREATE UNIQUE INDEX "class_enrollments_classRunId_clientId_dogId_dropInSessionId_key"
  ON "class_enrollments" ("classRunId", "clientId", "dogId", "dropInSessionId");

-- One FULL enrolment per client+dog per run, which the key above can't say
-- because dropInSessionId is NULL on every one of them.
CREATE UNIQUE INDEX "class_enrollments_full_unique"
  ON "class_enrollments" ("classRunId", "clientId", "dogId")
  WHERE "dropInSessionId" IS NULL;
