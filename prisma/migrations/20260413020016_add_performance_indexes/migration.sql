-- CreateIndex
CREATE INDEX "client_profiles_trainerId_idx" ON "client_profiles"("trainerId");

-- CreateIndex
CREATE INDEX "client_shares_clientId_idx" ON "client_shares"("clientId");

-- CreateIndex
CREATE INDEX "client_shares_sharedWithId_idx" ON "client_shares"("sharedWithId");

-- CreateIndex
CREATE INDEX "messages_clientId_idx" ON "messages"("clientId");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE INDEX "training_sessions_trainerId_idx" ON "training_sessions"("trainerId");

-- CreateIndex
CREATE INDEX "training_sessions_scheduledAt_idx" ON "training_sessions"("scheduledAt");

-- CreateIndex
CREATE INDEX "training_tasks_clientId_idx" ON "training_tasks"("clientId");

-- CreateIndex
CREATE INDEX "training_tasks_date_idx" ON "training_tasks"("date");
