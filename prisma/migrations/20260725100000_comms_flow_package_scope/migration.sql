-- Comms-flow steps can now attach to a Package (1:1) as well as a ClassRun.
-- classRunId becomes optional; a step has exactly one of classRunId / packageId
-- (enforced in the API).

-- AlterTable
ALTER TABLE "comms_flow_steps" ALTER COLUMN "classRunId" DROP NOT NULL;
ALTER TABLE "comms_flow_steps" ADD COLUMN     "packageId" TEXT;

-- CreateIndex
CREATE INDEX "comms_flow_steps_packageId_idx" ON "comms_flow_steps"("packageId");

-- AddForeignKey
ALTER TABLE "comms_flow_steps" ADD CONSTRAINT "comms_flow_steps_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
