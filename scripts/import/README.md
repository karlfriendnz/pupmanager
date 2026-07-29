# Client data import

Onboarding a client means taking whatever files they have — a spreadsheet kept
for eight years, a contacts export, a mailing list, a hand-typed list of
referral partners — and turning it into PupManager records without losing
anything and without inventing anything.

The toolkit is in **two halves that meet at `plan.json` and nowhere else**:

```
raw files ─► build_plan.py ─► plan.json ─► review.py ─► xlsx + html + csv
              (EXTRACT)           │                          │
                                  │                          └─► a human says
                                  │                              "no, that's not her dog"
                                  └─► import-client.ts ─► the database
                                          (LOAD)
```

| half | what it is | reads a DB? |
|---|---|---|
| **Extract & review** — `build_plan.py`, `review.py`, `lib/`, `sources/`, `clients/` | Python. Reads the client's files, merges them into one canonical plan, renders it for a human. Documented in **[README-extract.md](README-extract.md)** | never — stdlib + openpyxl only |
| **Load & target** — `import-client.ts`, `loader/`, and the rest of this file | TypeScript. Takes a plan and merges it into PupManager, with a backup and a stop in front of it | yes |

Both halves are **two-layer**: generic code that knows how messy data behaves,
plus a small per-client config that knows what one business's shorthand means.
Onboarding a new client is normally a config file, not code — the checklist is
in [README-extract.md](README-extract.md#onboarding-a-new-client).

The rest of this file is the **load half**.

---

## Load & target

This is the **load half** of the import toolkit: it takes a canonical plan and
merges it into PupManager. The **extract half** (`build_plan.py`, `review.py`,
`lib/`, `sources/`) turns a client's spreadsheets and exports *into* that plan.
The two halves meet at `plan.json` and nowhere else.

Generalised from `scripts/prime/import-plan.ts`, the one-off written for Journey
Dog Training. The merge semantics are that script's, unchanged — what is new is
that the target is an argument, that you can see what an import will do before it
does it, and that there is a backup and a stop between the plan and the database.

---

## The one command

```bash
./node_modules/.bin/dotenv -e .env.development.local -o -- \
  npx tsx scripts/import/import-client.ts <client folder> \
    --env .env.development.local \
    --trainer journey@pupmanager.dev \
    --email-namespace journey
```

```
backup  →  dry run  →  report  →  STOP  →  (you type the database name)  →  apply  →  verify
```

It stops every time. There is no flag that skips the stop, and the prompt refuses
to read from anything but a terminal — piping into it exits after the report
rather than proceeding.

A client folder is whatever the extract half produced:

```
clients/journey/
  plan.json          # required (import_plan.json also accepted)
  extracted.json     # optional — only used to recover class YEARS
```

---

## Safety — read this before running anything

**`DATABASE_URL` is exported in the ambient shell and points at a remote
database.** Everything below exists because of that one fact.

1. **Always use the dotenv wrapper, and always keep the `-o`.** Without
   `--override`, dotenv leaves the ambient (remote) `DATABASE_URL` in place and
   the command *reads* as local while *connecting* to production.

2. **`--env` is checked, not decorative.** Every script reads the env file you
   name, pulls its `DATABASE_URL`, and refuses if that is not the connection the
   process actually holds. This is what catches a missing `-o`:

   ```
   ✋ Connected to a different database from the one --env names.
      --env .env.development.local points at : localhost / pupmanager_dev
      this process is connected to: aws-1-....pooler.supabase.com / postgres
   ```

3. **Writes are refused anywhere but local `pupmanager_dev`.** `assertWritableTarget()`
   in `loader/guard.ts` is the single gate, and the dry run passes through it too
   — it rolls back, but it still opens a write transaction, so it is held to the
   same standard.

4. **Never run a Prisma CLI write command for import work.** `prisma migrate`,
   `prisma db push` and `prisma db execute` resolve **`DIRECT_URL`**, which `.env`
   fills with **production**. They ignore every guard here and every dotenv
   wrapper around them. The only way this toolkit touches a database is a `tsx`
   script run through the wrapper.

### Enabling a live target

There is deliberately **no flag, argument or environment variable** that permits
writing to a non-local database. Enabling one is a policy decision for the
repository owner, and it is exactly one line — in `loader/guard.ts`:

```ts
const allowed = isLocalSandbox(url)
```

Name the specific target, e.g.

```ts
const allowed = isLocalSandbox(url) || /ep-live-abc123/.test(url)
```

Naming the host means the permission is granted to **one** database, is visible
in the diff, and is reviewable in `git log`. Do not turn it into
`process.env.ALLOW_LIVE` or a `--live` flag — that hands the decision to whoever
happens to be running the command, which is the failure this toolkit is built
around. `--reset` stays refused against anything but local regardless.

---

## The scripts

| Script | What it does | Writes? |
|---|---|---|
| `target.ts` | Resolves and prints a target: host, database, business name, current client count. Verifies `--env` matches the live connection. | no |
| `dry-run.ts` | Runs the **entire import** inside one interactive transaction, then rolls it back. Reports exact created-vs-merged counts, class-name collisions, missing custom fields, and the net effect on every entity. | no (net) |
| `backup.ts` | `pg_dump` to a timestamped file. Refuses on a non-zero exit, an empty file, or a dump missing pg_dump's completion marker. | no |
| `apply.ts` | The real load. Same loader, no rollback. | **yes** |
| `verify.ts` | Re-reads the plan, works out what it *should* have produced, queries the database separately, explains every gap. | no |
| `import-client.ts` | The entry point: backup → dry run → stop → apply → verify. | **yes, after approval** |

Shared code lives in `loader/` (`guard`, `types`, `parse`, `engine`, `reset`,
`plan`, `cli`) — named so it cannot collide with the Python half's `lib/`.

---

## Why the dry run matters

It is not a simulation. The same loader runs, against the real database, through
every unique constraint and foreign key — the only difference is the `ROLLBACK`
at the end. So the counts it reports are exact, and a plan that would fail fails
*here* instead of halfway through a live load.

Verified against the real 685-person Journey plan: the dry run's predicted
statistics matched what `apply` actually did on **every one of the 23 counters**.

Each person is wrapped in a `SAVEPOINT`, because in Postgres one failed statement
aborts the whole transaction — without it a single malformed row would take the
dry run down and tell you nothing about the other 684.

`--reset` previews a wipe-and-reload: the delete happens inside the transaction
and rolls back with everything else. That is how you find out that reloading
would leave you with 12 fewer clients than you have now, *before* deleting them.

---

## Merge semantics (unchanged from the one-off)

- an existing record is **never overwritten** — blank columns are backfilled
- notes are **appended**, never replaced, and never duplicated
- dogs are deduped **by name** within a household
- courses are reused **by name** — a matching class run is joined, not duplicated
- enrolments / subscribers / consults are not written twice
- **re-running creates nothing new**

```
people[]                  → User (CLIENT) + ClientProfile (+ CustomFieldValue)
people[].dogs[]           → Dog (first = ClientProfile.dogId primary, rest additional)
courses[]                 → Package + ClassRun + N weekly TrainingSessions
people[].enrolments       → ClassEnrollment
people[].oneToOneConsults → Package (1:1) + ClientPackage
subscribers[]             → Subscriber
notes/accessCodes/afRefs/waitlist → ClientProfile.notes (labelled lines)
```

---

## `--email-namespace` — pin it, then leave it alone

People with no email address anywhere get a placeholder derived from
`hash(<namespace>:<person id>)`. That derivation is what lets a re-run recognise
the same person instead of creating a second copy — so **changing the namespace
after an import re-imports every email-less person as a duplicate**.

Resolution order: `--email-namespace` → `plan.meta.emailNamespace` →
`plan.meta.client` → `plan.meta.slug` → `"import"`.

The Journey/Prime one-off used **`prime`**. Re-running that plan through this
toolkit must pass `--email-namespace prime`, or its 9 email-less people arrive
again as new clients. New clients should set `meta.emailNamespace` in the plan so
nobody has to remember.

---

## Custom fields are dropped silently if they do not exist

A plan value whose label has no matching `CustomField` on the target trainer is
**not** written. The dry run lists every such label and how many values would be
lost; `verify.ts` exits non-zero when the total is short. Create the fields on the
trainer first (see `scripts/prime/ensure-fields.ts`) if you want them.

---

## Backups

Default location is `~/pupmanager-backups/` — deliberately **outside the repo**,
so a dump full of client data can never be committed by accident. Override with
`--out <dir>`.

`pg_dump` rejects Prisma's `?schema=` (and `connection_limit`, `pgbouncer`, …)
because libpq does not know those parameters, so they are stripped from the URL
before it runs; real libpq parameters like `sslmode` are kept.

Restore with:

```bash
psql "<connection>" < ~/pupmanager-backups/<file>.sql
```

---

## Running the pieces individually

```bash
D="./node_modules/.bin/dotenv -e .env.development.local -o --"
ARGS="--env .env.development.local --trainer journey@pupmanager.dev"
PLAN=/path/to/clients/journey

$D npx tsx scripts/import/target.ts  $ARGS
$D npx tsx scripts/import/backup.ts  $ARGS
$D npx tsx scripts/import/dry-run.ts $ARGS --plan $PLAN --email-namespace prime --json /tmp/report.json
$D npx tsx scripts/import/dry-run.ts $ARGS --plan $PLAN --email-namespace prime --reset   # preview a wipe+reload
$D npx tsx scripts/import/apply.ts   $ARGS --plan $PLAN --email-namespace prime [--atomic]
$D npx tsx scripts/import/verify.ts  $ARGS --plan $PLAN --email-namespace prime
```

Flags: `--reset` (local only), `--atomic` (one transaction, all or nothing),
`--dry-run-only`, `--skip-backup` (local only), `--out <dir>`,
`--extracted <path>`, `--json <path>`.
