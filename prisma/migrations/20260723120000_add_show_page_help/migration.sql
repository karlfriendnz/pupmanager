-- Per-user toggle for the one-line page helper text under each page title.
ALTER TABLE "users" ADD COLUMN "showPageHelp" BOOLEAN NOT NULL DEFAULT true;
