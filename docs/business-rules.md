# PupManager — business rules

The rules the platform actually enforces, written down so they can be argued
with and tested against. Every rule here was read out of the code, not
remembered: where a rule has a test, the test is named. Where it doesn't, it
says so.

**How to use this.** A rule id (`DOG-2`, `BOOK-3`) is a stable handle. Tests
reference them in their titles, so a failing test names the rule it broke. When
behaviour changes on purpose, change the rule here first — that's the argument;
the test is only the proof.

Statuses:

- **Enforced** — the code makes it true, and a test says so.
- **Enforced, untested** — the code makes it true; nothing guards it.
- **Intended** — the product means this, but nothing enforces it yet.

---

## Accounts and access

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| ACC-1 | One person's login can be both a trainer and a dog owner. A dog owner can belong to **several trainers** — their client record is per (person, trainer) pair, so switching trainers switches the whole app. | Enforced | `uat-two-trainers.spec.ts` |
| ACC-1a | Each trainer's offerings, sessions and messages stay with that trainer. Nothing bleeds between two relationships held by the same person. | Enforced | `uat-two-trainers.spec.ts` |
| ACC-1b | The switcher is reachable even when a trainer's intake is outstanding — being added by a new trainer must never trap someone away from the one they already use. | Enforced | `uat-two-trainers.spec.ts` |
| ACC-1c | A new trainer's intake starts from the phone number held on another of that person's relationships. Suggested only: it isn't written to the new trainer until they submit it. | Enforced | `uat-two-trainers.spec.ts` |
| ACC-1d | Switching is a URL, so it verifies ownership: you can only switch into a client record that is yours. | Enforced | `uat-two-trainers.spec.ts` |
| ACC-2 | Anyone registering gets a **10-day trial** and a business, before they've paid anything. | Enforced | `signup-journey.spec.ts` |
| ACC-3 | An email can hold **one account**. A second signup with the same email is refused, not silently merged. | Enforced | `signup-journey.spec.ts` |
| ACC-4 | A trainer must verify an emailed code before setting a password. Until then the account exists as a lead but can't be signed into. | Enforced | `signup-journey.spec.ts` |
| ACC-5 | Only the **account owner** can manage payouts and billing. Staff and managers authenticate as trainers but are refused. | Enforced, untested | `requireOwner()` in `/api/connect/account` |
| ACC-6 | A trainer can invite team members with roles; every trainer-side route checks a **named permission**, not just "is a trainer". | Enforced | `multi-trainer-permissions.spec.ts` |
| ACC-7 | Platform admin is a separate role. Trainers can't reach admin routes; dog owners can't reach trainer routes; nobody unauthenticated reaches anything. | Enforced | `pentest-surface.spec.ts` |
| ACC-8 | A business's data is invisible to every other business — reads, writes and deletes alike. | Enforced | `pentest.spec.ts`, `pentest-surface.spec.ts` |

## Dog owners and their dogs

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| DOG-1 | A dog owner can have **more than one dog**. One is the household's primary; the rest are additional. | Enforced | `round-trip.spec.ts` |
| DOG-2 | **Either side can add a dog** — the owner in their app, the trainer on the client record — and it appears for the other immediately. | Enforced | `round-trip.spec.ts` |
| DOG-3 | A dog belongs to exactly one client. Homework or a booking that names another client's dog is refused. | Enforced, untested | `/api/tasks` returns 400 "That dog does not belong to this client" |
| DOG-4 | Because an owner can have several dogs, they can **book several dogs onto the same thing at once** — up to 20, duplicates ignored. | Enforced | `uat-business-rules.spec.ts` |
| DOG-5 | A client's name and email live on their login; the phone lives on the client record. One person with two trainers has one name and two records. | Enforced | `client-form-fields.spec.ts` |

## What a trainer sells

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| SELL-1 | There are five kinds of offering: 1:1 packages, group classes, casual classes, events, memberships. They share one card, one list and one ordering. | Enforced | `offering-reorder.spec.ts` |
| SELL-2 | Each kind is an **add-on**. Switched off: the page redirects to Add-ons and the API refuses. | Enforced | `addons-setup.spec.ts`, `memberships-addon-gate.test.ts` |
| SELL-3 | The order a trainer drags their list into is the order **clients see** in the booking flow. | Enforced | `offering-reorder.spec.ts` |
| SELL-4 | Group classes, casual classes and events are all class runs underneath, but each lives in its own section, with its own back link, independent of the others' add-ons. | Enforced | `offering-section-routes.spec.ts` |
| SELL-5 | A membership bundles packages, class places and products into one purchase. | Enforced | `memberships.spec.ts` |
| SELL-6 | Only **published, one-off** memberships reach clients. Drafts, recurring ones and other trainers' are invisible. | Enforced | `memberships.spec.ts` |
| SELL-7 | A recurring membership can carry several billing options (per week / fortnight / month), each with its own price, minimum term and cancellation fee. Configurable now; **not purchasable** until mandates ship. | Intended | `memberships.spec.ts` covers the config |
| SELL-8 | A membership can only include offerings the trainer owns. | Enforced | `memberships.spec.ts` |

## Booking and enrolment

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| BOOK-1 | A **full enrolment** covers every session of a course. A **drop-in** covers one named session. | Enforced | `dropin-single-session.spec.ts` |
| BOOK-2 | A drop-in must say which session. Not naming one is a bad request — not "the class is full". | Enforced | `dropin-single-session.spec.ts` |
| BOOK-3 | A full course being full doesn't stop drop-ins into sessions that still have room. | Enforced, untested | `classSessionSpaces()` counts full seats on every session, drop-ins on their own |
| BOOK-4 | Self-booking offers **1:1 packages only**. A class has its own timetable and is booked by its sessions, not by picking any free hour. | Enforced | `self-book-wizard.spec.ts` |
| BOOK-5 | Times that have already passed are never offered, including later today. | Enforced, untested | past-filter in `startTimesFor()` |
| BOOK-6 | A session a client already holds is shown as theirs, not offered again. | Enforced, untested | `booked` flag on each session in the wizard |
| BOOK-7 | A client can enrol themselves; the enrolment appears on the trainer's roster immediately. | Enforced | `client-class-booking.spec.ts` |
| BOOK-8 | When a class is full, clients can join a waitlist if the trainer allows one. | Enforced, untested | `allowWaitlist` on the package |
| BOOK-9 | Drop-in mode only engages when a class carries a per-session price. Allowing drop-ins without pricing them leaves clients on the full-course path. | Enforced | `client-class-booking.spec.ts` |

## Money

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| PAY-1 | Client payments are **direct charges**: the trainer is merchant of record and pays Stripe's fee; the platform's margin rides on top as an application fee. | Enforced, untested | `connect-checkout.ts` |
| PAY-2 | Payments can't be switched on until Stripe has actually enabled charges on the connected account. | Enforced, untested | 409 "Finish payment setup first" |
| PAY-3 | A **paid** add-on needs a live subscription. A trialist is told to subscribe — and the add-on is not switched on behind the refusal. | Enforced | `addons-setup.spec.ts` |
| PAY-4 | A free add-on switches on immediately, no billing involved. | Enforced | `addons-setup.spec.ts` |
| PAY-5 | Stripe needs the **country code**, not the country name. The address country is free text, so it's normalised before use. | Enforced | `connect-country-code.test.ts` |
| PAY-6 | Enrolling a client in a priced class raises an invoice; a drop-in is billed per session, not per remaining session. | Enforced | `dropin-single-session.spec.ts` |
| PAY-7 | Every price is shown in the trainer's own currency, across six currencies. | Enforced, untested | `money.ts`, `useCurrency()` |

## Messages and notifications

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| MSG-1 | There are 23 kinds of notification. Each has its own copy and its own icon — none falls back to a generic bell. | Enforced | `notification-coverage.test.ts` |
| MSG-2 | Opening a notification feed marks what's in it as read — for **both** trainers and dog owners. | Enforced | `notifications-all-types.spec.ts` |
| MSG-3 | Chats belong in Messages, not the notification bell. | Enforced | `notifications-all-types.spec.ts` |
| MSG-4 | Automated messages hang off a **session** for classes and 1:1 packages, and off the **purchase** for memberships (which have no timetable). | Enforced | `comms-flows.test.ts`, `memberships.spec.ts` |
| MSG-5 | A step marked **Important** overrides a client's mute. A routine one respects it. | Enforced | `comms-flows.test.ts` |
| MSG-6 | Each client gets each message once, however often the scheduler runs. | Enforced | `comms-flows.test.ts` |
| MSG-7 | The email version of a message uses the rich body the trainer wrote; push and in-app use the short plain one. | Enforced | `comms-flows.test.ts`, `comms-flows.spec.ts` |
| MSG-8 | A platform announcement goes to trainers, dog owners, or everyone — and reaches only the audience chosen. | Enforced | `admin-to-client.spec.ts`, `admin-announcements.spec.ts` |

## Privacy

| id | Rule | Status | Proven by |
|----|------|--------|-----------|
| PRIV-1 | A session write-up is a **draft until it's sent**. An unsent write-up never reaches the client. | Enforced | `round-trip.spec.ts` |
| PRIV-2 | A trainer's phone number reaches the client app only when they've opted in. Not hidden with CSS — not sent at all. | Enforced | `admin-to-client.spec.ts` |
| PRIV-3 | A trainer's login email is private; clients see the business's public email. | Enforced, untested | `publicEmail` vs `User.email` |
| PRIV-4 | Anything a trainer or client types is displayed as text. Markup in a name is shown, not run. | Enforced | `client-form-fields.spec.ts` |

---

## Offering scenarios

The same offering type behaves differently depending on how it's set up. These
are the variants that change what actually *happens*, researched from the code
and then tested in `uat-offering-scenarios.spec.ts`.

### 1:1 packages

| Set up as | What the client gets | Status |
|-----------|---------------------|--------|
| **Fixed count** (`sessionCount: 3`, `weeksBetween: 1`) | Three sessions, a week apart, from the time they picked | Enforced |
| **Ongoing** (`sessionCount: 0`) | **One** seed session. Not zero — they'd have nothing to attend; not a runaway calendar. Ongoing assignments top up toward a horizon later | Enforced |
| **Instant** (`selfBookRequiresApproval: false`) | Booked then and there, sessions in the diary | Enforced |
| **Approval required** | A pending request carrying the times they asked for. **Nothing** in the diary until the trainer accepts | Enforced |
| **Special price set** | The special price is what they're shown and charged; the list price isn't quoted | Enforced |
| **Not self-bookable** (`clientSelfBook: false`) | Doesn't appear in the client's Offerings at all — the trainer assigns it | Enforced, untested |
| **Group** (`isGroup: true`) | Never offered on the 1:1 path; it has a timetable and is booked by its sessions | Enforced |

### Classes

| Set up as | What the client gets | Status |
|-----------|---------------------|--------|
| **Course only** | Enrol in the whole thing; one enrolment covering every session | Enforced |
| **Drop-ins allowed AND priced** | The session picker: choose which weeks. Each is its own enrolment | Enforced |
| **Drop-ins allowed, NOT priced** | Still the full-course path — the picker only appears once a per-session price exists. Worth knowing when a trainer says "I ticked drop-ins and nothing changed" | Enforced |
| **Full, waitlist on** | Offered the waitlist rather than a booking | Enforced, untested |
| **Full, waitlist off** | Shown as full, no way in | Enforced, untested |

### Memberships

| Set up as | What the client gets | Status |
|-----------|---------------------|--------|
| **One-off, published** | Visible in Offerings → Memberships, buyable | Enforced |
| **One-off, draft** | Invisible | Enforced |
| **Recurring, published** | Invisible, and the buy route refuses it (409) — configurable now, sellable when mandates land | Enforced |
| **Any, add-on off** | Invisible, and unbuyable even with an old link | Enforced |

### Multi-dog households

| Scenario | Behaviour | Status |
|----------|-----------|--------|
| Two dogs, one class, one booking | Two enrolments — one per dog, because the roster, capacity and invoice all count dogs | Enforced |
| The same dog listed twice | Collapses to one enrolment; nobody is charged twice | Enforced |
| Someone else's dog | Refused | Enforced |
| Two dogs into one drop-in session | Both booked onto that session | Enforced |

---

## Known gaps

Rules the product implies but the platform doesn't keep yet.

| Gap | Detail |
|-----|--------|
| **A trainer can't review the homework they've set** | Setting homework works and it reaches the client. But no trainer screen lists it: the client record's "Training log" tab shows the client's own practice logs, and homework set for a date appears nowhere. Only session-attached homework shows, on that session. |
| **Memberships can't be sold from a public booking page** | The buy route needs a signed-in client, so a stranger following a booking link can't buy one. |
| **Recurring memberships aren't purchasable** | The billing options save and display; nothing can subscribe to them until the mandate layer lands (SELL-7). |
| **Email and push delivery are unproven** | No mail or push credentials in the test environment, so sending is verified only up to the point of handing off. |
| **Card payments are unproven past the handoff** | Every paid flow is tested up to the Stripe redirect and no further. The biggest remaining hole, given payments are live. |
