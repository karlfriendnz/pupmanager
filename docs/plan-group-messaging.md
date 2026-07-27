# Group messaging — plan

**Status:** plan only. Nothing is built. Written 2026-07-27 on `feature/comms-flows`.
Numbers below are read live from the production database (read-only) on that date.

---

## Recommendation, in one paragraph

Build the **fan-out**: the trainer picks a group — a class, an offering, or a
hand-picked set of clients — writes one message, and PupManager drops it into
each of those clients' *existing private threads*. Each client sees a normal
message from their trainer. Each reply comes back as a normal private reply.
Nobody sees anybody else. This is the smallest change to the data model (one new
table, one nullable column), and it turns out to be much cheaper than expected,
because **the multi-select and floating action bar Karl asked for already exist**
on the clients list — they just only offer "Email" today. It also covers the
"announcement" case for free, because a private message you *can* reply to is a
strictly better announcement than one you can't. A **real group thread** — where
twelve dog owners see each other's names and messages — is a different and much
larger product with genuine consent and safety obligations; it should not ride
along in the same piece of work. And a good chunk of what people *mean* by
"message the class" is already built: **comms flows** already send timed
push/email to everyone enrolled on a class.

---

## 1. What exists today

### 1.1 The `Message` model — there is no such thing as a thread

`prisma/schema.prisma`, `model Message` (~L2213), table `messages`:

| field | notes |
|---|---|
| `channel` | `MessageChannel` = `TRAINER_CLIENT` \| `TRAINER_TRAINER` |
| `clientId` | **singular.** FK → `ClientProfile`, `onDelete: Cascade` |
| `senderId` | FK → `User` — the trainer *or* the client, whoever typed it |
| `body`, `bodyHtml` | plain + optional sanitised rich HTML |
| `readAt` | **one** nullable timestamp — works only because a message has exactly one reader |
| `emailFallbackSentAt` | stamped by the unread-message cron so it never double-emails |

**A "thread" is not an entity.** It is derived: *all `Message` rows with this
`clientId`*. No `Thread`/`Conversation` table, no participant table, no
per-recipient read state. A thread *is* a `ClientProfile.id`.

Two consequences that shape everything below:

1. **`Message.clientId` being singular is the crux.** Anything that is genuinely
   *one message seen by many people* needs a new model. Anything that is *the
   same words delivered N times* needs neither.
2. **`readAt` is overloaded three ways** — it is the unread counter, the read
   receipt, and the email-fallback trigger. Any change to read semantics touches
   all three. A shared message has N readers, so `readAt` simply cannot express
   "read" for one.

`clientId` → `ClientProfile`, which is the composite `(userId, trainerId)`. So a
message is already correctly scoped to *one person at one business*. That part is
right and needs no change.

### 1.2 The trainer's messages screen

`src/app/(trainer)/messages/page.tsx`. Constrains the UI more than the schema does:

- A thread is addressed by **query param**: `/messages?client=<ClientProfile.id>`
  (plus `?tab=active|inactive`). `messages/[clientId]/page.tsx` is a 14-line
  redirect stub kept alive only because push deep links still emit
  `/messages/${clientId}`.
- The conversation list is **not** a list of threads — it is
  `prisma.clientProfile.findMany({ where: { trainerId } })` with the last message
  and an unread `_count` nested in. **The list enumerates clients, not
  conversations**; every client appears whether or not a message exists. A group
  would have nothing to hang off in that query.
- Sorting is in JS: `lastMessageMs + (unread ? MAX_SAFE_INTEGER/2 : 0)` — unread
  floats to the top. This matters in §7.
- Unread `_count` uses `senderId: { not: session.user.id }`, but the "outgoing"
  tick uses `senderId !== c.userId`. A colleague's reply therefore counts as
  unread *for you* while rendering as outgoing. Pre-existing inconsistency; a
  fan-out will make it more visible, not worse.
- Gated behind the `clientapp` add-on; sending is gated by
  `guardPermission('messages.send')`.
- `loadMessages(clientId, trainerId)` is a **module-private** function in that
  same file (~L196), not a shared lib.

### 1.3 The client's side

`src/app/(client)/my-messages/`. **Yes, clients can reply** — full composer,
`maxLength 2000`, POSTing the same `/api/messages`. But it is the poorer
relation: a single thread with no list and no picker, and no `read` receipts at
all (the client component registers only the `message` SSE listener). Which
trainer's thread they see is decided by the `pm-active-trainer` cookie via
`getActiveClient()` (`src/lib/client-context.ts`), falling back to the most
recent `ClientProfile`. Trainer "preview" mode is carefully excluded from
marking anything read.

### 1.4 The SSE stream — resolved, and it is fine

`src/app/api/messages/stream/route.ts` is **database polling, not an in-process
event emitter.** No EventEmitter, no Redis. Every connection independently polls
Postgres, so it is already safe across serverless instances. Subscribers are
keyed **per `?clientId=`** (per thread), authorised for the requesting user.
1s poll, 15s heartbeat, 250s rotate-and-reconnect. Events: `open`, `message`,
`read`, `reconnect`.

**Implication for this plan: none.** A fan-out writes ordinary rows; whoever has
that thread open picks them up on the next poll. No stream changes are needed.
(Cost note, unrelated but worth knowing: each open thread is a long-lived
function doing ~2 queries/second for 250s.)

### 1.5 The email fallback already does the right thing

`src/app/api/cron/message-email-fallback/route.ts`, Supabase `pg_cron` every 15
minutes. `CLIENT_NEW_MESSAGE` has `emailDeferMinutes: 60`, so: push and in-app
fire immediately on send; the email only goes if the client *still* hasn't opened
the chat an hour later. It **groups by client**, so a burst becomes one email per
person, and it stamps `emailFallbackSentAt` on everything it considered so it is
O(new).

This is exactly the behaviour you'd want for a group send, and it is free. My
earlier worry that a batch of 40 would generate an email storm was wrong: it
generates at most one email per recipient, an hour later, only to people who
haven't looked. (Caveat: `take: 500` with no loop, so a backlog over 500 drains
500 per 15 minutes.)

### 1.6 What already fans out to many people

**Comms flows** — `src/lib/comms-flows.ts`, models `CommsFlowStep` /
`CommsFlowSend` / `CommsFlowTemplate` (schema ~L2925), cron
`api/cron/comms-flows` every 5 minutes via Supabase `pg_cron`.

A step attaches to exactly one offering — `ClassRun`, `Package`, or `Membership`
— and fires relative to each session (`BEFORE_SESSION` / `AFTER_SESSION`) or a
purchase (`AFTER_PURCHASE` / `BEFORE_PERIOD_END`).

- `CommsFlowAudience`: `ENROLLED` ("Everyone booked") | `ENROLLED_AND_WAITLIST`
  ("Booked + waitlist") | `CUSTOM` (`customClientIds: String[]`, "Chosen people")
  | `STAFF` ("Your team").
- `channels: NotificationChannel[]` — `PUSH` | `EMAIL` | `IN_APP`.
- `important: Boolean` overrides a client's opt-out.
- Tokens: `{{name}} {{dog}} {{time}} {{date}} {{class}} {{business}} {{location}} {{package}}`.
- `CommsFlowSend` dedups on `@@unique([stepId, sessionId, userId])`.
- **`IN_APP` is deliberately STAFF-only** (migration
  `20260726120500_comms_flow_in_app_staff_only`): *"the trainer bell reads
  Notification, the client feed shouldn't fill with duplicated reminder rows."*
  A decision, not an accident.

**Comms flows are timed only.** There is no "send now" endpoint, no `sendNow`
flag, no immediate-dispatch path anywhere. The editor's Preview sheet renders
sample copy on screen and sends nothing. **That is the actual gap.**

The class detail screen already has a **"Reminders & messages" tab**
(`src/app/(trainer)/classes/[runId]/run-detail.tsx`, `tab === 'messages'`) hosting
the comms-flow editor — the obvious home for "Send a message now", with no new nav.

**Marketing broadcast** — `POST /api/clients/email-bulk`, `EmailBroadcast` +
`EmailBroadcastRecipient`, UI at `src/app/(trainer)/marketing/`. Email only.
Respects `marketingEmailOptOut`, carries HMAC unsubscribe links, needs the
`marketing` add-on and a verified sending domain, and is rate-limited three ways:
10 sends/hour, 5 recipients/24h on trial or 500 on paid
(`src/lib/bulk-email-limits.ts`), 100 per Resend batch. A Resend webhook tracks
delivery/open/click/bounce and auto-suppresses bounces and complaints.

**The multi-select Karl asked for is already half-built.**
`src/app/(trainer)/clients/clients-list.tsx` already has `selectMode`,
a `Set<string>` of selected ids, "Select all (n)" over the *filtered* list,
per-row checkboxes, and a fixed dark floating action bar showing "{n} selected"
with an **Email** button. It opens `bulk-email-modal.tsx` → `/api/clients/email-bulk`.
**Only the "Message them" button is missing.**

**`notifyClient`** — `src/lib/client-notify.ts` (not `notifications.ts`).
Fire-and-forget, writes a `Notification` row and/or push and/or email, respecting
stored `NotificationPreference`. `Notification` is one-way, has no reply, and is
keyed on `User.id`, not `ClientProfile.id` — that is the structural reason it is
not a substitute for a message.

### 1.7 The most relevant prior decision in the repo: commit `6777586`

> **fix(marketing): a broadcast is not a conversation**
>
> Sending a marketing email copied itself into every recipient's
> `TRAINER_CLIENT` message thread. Three problems, one cause:
> - clients' messages filled with campaigns they cannot reply to;
> - the trainer's Comms tab listed every send TWICE, once as the broadcast and
>   once as the message copy;
> - the copy tripped the unread-messages cron, which had to be suppressed by
>   stamping `emailFallbackSentAt` — a workaround for a side effect of the row's
>   own existence, and the clearest sign the row shouldn't be there.

This is a direct challenge to the plan below, so answer it head-on. **The test
is: can the recipient reply, and will the trainer read it?**

| | reply expected? | belongs in `Message`? |
|---|---|---|
| Marketing campaign | no | **no** — 6777586's point |
| "Class cancelled tonight, rain" | yes, and fast | **yes** |
| Automated session reminder | no | no — stays a comms flow |

The repo already draws this line: the *single*-recipient branded email at
`/api/messages/email` **still writes a Message** (`body: "📧 {subject}\n\n{text}"`).
So the existing rule is precisely *a 1:1 email is a conversation turn, a
broadcast is not.* An operational group message is on the conversation side of
that line. But it inherits two of the three warnings:

- **Don't list it twice.** A batch appears once in the per-client Communication
  tab (`clients/[clientId]/page.tsx` merges `EmailBroadcastRecipient` + `Message`
  + `Notification`) and once in any batch history. It must not *also* send a
  Resend campaign.
- **The unread-email cron will fire.** As established in §1.5, that is now the
  desired behaviour, not a hazard — but it should be a stated decision.

### 1.8 Real numbers from production (2026-07-27, read-only)

| | |
|---|---|
| Trainers / clients / class runs | 40 / 323 / 109 |
| `Message` rows, all `TRAINER_CLIENT` | 298 (98 unread) |
| Distinct client threads with any message | 115 |
| Messages per thread — median / p90 / max | 3 / 3 / **16** |
| Enrolled per class run — avg / max | 2.7 / **17** |
| Clients per trainer — median / p90 / max | 2 / 53 / **87** |
| People with a client profile at >1 business | 2 |
| Email broadcasts ever sent / recipients | 2 / 41 |
| Comms flow steps / sends ever | 6 / **0** |

Read that honestly. **Messaging is barely used** (median thread: three messages)
and **comms flows have never fired once in production.**

Two things follow:

- The scale problems here are trivial. Largest realistic group is ~17; largest
  realistic bulk send is ~87. **Do not build for a scale this product doesn't have.**
- The *adoption* problem is the real one. Group messaging may fail for the same
  reason 1:1 messaging is quiet — not because it's missing, but because trainers
  already have a WhatsApp class group. Comms flows have the excuse of not being
  deployed yet; the messaging numbers don't.

---

## 2. What "group messaging" actually means — three different features

### (a) One-to-many announcement, no replies
"Class is cancelled tonight." **Mostly already built** — but only on a timer
(comms flows) or as marketing email (broadcast). The missing piece is "send now".

### (b) A real group thread
A shared conversation; members see each other's names and replies. A WhatsApp-style
class group. **Nothing like it exists.** Needs new message and participant models,
per-member read state, moderation, and a consent story.

### (c) Fan-out to private threads
One compose box, N private deliveries. Each recipient sees a normal message from
their trainer; each reply is a normal private reply. Recipients never learn who
else got it.

| | (a) Announcement | (b) Group thread | (c) Fan-out |
|---|---|---|---|
| Recipients see each other | no | **yes** | no |
| Replies | none | to everyone | private, 1:1 |
| New schema | none–small | large | 1 table + 1 column |
| Privacy work | low | **high** | low |
| Reuses list / unread / SSE / push / email fallback | n/a | **none of it** | **all of it, unchanged** |
| Already ~built | mostly | no | multi-select UI: yes |
| Rough effort | days | weeks | ~1.5–2 days |

### Build (c) first. Why:

1. **It is literally what was asked for**, and the clients-list multi-select,
   selection state and floating action bar already exist — only the button and
   the endpoint are missing.
2. **It subsumes (a).** Add a class/offering audience picker and "message the
   class" is done, with replies as a bonus.
3. **Zero privacy surface.** No client learns anything about another client.
4. **It reuses every working surface unchanged** — list, unread, SSE, push, the
   deferred email fallback. (b) reuses none of them.
5. **It doesn't foreclose (b).** They're different jobs, not versions of one job.

---

## 3. Privacy — a first-class concern

Only shape (b) creates the problem, and it is serious enough to be the reason (b)
is not first.

Dog owners handed their details to a *trainer*, not to a *cohort*. In a puppy
class of strangers, showing "Sarah (Bailey's mum)" to eleven other people is a
disclosure nobody agreed to. A trainer's client list is not a neutral group: it
can include people who are specific and careful about who can see their name and
contact them. Reactive-dog and behaviour-rehab clients in particular are often
there *because* something went badly wrong, and may not want a room of strangers
to know they're in that class.

PupManager is NZ-based with global reach — GDPR, CCPA and the Australian APPs all
apply. Under GDPR this is a **new purpose** for personal data already collected,
which is exactly the case where consent must be fresh and specific, not inferred
from an existing trainer relationship.

**Before a real group thread ships, all six of these must be true:**

1. **Opt-in per client, per group. Default off.** Not a trainer-side switch that
   opts the class in. Someone who ignores the invitation stays out, and the
   trainer can see they're out.
2. **Display name only.** First name, or a name the client picks for the group.
   Never `User.email`, never `ClientProfile.phone`, never `addressLine`, and no
   link to a client profile. (Precedent on the trainer side:
   `TrainerProfile.showPhoneToClients` gates a phone behind an explicit flag.)
3. **The trainer is always a participant and a moderator** — can delete any
   message, remove any member, lock the group.
4. **One tap to leave, and leaving sticks.** Re-enrolling next term must not
   silently re-add someone who left.
5. **No back-channel.** A member must not be able to open a 1:1 with another
   member from inside the group. PupManager's whole message model is
   trainer↔client; client↔client is a new relationship the product does not have
   and should not grow by accident.
6. **A retention answer.** When someone leaves or is deleted, do their existing
   messages disappear or become "Removed member"? Both are defensible; no answer
   is not.

There is a smaller point in shape (c) that is easy to miss: **never show the
recipient list to the recipients.** The client's copy must not say "sent to 17
people", and their reply must be visible only to the trainer's team.

---

## 4. Schema

### Migration rule for this repo (catches people every time)

`npm run db:push:dev` writes **no** migration file, but production runs
`prisma migrate deploy` inside `build`. So every schema change needs a
**hand-written** SQL migration at
`prisma/migrations/<timestamp>_<name>/migration.sql`, and it must use the `@@map`
**snake_case table names** (`messages`, `class_enrollments`, `client_profiles`),
not the Prisma model names — or `migrate deploy` fails `42P01` and takes the
whole build down.

Also: raw `prisma db push` / `prisma migrate` writes to **production** here,
because `datasource.directUrl = env("DIRECT_URL")` and `.env`'s `DIRECT_URL` is
the prod pooler. Always use `npm run db:push:dev`.

### 4.1 For (c) — the fan-out. One table, one column.

Modelled on two existing patterns: `EmailBroadcast` → `EmailBroadcastRecipient`,
and `Announcement` → `Notification` (whose schema comment already reads *"this
row is the editable source of truth / history; sending fans out one Notification
row per recipient User (the bell reads Notification, not this table)"*). Same
shape, third time.

```prisma
enum MessageBatchScope {
  MANUAL       // hand-picked from the clients list
  CLASS_RUN    // everyone on a ClassRun
  PACKAGE      // everyone holding a ClientPackage for a Package
  MEMBERSHIP   // everyone with an active MembershipPurchase
}

// Source of truth for one "send to many" action. Client threads read Message,
// not this table — this exists so the send can be listed once, deleted as a
// unit, and its replies grouped.
model MessageBatch {
  id             String            @id @default(cuid())
  trainerId      String
  senderId       String            // the User (owner/staff) who sent it
  scope          MessageBatchScope
  classRunId     String?
  packageId      String?
  membershipId   String?
  body           String            @db.Text
  bodyHtml       String?           @db.Text
  recipientCount Int               @default(0)
  createdAt      DateTime          @default(now())

  trainer  TrainerProfile @relation(fields: [trainerId], references: [id], onDelete: Cascade)
  classRun ClassRun?      @relation(fields: [classRunId], references: [id], onDelete: SetNull)
  messages Message[]

  @@index([trainerId, createdAt])
  @@map("message_batches")
}
```

and on `Message`, exactly one new field:

```prisma
  batchId String?
  batch   MessageBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)
  @@index([batchId])
```

That is the whole schema change. `clientId` stays singular and `NOT NULL`.
Everything reading `Message` today keeps working untouched.

`onDelete: SetNull` is deliberate: deleting the batch record should be a
*trainer-facing choice* about whether the messages go too, not a silent cascade.
Offer both — "remove this send from my history" vs "delete this message from all
17 threads" — and implement the second as an explicit
`deleteMany({ where: { batchId } })`.

**Recipient resolution is a pure function** — no new tables, because every
audience already has a model:

| scope | query |
|---|---|
| `CLASS_RUN` | `ClassEnrollment` where `classRunId`, `status: 'ENROLLED'` (+ `'WAITLISTED'` if asked), **deduped by `clientId`** |
| `PACKAGE` | `ClientPackage` where `packageId`, active |
| `MEMBERSHIP` | `MembershipPurchase` where `status: 'ACTIVE'` |
| `MANUAL` | the `ClientProfile.id[]` the trainer ticked |

Then always: **refetch server-side** under
`{ trainerId, id: { in: ids }, ...scopeForMember(guard, 'clients.viewAll') }` —
copy `email-bulk`'s approach so spoofed ids from another tenant can never
resolve — drop `status: 'INACTIVE'` unless explicitly included, drop `isSample`,
drop `NO_EMAIL_DOMAIN` addresses if emailing, and dedup.

Reuse `email-bulk`'s **per-recipient skip reasons** (`NOT_FOUND` / `SAMPLE` /
`NO_EMAIL` / `OPTED_OUT`) so the trainer sees "sent to 15, skipped 2" rather than
a silent shortfall.

### 4.2 For (b) — the real group thread. Do NOT touch `Message`.

The tempting move is to make `Message.clientId` nullable and add `groupId`. **Do
not.** It is a `NOT NULL` → `NULL` change on the busiest column in the feature,
and it silently changes the meaning of every existing query — the client-list
query in `messages/page.tsx`, the unread `_count`, `countUnreadMessages()`,
`unreadBadgeCountForUser()`, the per-client Communication tab, the SSE poll, and
the email-fallback cron. A group message would leak into one client's 1:1 thread
as "last message" the moment any of those missed a `groupId: null` filter. There
are dozens of such call sites and no compiler help for the ones that are
correct-but-now-wrong.

Build it as **separate models** instead:

```prisma
model MessageGroup {
  id         String    @id @default(cuid())
  trainerId  String
  classRunId String?             // usually anchored to a class
  name       String
  archivedAt DateTime?
  createdAt  DateTime  @default(now())
}

model MessageGroupMember {
  id           String    @id @default(cuid())
  groupId      String
  clientId     String?             // ClientProfile — a dog owner
  membershipId String?             // TrainerMembership — a staff member
  displayName  String              // the ONLY identity other members see
  invitedAt    DateTime  @default(now())
  joinedAt     DateTime?           // null = invited, not accepted. THIS is the opt-in.
  leftAt       DateTime?           // set on leave; survives re-enrolment
  mutedAt      DateTime?
  lastReadAt   DateTime?           // read WATERMARK — replaces Message.readAt

  @@unique([groupId, clientId])
  @@map("message_group_members")
}

model GroupMessage {
  id        String    @id @default(cuid())
  groupId   String
  memberId  String              // author, as a group member (not a raw User)
  body      String    @db.Text
  bodyHtml  String?   @db.Text
  deletedAt DateTime?           // moderation — tombstone, don't hard-delete
  createdAt DateTime  @default(now())

  @@index([groupId, createdAt])
  @@map("group_messages")
}
```

Two notes:

- **`lastReadAt` watermark, not per-message read rows.** A per-member,
  per-message read table is N×M rows for a feature whose largest real group is
  17 people. A watermark is enough for an unread count and costs one column.
- **`memberId` as author, not `userId`.** It makes the display-name-only promise
  structural rather than something every query has to remember.

Cost of (b), honestly: new models, a new SSE path (the existing one is keyed per
`clientId`), a new unread system, a new list surface on *both* apps, moderation
UI, an invite/consent flow, and a leave flow. Weeks, not days. Nothing from the
1:1 feature is reusable except the visual components.

---

## 5. What it does to existing surfaces

For **(c)**, in order of how much they change:

| Surface | Change |
|---|---|
| **Client's app** (`/my-messages`) | **None.** A normal message, replied to normally. |
| **SSE stream** | **None.** It polls the DB per open thread; fanned-out rows are picked up like any other. |
| **Unread badges** (all 11 surfaces, `pm:refresh-unread`) | **None.** Ordinary unread messages. |
| **`Message` reads everywhere** | **None.** `clientId` unchanged; `batchId` additive. |
| **Email fallback cron** | **None needed.** Push now, email in an hour only if unread, one per person. Already correct — just make it a stated decision, not a surprise. |
| **Clients list** (`clients-list.tsx`) | **Small.** Add a "Message" button beside the existing "Email" in the floating action bar; reuse `selectMode` / `selected` wholesale. |
| **Per-client Communication tab** | Small — it already merges broadcasts + messages + notifications. Tag batch messages so a group send doesn't read as a personal note. |
| **Class "Reminders & messages" tab** | Add "Send a message now" beside the comms-flow editor. Natural home, no new nav. |
| **Push** | Reuse `notifyMessageRecipient` / `CLIENT_NEW_MESSAGE`. N pushes instead of 1. |
| **Trainer messages list** (`messages/page.tsx`) | **The one real change.** Send to 17 people and 17 rows jump to the top with identical previews, because unread sorts first. Needs a collapsed "sent to 17 people" row or a visible batch marker, or the list is unusable right after every send. This is the main UI cost. |
| **Marketing broadcast / comms flows** | Untouched. Deliberately — see §8. |

---

## 6. Tests (repo rule: ship tests with the feature)

Per `AGENTS.md`, not optional:

- `tests/unit/**` (vitest, Prisma mocked via `vi.hoisted` + `vi.mock('@/lib/prisma')`):
  recipient resolution per scope; dedup of a client with two dogs in one class;
  `INACTIVE` and `isSample` exclusion; batch size cap; skip-reason reporting.
- `tests/unit/security/message-batch-route.test.ts`: a trainer cannot send to a
  `ClassRun` or `ClientProfile.id` from another business; `guardPermission('messages.send')`
  holds; the `clientapp` add-on gate holds; `scopeForMember` limits a staff member
  who lacks `clients.viewAll`.
- `tests/e2e/*.spec.ts` (Playwright, embedded Postgres): owner sends to a class,
  two seeded clients each see it in their own app, one replies, the trainer sees
  the reply in that client's thread and **not** in the other's. Plus one
  cross-tenant guard.

---

## 7. The failure surface

The cases that will actually generate support emails.

1. **Someone leaves the class mid-thread.** (c): nothing breaks — messages
   already delivered stay theirs; future batches don't include them. Correct, and
   free. (b): a real decision — do their old messages vanish or become "Removed
   member"?
2. **A client is deactivated** (`ClientProfile.status = 'INACTIVE'`). The messages
   list already buckets these separately. A batch must **exclude INACTIVE by
   default** and say so in the picker ("17 of 19 — 2 inactive"). Silently
   including them means messaging people who left months ago.
3. **A message sent to 40 people needs deleting.**
   `deleteMany({ where: { batchId } })` handles the rows. **It does not unsend.**
   The push has landed on 40 phones and the fallback email may have gone. The UI
   must say exactly that: *"This removes it from the app. Anyone already notified
   by push or email still has it."* Note there is currently **no delete or edit on
   a `Message` anywhere in the app** — so this is new ground either way, and a
   batch is precisely where trainers will first want it, because a typo you sent
   to one person is embarrassing and a typo you sent to forty is a phone call.
4. **Someone replies to a two-year-old broadcast.** Harmless in (c) — an ordinary
   message in an ordinary thread with the original above it. But `SetNull` means
   an old reply can outlive its batch; the UI must not assume `batch` is present.
5. **Forty replies at once.** With 87 clients at the top end, a well-received
   batch produces a burst of replies that all land as separate threads — and the
   list sorts unread-first, so it becomes a wall of near-identical rows. This is
   the failure mode most likely to make a trainer abandon the feature, and it is
   a *design* problem, not a bug. Group replies by `batchId` ("12 replies to
   *Class cancelled tonight*") in Phase 2, not as a nice-to-have.
6. **A trainer with two businesses.** `ClientProfile` is `(userId, trainerId)`, so
   scoping is already right — but the batch must carry `trainerId` and the
   resolver must filter on it at every scope, including `MANUAL`, where ids come
   from the browser and must never be trusted. Two people in production already
   hold profiles at more than one business. Staff sending on behalf of the
   business is already handled (`messages/page.tsx` treats any sender who isn't
   the client as "the business replying").
7. **Co-managed clients (`ClientShare`).** There is a **pre-existing
   inconsistency**: the SSE route honours `ClientShare`, but `GET`/`POST
   /api/messages` and `loadMessages` do not — so a co-manager can stream a thread
   they can't fetch or post to. Decide deliberately whether a batch resolver
   includes shared clients; don't inherit the ambiguity by accident.
8. **The same person twice.** A client with two dogs in one class has two
   `ClassEnrollment` rows; ticketed events can produce several per client via
   `ticketGroupId`. **Dedup by `clientId`** or people get it twice.
9. **Send volume.** 87 recipients = 87 rows (one `createMany`, fine), 87 pushes,
   and up to 87 deferred emails an hour later. `bulk-email-limits.ts` guards the
   marketing path; a message fan-out bypasses it entirely. Cap batch size and
   decide whether the deferred emails count against the same budget.
10. **Partial failure.** The `createMany` is atomic; the push loop is not. Copy
    `bulk-send-notes`'s idempotence trick — stamp state first, then loop — or
    `CommsFlowSend`'s unique-constraint dedup log, if retries turn out to matter.
11. **"Hi all".** Comms-flow steps support `{{name}}` / `{{dog}}`. If a batch
    doesn't, trainers will write impersonal copy — which undercuts the one real
    advantage the fan-out has over a WhatsApp group.

---

## 8. What NOT to build

- **Don't build a second scheduling engine.** Comms flows already do timed
  messages around every session, with audiences, channels and a dedup log. If
  "send it Friday at 9" comes up, extend `CommsFlowStep` — don't grow a scheduler
  inside batches.
- **Don't route operational group messages through the marketing broadcast.** It
  respects `marketingEmailOptOut`, carries an unsubscribe footer, needs the
  `marketing` add-on and a verified domain, and is capped at 5 recipients/day on
  trial. Every one of those is *wrong* for "tonight's class is cancelled" — a
  client who unsubscribed from newsletters has not opted out of being told the
  venue changed.
- **Don't write batch messages into the client's Notification feed.** Migration
  `20260726120500_comms_flow_in_app_staff_only` made `IN_APP` staff-only on
  purpose. A batch message belongs in Messages; the push is the notification.
- **Don't send a batch as a Resend campaign as well.** That is exactly the double
  listing 6777586 removed. One send, one record.
- **Don't make `Message.clientId` nullable.** See §4.2.
- **Don't revive `TRAINER_TRAINER`.** It's a dormant enum value the POST schema
  accepts but nothing reads — every read path hard-filters `TRAINER_CLIENT`. If
  staff-to-staff messaging is ever wanted it deserves its own design, not a
  half-wired channel.
- **Don't build (b) at all** unless Karl signs off on all six conditions in §3.
  "Not yet" is a legitimate outcome, and given a median thread depth of three
  messages in production, it is probably the right one.

---

## 9. Phasing and rough effort

Rough figures — relative sizes, not commitments.

**Phase 1 — the fan-out (~1.5–2 days).** Smaller than it looks because the
multi-select UI exists.
`MessageBatch` + `Message.batchId` + hand-written migration. Recipient resolver
with the four scopes, reusing `email-bulk`'s server-side refetch and skip
reasons. `POST /api/messages/batch` behind `guardPermission('messages.send')` +
`clientapp`. Two entry points: a **"Message"** button next to the existing
"Email" in the clients-list action bar, and "Send a message now" on the class
"Reminders & messages" tab. Push reuses `notifyMessageRecipient`. Unit + security
+ e2e tests. This alone answers the original ask.

**Phase 2 — living with it (~1–2 days).** Group the messages list by batch so a
17-way send doesn't flood it. Batch history + "delete from all threads" with the
honest "this doesn't unsend" warning. A marker in the per-client Communication
tab.

**Phase 3 — polish, only if Phase 1 gets used (~2–3 days).** `{{name}}` /
`{{dog}}` tokens shared with comms flows. Saved audiences. Schedule a batch for
later — implemented as a comms-flow step, not a new scheduler.

**Phase 4 — real group threads (weeks, and only after the §3 sign-off).**
Separate models per §4.2, opt-in invite flow, moderation, leave, new list
surfaces on both apps. Don't start until Phase 1 has shown that trainers message
through PupManager at all.

---

## 10. Open questions — only Karl can answer these

1. **Push and email, or in-app only?** The default falls out nicely (push now,
   email in an hour only if unread, one per person) but it is a cost and noise
   decision, not a technical one.
2. **Does a batch respect `marketingEmailOptOut`?** Proposal: **no** — batches
   are operational, and anything promotional goes through Marketing where the
   opt-out lives. Your call, because "operational" is a judgement the trainer
   makes, not the system.
3. **One place for replies, or forty threads?** Phase 2 assumes trainers want
   "12 replies to *X*" grouped. If plain threads are fine, Phase 2 shrinks a lot.
4. **Waitlist in or out by default?** Comms flows make it explicit
   (`ENROLLED_AND_WAITLIST`). Should the send-now picker default the same way?
5. **Is "the class" the clients or the dogs?** One client, two dogs enrolled —
   one message or two? (Proposal: one, deduped by client.)
6. **Do you ever want clients to see each other?** If the answer is "no, never",
   we can close (b) permanently and simplify a lot of thinking.
7. **Do co-managed clients (`ClientShare`) count as recipients?** Currently the
   codebase disagrees with itself; a batch forces a decision.
8. **Does the group send stay behind the `clientapp` add-on gate?**
9. **Batch size cap?** Proposal: 200, with a confirm step above 25.
10. **The uncomfortable one:** messaging is barely used — 298 messages, median
    thread of 3, and comms flows have never fired. Do you believe trainers will
    group-message *inside PupManager*, or are they already doing it in a WhatsApp
    class group they won't leave? If it's the latter, the honest first move is a
    short discovery conversation with Brooke and one or two real customers,
    before two days of build.

---

## 11. Things I could not determine from the code

None of these change the recommendation, but confirm before building:

- Whether any **delete or edit on a `Message`** exists anywhere. I found no
  route, no UI affordance, and no `mark-read` route (read state is a side effect
  of rendering, duplicated in three places with slightly different predicates) —
  but I did not exhaustively sweep the client app.
- Whether the **`clientapp` add-on** should gate a batch send at all, or only the
  Messages screen.
- Whether `Notification` rows written by comms-flows' `deliver()` (which, unlike
  `notifyClient`, sets **no `type`**) would need the same treatment for batches
  — moot if batches stay out of the feed as recommended.
- Real-world **behaviour under a genuinely large send.** With a production max of
  87 clients and 17 per class, nothing here has ever been exercised at scale, so
  the volume advice in §7.9 is reasoning, not measurement.
