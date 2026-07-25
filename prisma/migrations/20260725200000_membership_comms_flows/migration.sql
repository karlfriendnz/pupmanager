-- Membership reminders: a comms-flow step can belong to a Membership, anchored
-- on the client's purchase rather than on a session.
-- Table names are the @@map'd snake_case ones — model names fail 42P01 on deploy.

ALTER TYPE "CommsFlowDirection" ADD VALUE IF NOT EXISTS 'AFTER_PURCHASE';
ALTER TYPE "CommsFlowDirection" ADD VALUE IF NOT EXISTS 'BEFORE_PERIOD_END';

ALTER TABLE "comms_flow_steps" ADD COLUMN "membershipId" TEXT;
CREATE INDEX "comms_flow_steps_membershipId_idx" ON "comms_flow_steps"("membershipId");
ALTER TABLE "comms_flow_steps"
  ADD CONSTRAINT "comms_flow_steps_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A send is anchored by a session OR a purchase, so sessionId becomes optional.
ALTER TABLE "comms_flow_sends" ALTER COLUMN "sessionId" DROP NOT NULL;
ALTER TABLE "comms_flow_sends" ADD COLUMN "purchaseId" TEXT;
CREATE INDEX "comms_flow_sends_purchaseId_idx" ON "comms_flow_sends"("purchaseId");
CREATE UNIQUE INDEX "comms_flow_sends_stepId_purchaseId_userId_key"
  ON "comms_flow_sends"("stepId", "purchaseId", "userId");
ALTER TABLE "comms_flow_sends"
  ADD CONSTRAINT "comms_flow_sends_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "membership_purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
