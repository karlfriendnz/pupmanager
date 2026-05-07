-- CreateTable
CREATE TABLE "onboarding_steps" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "ctaLabel" TEXT NOT NULL,
    "ctaHref" TEXT NOT NULL,
    "skippable" BOOLEAN NOT NULL DEFAULT true,
    "skipWarning" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_emails" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "senderKey" TEXT NOT NULL DEFAULT 'karl',
    "triggerRule" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_onboarding_progress" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ahaReachedAt" TIMESTAMP(3),
    "firstInviteSentAt" TIMESTAMP(3),
    "checklistDismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trainer_onboarding_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_onboarding_step_progress" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),

    CONSTRAINT "trainer_onboarding_step_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainer_onboarding_email_logs" (
    "id" TEXT NOT NULL,
    "progressId" TEXT NOT NULL,
    "emailKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trainer_onboarding_email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_steps_key_key" ON "onboarding_steps"("key");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_emails_key_key" ON "onboarding_emails"("key");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_onboarding_progress_trainerId_key" ON "trainer_onboarding_progress"("trainerId");

-- CreateIndex
CREATE INDEX "trainer_onboarding_step_progress_progressId_idx" ON "trainer_onboarding_step_progress"("progressId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_onboarding_step_progress_progressId_stepKey_key" ON "trainer_onboarding_step_progress"("progressId", "stepKey");

-- CreateIndex
CREATE INDEX "trainer_onboarding_email_logs_progressId_idx" ON "trainer_onboarding_email_logs"("progressId");

-- CreateIndex
CREATE UNIQUE INDEX "trainer_onboarding_email_logs_progressId_emailKey_key" ON "trainer_onboarding_email_logs"("progressId", "emailKey");

-- AddForeignKey
ALTER TABLE "trainer_onboarding_progress" ADD CONSTRAINT "trainer_onboarding_progress_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_onboarding_step_progress" ADD CONSTRAINT "trainer_onboarding_step_progress_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "trainer_onboarding_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trainer_onboarding_email_logs" ADD CONSTRAINT "trainer_onboarding_email_logs_progressId_fkey" FOREIGN KEY ("progressId") REFERENCES "trainer_onboarding_progress"("id") ON DELETE CASCADE ON UPDATE CASCADE;
