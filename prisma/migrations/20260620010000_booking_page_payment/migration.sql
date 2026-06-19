-- AlterTable
ALTER TABLE "booking_pages" ADD COLUMN     "priceCents" INTEGER,
ADD COLUMN     "requiresPayment" BOOLEAN NOT NULL DEFAULT false;

