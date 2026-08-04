# Deploy prep — 203 commits, 20 migrations

Written 2026-08-05, after the client + trainer audits. **Nothing here has been
pushed.** This is the readiness state and the order to do it in.

---

## What is waiting

| | |
|---|---|
| Commits ahead of `origin/main` | **203** (2026-08-01 → 08-05) |
| Migrations not applied in prod | **20** (prod's last is 30 July) |
| Bug fixes in the stack | **26**, twelve of which lose money |

The features underneath: group messaging, product variants + categories + stock
movements, tags, tap-to-pay, membership eligibility + payment grace, homework
timing, offering visibility, instructional videos, the trainer home hero.

**Prod remote is `origin`** (`karlfriendnz/pupmanager.git`). The `vercel` remote
is stale — see [[project_deploy_remote]].

---

## Verified ready

- **Unit: 4,160 passing.** e2e: **452 passing, 0 failing.** `test:e2e:full` runs
  `next build`, so the production build is proven, not assumed.
- **All 238 migrations name tables, not Prisma models.** This is the failure that
  has taken a prod build down here before: `ALTER TABLE "TrainerProfile"` fails
  42P01 during Vercel's build. Now asserted by
  `tests/unit/migrations-use-table-names.test.ts`, which was proved to fail
  before it was trusted.
- **The 20 queued migrations contain no destructive statement** — no DROP TABLE,
  DROP COLUMN, DELETE or TRUNCATE anywhere in them.
- **Every `ADD COLUMN … NOT NULL` carries a DEFAULT**, so none can fail against
  existing rows.
- **Every custom type is created before use**, and all but one are guarded with
  `IF NOT EXISTS` / a `DO $$` block. The unguarded one
  (`membership_eligibility`) is only a problem on replay, which
  `migrate deploy` does not do.
- **The rename is replay-safe.** `home_hero_lockup_rename` renames a column that
  `trainer_home_hero` adds, so ORDER matters — and the timestamps put them in
  the right order.

## The risk that remains

**Twenty migrations apply as a queue, and Vercel runs them during the build.**
One failure blocks the other nineteen and the deploy dies. Everything checkable
has been checked; what cannot be checked from here is how they behave against
production's actual data volume.

---

## Order

1. **Schedule the two crons FIRST, before deploying.**
   `billing-reconcile` and `membership-reconcile` have never run
   (see the T-16 section of `audit-trainer.md`). Do it in the Supabase SQL
   editor — pg_cron, never `vercel.json`. Doing it first means the safety net is
   up before 203 commits land, which is exactly when you want it watching.

2. **Green suite immediately before pushing.**
   `npx vitest run && npm run test:e2e:full`

3. **Push.** `git push origin main`

4. **Watch the build actually appear.** Vercel's git auto-deploy has been
   unreliable here — see [[feedback_vercel_git_autodeploy_unreliable]]. If no
   build starts, `vercel deploy --prod`.

5. **Watch the migration step in the build log.** This is where a queue of 20
   would fail, and the error will not say "migration" — it will just be a red
   build. If one fails: `prisma migrate resolve --rolled-back <name>`, fix,
   redeploy.

6. **Smoke it.** `npm run smoke:prod`

7. **Re-run the cron check.** `npx dotenv -e .env.local -o -- npx tsx
   scripts/audit/cron-schedule-check.ts` — a deploy is exactly when schedules
   drift.

8. **Size the damage again.** `scripts/audit/withdrawn-unpaid-report.ts` — the
   fixes stop new cases; they do not clean up the old ones.

---

## Still open, and deliberately not done

- **The three stranded invoices** — NZD 150 at Paws And Thrive. One was already
  sent to a real client, so it wants a word rather than a silent disappearance.
  Karl deferred the data fix.
- **Discounts guard with `classes.manage`** — every Manager can write a rule
  that lowers what clients pay. A question, not a decision to make alone.
- **T-11** — removing a staff member destroys their recorded hours. Needs a
  schema change; parked because Timesheets was withdrawn.
- **Two smaller ones** — a deleted dog photo stays fetchable at its blob URL
  forever; one admin route 500s instead of 404ing on a bad id.
