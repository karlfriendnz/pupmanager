# Group messaging — plan

**Status:** plan only, nothing built. Written 2026-07-27 on `feature/comms-flows`.

## Recommendation in one paragraph

Build the **fan-out convenience** first: the trainer picks a group (a class, an
offering, or a hand-picked set of clients from the clients list), writes one
message, and PupManager writes it into each client's *existing private thread*.
Each client sees a normal message from their trainer. Each reply comes back as a
normal private reply. Nobody sees anybody else. This is the smallest change to
the data model, it is the shape Karl actually asked for ("multi-select on the
clients list → message them"), and it has no privacy problem to solve. A **real
group thread** — where 12 dog owners see each other's names and messages — is a
different, much larger product with real consent and safety obligations, and it
should not be bundled into the same piece of work. And a chunk of what people
*mean* by "message the class" is already built: **comms flows** already sends
timed push/email/in-app messages to everyone enrolled on a class.

---

## 1. What exists today (grounded in this repo)

### The `Message` model — there is no such thing as a thread

`prisma/schema.prisma`, `model Message` (~line 2213):

```
id, channel MessageChannel, clientId, senderId, body, bodyHtml,
readAt, emailFallbackSentAt, createdAt
client ClientProfile @relation("ClientMessages", ...)
sender User
```

`MessageChannel` is `TRAINER_CLIENT` | `TRAINER_TRAINER`.

**A "thread" is not an entity.** It is a derived thing: *all `Message` rows with
this `clientId`*. There is no `Thread`/`Conversation` table, no participant
table, no per-recipient read state — `readAt` is a single nullable column on the
message itself, which only works because a message has exactly one reader.

`clientId` points at `ClientProfile`, which is `(userId, trainerId)` — so a
message is already correctly scoped to one client **at one business**. That part
is good and does not need changing.

**This singular `clientId` is the crux of the whole plan.** Anything that is
genuinely one message seen by many people needs either a new join table or a new
model. Anything that is "the same words delivered N times" needs neither.

### What already fans out to many people

- **Comms flows** (`src/lib/comms-flows.ts`, `CommsFlowStep` / `CommsFlowSend`,
  ~line 2925 of the schema). Timed messages around each session of a class /
  package / membership, with an **audience** (`ENROLLED`, `ENROLLED_AND_WAITLIST`,
  `CUSTOM`, `STAFF`) and **channels** (push / email / in-app). A `*/5` cron sends
  them. This is already the "message everyone in the class" machinery — it just
  fires on a schedule rather than when the trainer taps send.
- **Marketing broadcast** — `POST /api/clients/email-bulk`, `EmailBroadcast` +
  `EmailBroadcastRecipient`. Bulk email with unsubscribe, rate limits
  (`src/lib/bulk-email-limits.ts`) and Resend webhook tracking.
- **`notifyClient`** / the `Notification` model — in-app + push notifications.

**Commit `6777586` is the most relevant prior decision in the repo:** it *stopped*
the marketing broadcast from copying itself into each client's message thread,
on the grounds that a broadcast is not a conversation. Any fan-out design has to
answer that objection head-on. (Detail filled in below.)

---

## 2. The three shapes of "group messaging"

| | (a) Announcement | (b) Real group thread | (c) Fan-out to private threads |
|---|---|---|---|
| Recipients see each other | no | **yes** | no |
| Replies | none / private | to the group | private, 1:1 |
| Schema change | small | large | tiny |
| Privacy work | low | **high** | low |
| Already ~built? | mostly (comms flows / broadcast) | no | no |

**Build (c) first.** Reasons: it is what was asked for, it reuses every existing
surface (thread list, unread badges, SSE, push, email fallback) unchanged, and
it creates no new privacy surface. (a) is largely covered already. (b) is a real
product with real risk — see §3.

---

## 3. Privacy — first class, not a footnote

Only shape (b) creates the problem, and it is a serious one.

Dog owners gave their details to a *trainer*, not to a *cohort*. In a puppy class
of strangers, exposing "Sarah, Bailey's owner" to eleven other people is a
disclosure they never agreed to. A trainer's client list can include people who
are specifically careful about who can contact them.

Before a real group thread ships, all of these must be true:

1. **Opt-in per client, per group** — default off. Not a trainer-side toggle
   that opts everyone in.
2. **Display name only** — first name or a chosen display name. Never the email,
   never the phone, never the address on `ClientProfile`, and no link to a
   client profile.
3. **Trainer-moderated** — the trainer can delete any message and remove any
   member; the trainer is always a participant.
4. **Leave, and stay left** — one tap to leave, and leaving is durable across
   re-enrolment.
5. **No back-channel** — a member must not be able to start a 1:1 with another
   member from the group.
6. **Deletion on withdrawal** — what happens to a member's messages when they
   leave the class; and a defensible retention answer for GDPR/CCPA/APP
   (PupManager is NZ-based, global reach).

If Karl is not ready to commit to all six, do not build (b).

---

## 4. Schema

*(Filled in below — see the detailed sections.)*

**Migration rule for this repo:** `npm run db:push:dev` writes **no** migration
file, but prod runs `prisma migrate deploy` as part of `build`. So every schema
change here needs a **hand-written** SQL migration in `prisma/migrations/`, using
the `@@map` snake_case table names (`messages`, `class_enrollments`), not the
Prisma model names — otherwise `migrate deploy` fails 42P01 and breaks the build.

---

## 5. What it does to existing surfaces

*(TBD)*

## 6. The failure surface

*(TBD)*

## 7. What NOT to build

*(TBD)*

## 8. Phasing and effort

*(TBD)*

## 9. Open questions for Karl

*(TBD)*
