# Migration baseline cutover (fixes the non-replayable history)

## Why
The current `prisma/migrations/` history **cannot be replayed from an empty DB**:
`20260428_add_product_requests` sorts before `20260428_add_products`, so a fresh
`prisma migrate deploy` fails with P3018 (`relation "products" does not exist`).
Prod is unaffected (it was built incrementally), but a new environment / disaster
recovery can't be rebuilt from migrations. This collapses the whole history into a
single clean baseline.

`prisma/baseline/migration.sql` is that baseline — generated from the current
schema with `prisma migrate diff --from-empty` and **verified** to replay cleanly
on a fresh Postgres (58 tables, no errors).

## ⚠️ Must be done as ONE coordinated operation, right before a deploy
The repo change (step 1) and the prod ledger reconcile (step 2) have to land
together. If the squashed folder deploys *before* prod is reconciled, `migrate
deploy` will try to run the baseline against prod (CREATE TABLEs that already
exist) and fail. Do not push step 1 on its own.

## Steps

1. **Swap the history for the baseline (repo):**
   ```bash
   # archive the old migrations (keep them out of prisma/migrations/)
   mkdir -p prisma/_migrations_archive
   git mv prisma/migrations/* prisma/_migrations_archive/
   # install the verified baseline as the single migration
   mkdir -p prisma/migrations/0_init
   git mv prisma/baseline/migration.sql prisma/migrations/0_init/migration.sql
   ```

2. **Tell prod (and every existing env) the baseline is already applied** — this
   only inserts a ledger row, it runs no SQL:
   ```bash
   npx dotenv -e .env.local -- npx prisma migrate resolve --applied 0_init
   ```
   (The old per-migration rows already in prod's `_prisma_migrations` are
   harmless — `migrate deploy` only acts on folders not yet recorded.)

3. **Verify a fresh DB rebuilds** (local, throwaway):
   ```bash
   createdb pupmanager_replay_test
   DATABASE_URL=postgresql://karl@localhost:5432/pupmanager_replay_test \
     npx prisma migrate deploy
   dropdb pupmanager_replay_test
   ```
   Should apply `0_init` and stop — clean.

4. **Deploy.** `migrate deploy` on prod now sees `0_init` already applied → no-op;
   new environments apply just `0_init`.

## Notes
- Don't rename/edit the *old* applied migration files instead — Prisma checksums
  applied migrations and matches folder names against prod's ledger, so any edit
  or rename desyncs prod and breaks `migrate deploy`. The baseline + `resolve`
  approach is the supported path.
- After cutover, future schema changes go back to normal `prisma migrate dev`
  (the history is replayable again from `0_init`).
