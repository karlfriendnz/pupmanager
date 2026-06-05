-- Class session forms + per-client reports. Additive + idempotent.
--   training_sessions.sessionFormId — per-session form override for a class
--     session (null = inherit the class default = group package's
--     defaultSessionFormId).
--   session_attendance.report — each enrolled client's own filled report for
--     the session: { formId, answers, images, intro, closing }.

ALTER TABLE "training_sessions" ADD COLUMN IF NOT EXISTS "sessionFormId" TEXT;
ALTER TABLE "session_attendance" ADD COLUMN IF NOT EXISTS "report" JSONB;
