-- Per-trainer landing-page preference: "dashboard" (default) or "schedule".
ALTER TABLE "users" ADD COLUMN "landingPage" TEXT NOT NULL DEFAULT 'dashboard';
