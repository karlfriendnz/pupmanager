-- AlterTable: flag a package as a puppy school / daycare offering.
ALTER TABLE "packages" ADD COLUMN     "isPuppySchool" BOOLEAN NOT NULL DEFAULT false;
