-- CreateEnum
CREATE TYPE "CommsFlowDirection" AS ENUM ('BEFORE_SESSION', 'AFTER_SESSION');

-- CreateEnum
CREATE TYPE "CommsFlowAudience" AS ENUM ('ENROLLED', 'ENROLLED_AND_WAITLIST', 'CUSTOM');

-- CreateTable
CREATE TABLE "comms_flow_steps" (
    "id" TEXT NOT NULL,
    "classRunId" TEXT NOT NULL,
    "direction" "CommsFlowDirection" NOT NULL DEFAULT 'BEFORE_SESSION',
    "offsetMinutes" INTEGER NOT NULL DEFAULT 1440,
    "channels" "NotificationChannel"[] DEFAULT ARRAY[]::"NotificationChannel"[],
    "audience" "CommsFlowAudience" NOT NULL DEFAULT 'ENROLLED',
    "customClientIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "important" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comms_flow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_flow_sends" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comms_flow_sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comms_flow_templates" (
    "id" TEXT NOT NULL,
    "trainerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comms_flow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "comms_flow_steps_classRunId_idx" ON "comms_flow_steps"("classRunId");

-- CreateIndex
CREATE INDEX "comms_flow_sends_sessionId_idx" ON "comms_flow_sends"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "comms_flow_sends_stepId_sessionId_userId_key" ON "comms_flow_sends"("stepId", "sessionId", "userId");

-- CreateIndex
CREATE INDEX "comms_flow_templates_trainerId_idx" ON "comms_flow_templates"("trainerId");

-- AddForeignKey
ALTER TABLE "comms_flow_steps" ADD CONSTRAINT "comms_flow_steps_classRunId_fkey" FOREIGN KEY ("classRunId") REFERENCES "class_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_flow_sends" ADD CONSTRAINT "comms_flow_sends_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "comms_flow_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_flow_sends" ADD CONSTRAINT "comms_flow_sends_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "training_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comms_flow_templates" ADD CONSTRAINT "comms_flow_templates_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "trainer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
