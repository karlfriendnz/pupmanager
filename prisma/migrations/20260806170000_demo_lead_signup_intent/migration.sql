-- Did the trade-show demo turn into a customer?
--
-- Two nullable timestamps on the lead. `startedSignupAt` is the tap on "Start
-- my own account" from inside the demo; `signupCompletedAt` is an account
-- actually existing afterwards. The gap between them is the drop-off, and both
-- alongside `campaign` are what tell us which stand produced sign-ups rather
-- than merely scans.
--
-- Nothing here links a real business to a sandbox: the demo tenant is destroyed
-- when they tap, and the account they then create is an ordinary trial with
-- none of the demo markers. These columns record intent only.
--
-- Additive and nullable, so an existing row reads back as "did not convert",
-- which is the true answer for every lead captured before this shipped.
-- Replay-safe: run it twice and the second run is a no-op.
ALTER TABLE "demo_leads" ADD COLUMN IF NOT EXISTS "startedSignupAt"   TIMESTAMP(3);
ALTER TABLE "demo_leads" ADD COLUMN IF NOT EXISTS "signupCompletedAt" TIMESTAMP(3);

-- The conversion report reads "leads from this show that started/finished
-- signing up", so both are filtered on and both want an index. Partial, because
-- the interesting rows are the non-null ones and most leads never convert.
CREATE INDEX IF NOT EXISTS "demo_leads_startedSignupAt_idx"
  ON "demo_leads" ("startedSignupAt") WHERE "startedSignupAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "demo_leads_signupCompletedAt_idx"
  ON "demo_leads" ("signupCompletedAt") WHERE "signupCompletedAt" IS NOT NULL;
