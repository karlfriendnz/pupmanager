-- AlterTable
ALTER TABLE "booking_pages" ADD COLUMN     "availDays" JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
ADD COLUMN     "availEndTime" TEXT,
ADD COLUMN     "availStartTime" TEXT;

