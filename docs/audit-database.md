# Database audit — 2026-08-04

**Question asked:** is the database structurally sound?

**Short answer:** the shape is good. 117 tables, 192 foreign keys, all of them
real in the database, no drift between `schema.prisma` and the dev DB, no
orphaned rows found, no float sneaking into an invoice.

There are **5 things that will bite** and about a dozen that are untidy.

Everything was checked **read-only** against the local dev database
(`postgresql://localhost:5432/pupmanager_dev`), with the session forced to
`default_transaction_read_only=on`. Production was never touched. No rows were
created or deleted.

One throwaway database (`pupmanager_shadow_audit`) was created locally to replay
the migration history, and dropped afterwards. It contained no real data.

---

## The 5 that will bite

### 1. The migration history cannot rebuild the database

**Severity: high** — silent until the day it isn't.

`prisma/migrations/` has 238 folders. Replayed from an empty database it fails:

```
Migration `20260502_add_avail_cadence_and_blackouts` failed
ERROR: relation "availability_slots" does not exist   (42P01)
```

It's worse than an ordering bug. **13 tables have no `CREATE TABLE` anywhere in
the history at all** — they were made with `db push` and only ever altered by
migrations:

```
achievements            client_achievements   library_types
availability_slots      custom_field_values   packages
client_packages         custom_fields         session_form_responses
embed_forms             library_tasks         session_forms
                        library_themes
```

`packages` is in that list — the central offering table.

**How it was proven:**

```bash
createdb pupmanager_shadow_audit
npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma
# → P3006 / P3018 at 20260502_add_avail_cadence_and_blackouts
dropdb pupmanager_shadow_audit
```

and:

```bash
# tables in the DB that no migration ever creates
comm -23 <(psql "$DEV" -At -c "select tablename from pg_tables where schemaname='public' order by 1") \
         <(grep -rhoiE 'CREATE TABLE( IF NOT EXISTS)? +"?[a-z_]+"?' prisma/migrations/*/migration.sql \
           | sed -E 's/.*TABLE( IF NOT EXISTS)? +//' | tr -d '"' | sort -u)
```

**What goes wrong in practice**

- `npm run build` runs `prisma migrate deploy`. Prod survives only because its
  `_prisma_migrations` ledger already records everything.
- A **new environment** — a preview database, a staging box, a restore after an
  incident — cannot be built. The build stops.
- Nothing exercises the path, so nothing warns you. The e2e suite deliberately
  uses `db push` instead; `tests/e2e/global-setup.ts` line 2 says why. The dev
  database has no `_prisma_migrations` table at all.

**There is already a fix, and it has gone stale.**
`prisma/baseline/RUNBOOK.md` (10 June) describes exactly this problem and ships
a verified single-file baseline to collapse the history into. But that baseline
is **58 tables** and the schema is now **117**. It would need regenerating
before the runbook can be followed.

---

### 2. Deleting a class run destroys paid bookings and their invoices

**Severity: high** — money, and unrecoverable.

`DELETE /api/class-runs/[runId]` deletes a run with no check on whether anyone
has booked or paid. The cascade from `class_runs` reaches 11 tables:

```sql
select c.confrelid::regclass, c.conrelid::regclass
from pg_constraint c
where c.contype='f' and c.confdeltype='c'
  and c.confrelid::regclass::text = 'class_runs';
--  class_runs → class_enrollments, class_run_trainers, comms_flow_steps, training_sessions
--  training_sessions → session_attendance, session_attachments, session_form_responses,
--                      session_time_entries, session_buddies, comms_flow_sends,
--                      booking_automation_sends
```

The receivable raised for an enrolment is a **soft link** — `Invoice.sourceType
= 'CLASS_ENROLLMENT'` plus `Invoice.sourceId`, deliberately with no foreign key.
So the enrolment is deleted and the invoice is left pointing at a row that no
longer exists, with no way back.

**The same codebase already knows this.** `DELETE /api/packages/[packageId]`
(lines 383–400) refuses when a run has bookings or attendance, and the comment
there spells the reason out: *"cascading would leave invoices pointing at rows
that no longer exist, with no way back. Money and bookings are precisely what a
trainer cannot re-enter from memory."*

The direct class-run route has no such guard. It notifies the clients that the
class is cancelled and then deletes everything.

**Also**: `class_enrollments.dropInSessionId → training_sessions` is `Cascade`.
Deleting **one session** of a class deletes any drop-in enrolment sold for it —
a single paid booking, gone, with `payment_items.classEnrollmentId` set to null.

**Query to find the damage on any environment:**

```sql
select i."sourceType", count(*)
from invoices i
where i."sourceId" is not null
  and (   (i."sourceType"='CLASS_ENROLLMENT' and not exists (select 1 from class_enrollments e where e.id=i."sourceId"))
       or (i."sourceType"='PACKAGE'          and not exists (select 1 from client_packages  c where c.id=i."sourceId"))
       or (i."sourceType"='PRODUCT'          and not exists (select 1 from products         p where p.id=i."sourceId")))
group by 1;
```

Dev result: **0 rows** — but the dev database has only 2 invoices. Run this on
production.

---

### 3. The account purge leaves personal data behind, and takes accounting with it

**Severity: high** — GDPR on one side, the trainer's ledger on the other.

`GET /api/cron/purge-deactivated` hard-deletes users 30 days after they ask to
be removed. `prisma.user.delete` cascades into **99 tables**. Two problems, in
opposite directions.

**a) Rows that should go, don't.** These hold a `userId` / `clientId` /
`trainerId` as a **plain column with no foreign key**, so the cascade never
reaches them:

| Table | Column | What survives the purge |
|---|---|---|
| `notifications` | `userId` | every notification title + body, forever |
| `client_reminders_sent` | `sessionId`, `userId` | the reminder log |
| `comms_flow_sends` | `userId` | the send ledger |
| `timesheets` | `userId` | hours worked |
| `membership_purchases` | `trainerId`, `clientId` | the subscription record |
| `email_broadcasts` | `senderId` | who sent what |
| `dog_media`, `session_attachments` | `trainerId` | photos and videos |
| `audit_logs` | `actorUserId`, `companyId` | deliberate — audit is append-only |

Only the last one is on purpose (the route's own comment says so).

**b) Rows that shouldn't go, do — inconsistently.**

```sql
-- payments survive a client deletion; invoices do not
select conrelid::regclass, a.attname,
       case confdeltype when 'c' then 'Cascade' when 'n' then 'SetNull' end
from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=any(c.conkey)
where c.contype='f' and conrelid::regclass::text in ('invoices','payments') and a.attname='clientId';
--  invoices.clientId → Cascade
--  payments.clientId → SetNull
```

So deleting a client **keeps the payment and deletes the invoice it settled**.
The trainer's books stop balancing and nothing says why.

**c) Dogs are left ownerless.** `Dog.owner` is an optional relation with no
`onDelete`, which Prisma resolves to SetNull. Deleting a client sets
`dogs.clientProfileId = null`; the dog, its name, its date of birth and its
photos (`dog_media` cascades from `dogs`, not from the client) all stay.

```sql
select count(*) from dogs d
where d."clientProfileId" is null
  and not exists (select 1 from client_profiles c where c."dogId" = d.id);
-- dev: 0 of 10 (the 2 with a null column are primary dogs, linked from the other side)
```

---

### 4. The weekly summary reads the wrong week west of UTC

**Severity: medium** — wrong email, every week, for any trainer in the Americas.

`training_tasks.date` is `@db.Date` — a calendar day, stored at UTC midnight.
`src/lib/timezone.ts` has `dateOnlyUtc()` for building bounds against it, and
the doc comment on that function is explicit:

> `startOfDayInTz` is the wrong tool here and was the bug: it returns the real
> instant of local midnight … That silently shifted the client home's "This
> week" homework window one day west for every zone ahead of UTC.

`src/app/api/cron/weekly-summary/route.ts` line 132 still uses it:

```ts
const nextStart = startOfDayInTz(fmtYmd(nextStartDate), u.timezone)   // an INSTANT
const nextEnd   = endOfDayInTz(fmtYmd(nextEndDate),   u.timezone)
...
prisma.trainingTask.findMany({
  where: { client: { trainerId, isSample: false },
           date: { gte: nextStart, lte: nextEnd } },   // ← @db.Date column
})
```

For `America/Los_Angeles` (UTC−7), `nextStart` for day D is `D 07:00Z`. A task
dated D is stored as `D 00:00Z`, which is **less than** the bound — so Monday's
homework is dropped and the following Monday's is pulled in. The whole window
slides one day.

For NZ (UTC+12) the arithmetic happens to land right, which is why nobody has
seen it.

`app/(client)/home/page.tsx` gets this right (`weekBoundsUtcDates`) — it was
fixed there and not here.

Same shape, lower stakes, in four "last 7 days" filters that compare a
`@db.Date` against `new Date(Date.now() - 7*24*3600*1000)`:
`schedule/page.tsx:344`, `progress/page.tsx:28`, `dashboard/page.tsx:103`,
`api/schedule/week/route.ts:138`, `api/ai/summarise-progress/route.ts:49`.
Off by at most a day on a rolling window — cosmetic, but the same mistake.

---

### 5. A client can be enrolled in the same class twice

**Severity: medium** — money, and it looks like a system fault to the trainer.

```prisma
@@unique([classRunId, clientId, dogId, dropInSessionId])
```

For a **full** enrolment `dropInSessionId` is null, and Postgres treats NULLs as
distinct — so the index never fires. The schema comment admits it:

> *"this index never fires on a FULL enrolment (dropInSessionId is null); the
> real rule lives in code."*

A double-tapped Enrol under any concurrency creates two enrolment rows and two
`payment_items`. The database will not stop it.

`session_buddies(sessionId, clientId, dogId)` has the identical hole (nullable
`dogId`), with smaller consequences.

**Fix shape**: a partial unique index — `CREATE UNIQUE INDEX … ON
class_enrollments ("classRunId","clientId") WHERE "dropInSessionId" IS NULL AND
"dogId" IS NULL` — or `coalesce(dogId,'')` in the key.

---

## Untidy — worth fixing, won't wake anyone up

### 6. 34 foreign keys have no index

Postgres does not index a foreign key for you. Every parent delete then scans
the child table, and so does every `where parentId = …` read.

```sql
with fk as (
  select c.conrelid tbl, c.conrelid::regclass::text tname,
    (select string_agg(a.attname,',' order by ord)
       from unnest(c.conkey) with ordinality k(attnum,ord)
       join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum) colnames
  from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace),
idx as (
  select i.indrelid tbl,
    (select string_agg(a.attname,',' order by ord)
       from unnest((i.indkey::int2[])[0:i.indnkeyatts-1]) with ordinality k(attnum,ord)
       join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum) colnames
  from pg_index i join pg_class c on c.oid=i.indrelid
  join pg_namespace n on n.oid=c.relnamespace where n.nspname='public')
select fk.tname, fk.colnames from fk
where not exists (select 1 from idx where idx.tbl=fk.tbl
                  and (idx.colnames = fk.colnames or idx.colnames like fk.colnames||',%'))
order by 1;
```

**The three worth doing first** are tenant-scoping columns — a table scan per
trainer is a latency bug waiting for scale:

- `product_variants.trainerId`
- `training_templates.trainerId`
- `client_notifications.trainerId`

`training_templates` and `template_tasks` have **no index at all besides the
primary key**.

The rest, in rough order of how much traffic they'll see:
`stock_movements.variantId`, `template_tasks.templateId`,
`client_achievements.achievementId`, `products.categoryId`,
`class_enrollments.dogId`, `training_sessions.dogId`, `training_tasks.dogId`,
`booking_requests.packageId`, `payment_items.productId/variantId`,
`product_requests.variantId/fulfilledSessionId`, `stock_movements.clientId/userId`,
`message_groups.classRunId`, `session_buddies.dogId`, `client_profiles.dogId`,
`client_profiles.intakeFormId`, `client_shares.sharedById`,
`trainer_todos.createdById/assignedToId`, `trainer_brain_dumps.userId`,
`time_entries.rateId`, `trainer_addons.itemId`, `enquiries.formId/unifiedFormId`,
`forms.continueIntakeFormId`, `embed_forms.autoReplyTemplateId`,
`subscribers.sourceLeadMagnetId`, `trainer_profiles.subscriptionPlanId/promoCodeId`.

### 7. 27 indexes are redundant

Each one is a single-column index that is already the leading column of a wider
index or unique constraint. They cost write throughput and nothing else. The
list is produced by the query in `tests/unit/schema-integrity.test.ts`'s
sibling analysis; the worst offenders are the ones on the busiest tables:

- `training_sessions(trainerId)` — covered by `(trainerId, scheduledAt)`
- `training_sessions(classRunId)` — covered by `(classRunId, cancelledAt)`
- `class_enrollments(classRunId)` — covered by the 4-column unique
- `packages(trainerId)` — covered by `(trainerId, visibleFrom)`
- …and 23 more of the same shape (`tags`, `forms`, `memberships`,
  `booking_pages`, `product_categories`, `trainer_memberships`, …).

### 8. Nothing enforces "exactly one of these columns"

The database has **zero CHECK constraints**:

```sql
select count(*) from pg_constraint where contype='c' and connamespace='public'::regnamespace;
-- 0
```

Prisma can't express them, so this is expected — but it means every
"exactly one of" invariant is code-only:

- `tag_assignments(packageId, productId)` — a row with **both** null, or **both**
  set, is accepted. The two uniques work exactly as their comment claims
  (verified), but neither one stops a pointer to nothing.
- `payment_items` — five nullable target columns, any combination allowed.
- `membership_items(packageId, classRunId, productId)` — same.
- `comms_flow_steps(classRunId, packageId, membershipId)` — all three optional,
  so a step can belong to nothing at all. This is also why the comms engine has
  no tenant column anywhere in it.
- `comms_flow_sends(stepId, sessionId, userId)` + `(stepId, purchaseId, userId)`
  — the send-once guard. It holds **provided exactly one anchor is set**; if
  both were ever null, neither unique fires and the same message can go out
  repeatedly. Code sets one; the database doesn't insist.

### 9. `Enquiry.clientProfileId` is unique on the wrong side

```prisma
clientProfileId String? @unique   // "Populated after Accept"
```

One client can therefore be the result of **one enquiry ever**. A returning
client sending a second enquiry would violate it, so
`lib/client-upsert.ts:enquiryClientBackLink()` checks first and silently drops
the link:

```ts
const taken = await tx.enquiry.findFirst({ where: { clientProfileId, id: { not: enquiryId } } })
return taken ? {} : { clientProfileId }
```

So the second enquiry has no forward link to the client it produced. The
check-then-write is also racy. The constraint should be a plain `@@index`.

### 10. Duplicate global notification preferences are possible

`@@unique([userId, companyId, type, channel])` with `companyId` nullable — and
null **is** the global row ("also what every pre-multi-org row is"). So the
uniqueness never applies to exactly the rows that matter most.
`api/notification-preferences/route.ts:163` does `findFirst` → `update`/`create`,
which under a double-tap writes two rows for one (type, channel). Readers use
`findMany` and take whichever comes back — a mute that appears to toggle itself.

### 11. Denormalised `trainerId` copies can drift

`dog_media.trainerId` and `session_attachments.trainerId` are described as
"denormalised for fast permission checks", with **no foreign key** and nothing
keeping them in step with the parent. Both are read to decide who may see a
photo.

Verified consistent today:

```sql
select 'dog_media',        count(*) from dog_media m join dogs d on d.id=m."dogId"
  join client_profiles c on c.id=d."clientProfileId" where c."trainerId" <> m."trainerId"
union all
select 'session_attachments', count(*) from session_attachments a
  join training_sessions s on s.id=a."sessionId" where s."trainerId" <> a."trainerId";
-- both 0
```

### 12. Two money columns are floats

```sql
select table_name||'.'||column_name, data_type from information_schema.columns
where table_schema='public' and data_type in ('double precision','real');
--  subscription_plans.priceMonthly | double precision
--  billing_items.priceMonthly      | double precision
```

Both are documented as NZD *reference* figures with Stripe authoritative, so
nothing is charged from them — but they are what a trainer reads on the billing
page. Everything else is `Int` (34 columns) with one correct
`Decimal(5,2)` for a percentage.

### 13. Id lists stored in arrays

`package_session_slots.assignedMembershipIds`, `comms_flow_steps.customClientIds`
and `link_pages.itemOrder` are `text[]` of row ids with no referential
integrity. Deleting a staff member leaves their id in every slot they were
assigned to.

### 14. Cross-tenant joins are only prevented by route code

The schema lets trainer A's tag be attached to trainer B's package, and trainer
B's client be enrolled in trainer A's run. Nothing structural stops it — the
guards are all in the API layer. Verified clean today:

```sql
select 'tag/package',   count(*) from tag_assignments t
  join tags g on g.id=t."tagId" join packages p on p.id=t."packageId"
  where g."trainerId" <> p."trainerId"
union all
select 'run/client',    count(*) from class_enrollments e
  join class_runs r on r.id=e."classRunId" join client_profiles c on c.id=e."clientId"
  where r."trainerId" <> c."trainerId"
union all
select 'session/client',count(*) from training_sessions s
  join client_profiles c on c.id=s."clientId" where c."trainerId" <> s."trainerId";
-- all 0
```

The structural fix, if it's ever worth it, is a composite key —
`@@unique([id, trainerId])` on the parent and a two-column foreign key from the
child — which makes a mismatched pair impossible rather than merely unwritten.

### 15. `Invoice.amountCents` is a cached total with nothing keeping it true

```sql
select i.id, i."amountCents", coalesce(sum(l."amountCents"),0)
from invoices i left join invoice_line_items l on l."invoiceId"=i.id
group by 1,2 having i."amountCents" <> coalesce(sum(l."amountCents"),0);
-- dev: 3 rows (12345/12345/9999 against no lines) — obviously seeded fixtures,
--      but it shows nothing enforces the sum.
```

Worth running on production before assuming it's fine.

---

## Checked and sound

These were examined and found correct. Listing them so "verified" and "not
looked at" are different things.

| Area | Result |
|---|---|
| **Schema vs dev DB drift** | None. `prisma migrate diff --from-config-datasource --to-schema` returns an empty migration. |
| **Foreign keys exist** | All 192 `@relation(fields:)` in `schema.prisma` have a real FK constraint in Postgres. No relation is modelled but missing. |
| **Migration table names** | All 238 migration files address tables by their `@@map` snake_case name. Zero use a PascalCase model name — the mistake that has broken a prod build here before. |
| **`@@map` coverage** | All 117 models have one, all snake_case. |
| **Orphan rows** | 36 targeted left-join queries across every unenforced reference (`notifications.userId`, `membership_purchases.trainerId/clientId`, `invoices.paymentId/mergedIntoId`, `booking_requests.*`, `membership_items.*`, `audit_logs.*`, …). **All zero.** Caveat: 87 of 117 tables are empty in dev, so this proves the queries, not production. Re-run them there. |
| **PackageSessionSlot regression** | Fixed and holding. `TrainingSession.packageSessionSlotId` is `SetNull`, so deleting a slot detaches its sessions instead of deleting a year of them. |
| **`TrainerProfile.trialEndsAt`** | All four signup paths now stamp it (`/signup`, `/register`, web OAuth in `lib/auth.ts:74`, Apple-native at `apple-native/route.ts:140`), as do `prisma/seed.ts` and both trainer-creation scripts. Zero rows have `subscriptionStatus TRIALING` with a null `trialEndsAt`. The *schema* still permits it — that's guarded by code in six places rather than by a default — but nothing is broken today. |
| **Money types** | 34 integer minor-unit columns, 1 correct `Decimal(5,2)` percentage, 2 documented display-only floats (§12). No float in an invoice, payment, refund or line item. |
| **Blackout / availability dates** | Correct. `@db.Date` values are converted with `.toISOString().split('T')[0]` and compared as `YYYY-MM-DD` strings (`lib/client-availability.ts:83`, `lib/availability.ts:94`). `lib/booking-slots.ts` pads its window by a day either side off UTC-midnight bounds. |
| **`Package.visibleFrom`** | Deliberately an instant, not a `@db.Date`, resolved with `startOfDayInTz` at save time — the correct call, and the schema comment explains why. |
| **`TagAssignment` double unique** | Does exactly what its comment claims. `(tagId, packageId)` never collides across product rows and vice versa; both are enforced when the column is non-null. The gap is the missing "exactly one" CHECK (§8), not the uniques. |
| **Primary keys** | Every table has one except `verification_tokens`, which is NextAuth's standard `@@unique([identifier, token])` shape and has a unique index. |
| **Timestamps** | All `timestamp without time zone` — Prisma's default; the client writes UTC. Consistent across all 117 tables. |
| **Tenant column coverage** | 45 models carry `trainerId`; the 72 that don't are child rows of something that does, genuinely global (plan/add-on/onboarding catalogues), or user-scoped auth rows. Five real gaps are named in §3 and §8 and pinned in the test. |
| **Cross-tenant data** | Eight join-based consistency checks across sessions, invoices, payments, enrolments, packages, tags and media — all zero (§11, §14). |

---

## The guard that was added

`tests/unit/schema-integrity.test.ts` — 16 tests, reads `prisma/schema.prisma`
and `prisma/migrations/**` and asserts rules rather than today's table list, so
it keeps holding as the schema grows:

1. Every model has a snake_case `@@map`.
2. Every model is reachable from a tenant — `trainerId`/`companyId`, or a
   **required** relation to something that is. The five real gaps from this
   audit are in the allow-list, each labelled `AUDIT GAP` with what's wrong.
3. Every foreign key is the leading column of some index. The 34 that aren't are
   a frozen debt list — new ones fail, and fixing one makes the test tell you to
   delete it from the list.
4. No money column is a `Float`, and integer money is named `…Cents` (Stripe
   mirrors excepted, each named with why).
5. Every relation declares `onDelete` explicitly — Prisma's invisible default is
   how §3(c) happened. The 11 legacy ones are listed with what they actually do.
6. `onDelete: SetNull` is only ever on an optional column, and the set of 44 is
   pinned so a 45th is a decision somebody made.
7. Nothing new cascades into a money table.
8. The `@db.Date` column list is pinned, so adding one forces a look at whether
   its reads use `dateOnlyUtc()`.
9. No migration file names a table by its Prisma model name.
10. The parser itself still finds a plausible schema — otherwise every rule
    above would pass vacuously on an empty list.

Not covered by tests, on purpose: orphan rows and bad data. A unit test over a
mocked Prisma can't see those. The queries are in this document; run them
against production.

---

## If you only do three things

1. **Regenerate `prisma/baseline/migration.sql` and run the runbook.** The
   database currently cannot be rebuilt from its own history.
2. **Put the packages route's guard on `DELETE /api/class-runs/[runId]`.**
   Refuse when there are bookings or attendance.
3. **Swap `startOfDayInTz` for `dateOnlyUtc` at
   `api/cron/weekly-summary/route.ts:132`.** One line.
