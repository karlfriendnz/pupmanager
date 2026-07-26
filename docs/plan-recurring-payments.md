# Plan — recurring client→trainer payments (memberships)

Status: **proposal, nothing built.** Written 2026-07-27 on `feature/comms-flows`.

---

## Recommendation, in one paragraph

Build it, but build it as **Stripe Subscriptions on the trainer's connected
account**, not as a home-made "charge them every month" cron. Stripe already
owns the hard parts — retrying a declined card, emailing about an expiring
card, handling a bank that demands the customer re-authorise, keeping the
billing date stable across months of different lengths. Writing that ourselves
is where money bugs live. The work is real but bounded: roughly **3–4 weeks**
split into three shippable phases, with the first phase (a client can subscribe,
get charged monthly, and cancel from inside the app) at about **8–10 days**.
The genuinely hard part is not taking the first payment — it is everything
after: what the client sees when their card fails, and what happens to a
half-paid membership when a trainer leaves PupManager. Those are answered by
policy, not by code, and there are open questions at the end that only you can
settle. **Do not start the build until those are answered**, because the schema
depends on them.

---

## Jargon, once

| Term | What it actually means here |
|---|---|
| **Direct charge** | The money is charged *on the trainer's Stripe account*. The trainer is the merchant — their name on the client's bank statement, their Stripe fee, their liability. PupManager takes a slice via an "application fee". This is what we already do. |
| **Connected account** | The trainer's Stripe account, created by us via Stripe Connect Express (`acct_…`). |
| **Platform account** | PupManager's own Stripe account. This is where trainer→PupManager subscription billing lives. Different account, different objects, no sharing. |
| **Customer** | A Stripe object representing the payer. Lives on ONE account only. A `cus_…` on the trainer's account is invisible from the platform account. |
| **PaymentMethod** | A saved card. Also account-scoped. |
| **SetupIntent** | Saving a card *without* charging it, and getting the bank's permission to charge it later. |
| **Mandate** | The client's recorded permission for future charges. Stripe records it; we should record our own copy too. |
| **SCA / 3DS** | The "approve this in your banking app" step. Required in the UK/EU; increasingly common elsewhere. It can be demanded again on a *renewal*, when nobody is sitting at the screen. |
| **Dunning** | The retry-and-chase process after a payment fails. |
| **Test clock** | A Stripe test-mode feature that lets us fast-forward time to see a renewal actually happen. |

---

## 1. What exists today (verified in this repo)

### 1.1 Client→trainer money: direct charges, one-off only

- `src/lib/connect.ts` — Connect Express account lifecycle, country→currency
  defaulting, and the platform-fee maths (`platformFeeBps`,
  `platformFeeAmount`). The header comment still says "destination charges";
  **that comment is stale** — the actual implementation is direct charges. See
  the note at `connect-checkout.ts:141-151`.
- `src/lib/connect-checkout.ts` — the single chokepoint for every purchase.
  - `createPaymentRecord()` writes a **PENDING `Payment` + `PaymentItem` rows
    BEFORE Stripe is called**, so the webhook can find it by
    `metadata.paymentId`.
  - `mintCheckoutSession()` calls
    `stripe.checkout.sessions.create({...}, { stripeAccount: payment.connectAccountId })`.
    That `stripeAccount` header is what makes it a direct charge.
  - Our cut is sent as `payment_intent_data.application_fee_amount`, and is
    **omitted entirely when it would be 0** (Stripe rejects 0).
  - Optional client-paid surcharge: if `TrainerProfile.passProcessingFeeToClient`,
    an extra grossed-up "Card processing fee" line is appended
    (`estimateProcessingSurcharge`).
- `src/app/api/webhooks/stripe/connect/route.ts` — fulfilment. Handles
  `account.updated`, `checkout.session.completed`, `payment_intent.succeeded`,
  `charge.updated`/`charge.succeeded` (fee backfill), `charge.refunded`,
  `charge.dispute.created`.

**Read this next bit carefully — it is the pattern the recurring work must
copy.** Fulfilment is made safe by four things stacked together
(`route.ts:146-229`):

1. The `PENDING → PAID` status transition is the idempotency guard.
2. That transition is **re-checked inside the transaction** so two concurrent
   webhook deliveries can't both fulfil.
3. An **integrity gate** before anything happens: the amount, currency, Stripe
   mode (`sandbox`), and the connected account on the event must all match the
   stored `Payment`. If any fails, we ack the webhook and do nothing. This stops
   a forged or mismatched `metadata.paymentId` from triggering a grant.
4. Retrievals are done **with the `stripeAccount` header** — the PaymentIntent
   lives on the trainer's account, not ours.

Any recurring design that doesn't reproduce all four is a regression.

### 1.2 Trainer→PupManager billing: subscriptions, but on the WRONG account

`src/lib/billing.ts` + `scripts/setup-billing.ts` + the subscription webhook at
`/api/webhooks/stripe` are our only working subscription code. It is a useful
*reference* and a **trap** if copied literally:

- It runs entirely on the **platform** account. Customers, Prices and
  Subscriptions there are ours.
- Recurring memberships run on the **connected** account. None of those Price
  IDs, Customer IDs, or the `loadPriceIndex()` lookup mean anything there.

What genuinely transfers:

- **The dual-mode pattern.** `stripeFor(sandbox)` picks the live vs test key
  pair off `TrainerProfile.sandboxBilling`. Every Stripe call in the new code
  must go through it. Every new row must carry a `sandbox` boolean, like
  `Payment.sandbox` and `MembershipPurchase.sandbox` already do.
- **The webhook shape** — dual signing-secret verification (try live secret,
  then test secret; whichever verifies tells you the mode). Copy
  `connect/route.ts:57-91` exactly.
- **Storing a price id per currency in the DB rather than in code**
  (`resolvePriceId`). The idea transfers; the table does not, because Prices
  will now be per-trainer.

### 1.3 The rollout gate — the allowlist is GONE

**Confirmed.** `CONNECT_LIVE_ALLOWLIST` does not exist anywhere in the
codebase. `connect-checkout.ts:137-139` says so in as many words:

> "No connected account, no charge. This is the money chokepoint now that the
> rollout allowlist is gone."

So the live/test split today is:

- **`TrainerProfile.sandboxBilling`** — routes that trainer's Stripe calls to
  the test key pair. Demo/seed trainers have it `true`
  (`src/lib/demo-seed.ts:1562`). It is also what other systems use as a "not
  real money" flag — e.g. `invoicing.ts:631` refuses to send a sandbox invoice
  outside development.
- **`TrainerProfile.acceptPaymentsEnabled` + `connectChargesEnabled` +
  `connectAccountId`** — the three-way check every buy route makes. No account,
  no charge.

Any rollout plan must be built on these, not on a reinstated allowlist.

### 1.4 The membership model

`prisma/schema.prisma` (~line 3100 onward):

- **`Membership`** — `priceCents`, `cadence` (`ONE_OFF` | `RECURRING`),
  `interval` (`WEEK` | `FORTNIGHT` | `MONTH`), `minTermCount` (minimum
  commitment in cycles, 0 = cancel any time), `earlyTermFeeCents`, `published`,
  `slug`, plus storefront styling.
- **`MembershipPlan`** — a recurring membership can offer several billing
  options ($10/wk OR $35/mo). Each has its own `interval`, `priceCents`,
  `minTermCount`, `earlyTermFeeCents`. The schema comment already says these
  are "not purchasable until recurring billing (mandates) ships". **This is the
  row a subscription will be sold against.**
- **`MembershipItem`** — what's included. Note `regrantOnRenewal: Boolean` —
  already there, currently unused. It decides whether a bundled product is
  granted once or every cycle.
- **`MembershipPurchase`** — `status`, `purchasedAt`, `currentPeriodEnd`
  (marked "RECURRING", currently never written), `committedUntil` (end of the
  minimum term), `paymentId`, `sandbox`. **The recurring fields already exist
  and are dead. Phase 1 brings them to life rather than adding new ones.**
- **`MembershipRequest`** — the interim ask-the-trainer flow, with `reason`,
  `status`, `fulfilledAt`.

### 1.5 Where `buyable` is decided — in two places that agree

- `src/lib/client-memberships.ts:96` —
  `buyable: m.cadence === 'ONE_OFF' && m.priceCents > 0`, with
  `blockedReason: 'RECURRING' | 'NO_PRICE' | null`. The UI reads this rather
  than re-deriving the rule.
- `src/app/api/my/memberships/[membershipId]/buy/route.ts:36-38` — the 409:
  `"This is a recurring plan — not available to buy yet."`

Both must change together, or a card will offer a button the API rejects.

---

## 2. Stripe object shape

Everything below lives on the **trainer's connected account** and is created
with `{ stripeAccount: trainer.connectAccountId }`. Nothing new goes on the
platform account.

| Object | Where it lives | Notes |
|---|---|---|
| **Customer** (`cus_…`) | Trainer's account | **One per (client, trainer) pair.** A client who trains with two businesses has two, and they are not related. This mirrors the existing `ClientProfile` composite key of `(userId, trainerId)`. |
| **PaymentMethod** (`pm_…`) | Trainer's account | The saved card. Attached to that Customer. Cannot be shared with another trainer — a client with two trainers enters their card twice. That is a Stripe constraint, not a choice. |
| **SetupIntent** | Trainer's account | Only if we save a card without charging. If the first cycle is charged immediately (recommended), Stripe Checkout in `mode: 'subscription'` does the setup and the first charge in one step. |
| **Product + Price** (`prod_…`, `price_…`) | Trainer's account | **One recurring Price per `MembershipPlan` per currency, per mode.** Created lazily on first sale and cached on the row. A trainer editing the price does NOT mutate the Stripe Price (Stripe Prices are immutable) — it creates a new one, and existing subscribers keep the old. |
| **Subscription** (`sub_…`) | Trainer's account | The thing that recurs. One per `MembershipPurchase`. |
| **Invoice** | Trainer's account | Stripe raises one per cycle automatically. **We do not raise invoices ourselves.** |

### 2.1 The platform fee on a recurring charge

This is the one place the existing code does not transfer, and it needs a
decision.

One-off charges use `application_fee_amount` — a fixed number of cents, computed
by `platformFeeAmount()` at checkout. **Subscriptions do not accept that field.**
The two options are:

**Option A — `application_fee_percent` on the Subscription.** A single
percentage applied to every invoice, forever, automatically.
*Pros:* one field, set once, works for renewals with no code running.
*Cons:* it is a percentage only — no fixed component (we take none anyway, see
`connect.ts:110`), and it is **stored on the subscription**, so changing our
margin later requires updating every live subscription.

**Option B — set `application_fee_amount` on each invoice**, via the
`invoice.created` webhook, before it finalises.
*Pros:* exact control, same maths as one-offs.
*Cons:* a webhook must fire and succeed **inside a narrow window** before Stripe
finalises the invoice, or we take nothing on that cycle. Silent revenue loss.

**Recommendation: Option A.** Set
`application_fee_percent = platformFeeBps(currency) / 100` at subscription
creation, and store the value we used on our own row so a later margin change is
a visible, deliberate migration rather than an invisible drift. Option B's
failure mode (we quietly earn nothing) is worse than Option A's (we have to
run a script to re-price).

**Note on the surcharge.** `passProcessingFeeToClient` currently appends an
extra line to the checkout. For a subscription this has to become a **second
recurring Price** on the same subscription, or a small percentage baked into the
plan Price. Do not append a one-time line — it would only apply to the first
cycle and the trainer would silently under-recover from month two. **Simplest
Phase-1 answer: don't support the surcharge on recurring plans at all, and say
so in the trainer's plan editor.** Add it in Phase 3 if trainers ask.

---

## 3. Consent — what the client agrees to

A one-off charge needs no mandate: they clicked, they paid, it's over. A
recurring charge is different. We are asking permission to take money from a
card while nobody is watching. That has to be **explicit, specific, and
recorded**, and it is a legal requirement in most of our markets (UK/EU SCA
rules, Australian consumer law, NZ Fair Trading Act) as well as a Stripe
requirement.

### 3.1 What is shown before they confirm

A dedicated confirmation screen (full screen, per the house style in
`AGENTS.md`) before the Stripe Checkout redirect, stating in plain words:

- **Who is charging them** — the trainer's business name, not "PupManager".
  They are paying the trainer.
- **How much and how often** — "$400 every month", with the currency symbol
  from `formatMoney()` / `useCurrency()`.
- **When the first charge is** and **when the next one is**.
- **The minimum term, if any** — from `MembershipPlan.minTermCount`: "You're
  committing to 3 months. If you cancel before then there's a $X early-finish
  fee" (`earlyTermFeeCents`). If `minTermCount` is 0, say **"Cancel any time"**.
- **That it continues until cancelled**, and **where to cancel** — "You can
  cancel any time from Memberships in this app." Naming the exact screen is the
  difference between a self-serve cancellation and a support email.
- **What they get** — the resolved `MembershipItem` list, which
  `loadPublishedMemberships()` already builds.

A required checkbox: *"I agree [Trainer] can charge my card $X every month
until I cancel."* Not pre-ticked.

### 3.2 Where it is recorded

A `MembershipConsent` row written **before** the Stripe redirect (same pattern
as the PENDING `Payment`), holding: the client id, the membership + plan id, the
exact price/interval/currency shown, the **verbatim consent text**, a version
string for that text, the timestamp, and the IP + user agent. Then the
Stripe-side `mandate` id is written back on success.

Storing the verbatim text matters. In a dispute six months later, "our template
at the time said X" is a much weaker answer than "here is exactly what they were
shown, here is the tick, here is the timestamp."

### 3.3 Stripe's side

Stripe Checkout in `mode: 'subscription'` collects the mandate and shows its own
terms. We still show ours, because Stripe's page is generic and does not know
about minimum terms or early-finish fees.

---

## 4. Schema changes

Every one of these needs a **hand-written SQL migration** in
`prisma/migrations/`. `npm run db:push:dev` writes no migration file, and prod
runs `prisma migrate deploy` — a pushed-but-unmigrated column is a prod build
break. And per
`~/.claude/.../feedback_prisma_migration_table_names.md`: **hand-written SQL must
use the `@@map` snake_case table names** (`membership_purchases`, not
`MembershipPurchase`), or `migrate deploy` fails 42P01 and takes the build down.

### 4.1 `MembershipPlan` — cache the Stripe Price ids

```
stripePriceId          String?   // live mode
stripePriceIdTest      String?   // sandbox mode
stripeProductId        String?
stripeProductIdTest    String?
```

Two columns per thing, mirroring `BillingItem`'s live/test split in
`billing.ts:24-28`. A trainer changing `priceCents` must **null these out** so
the next sale mints a fresh Stripe Price (Prices are immutable).

Also needed on `Membership` itself for a recurring membership with no
`MembershipPlan` rows (it carries `priceCents` + `interval` directly) — either
add the same four columns there, or, cleaner, **backfill a `MembershipPlan` row
for every RECURRING `Membership` that has none** and make plans the only path.
Prefer the backfill: one code path is worth a migration.

### 4.2 `MembershipPurchase` — the recurring fields, now live

```
planId                 String?   // which MembershipPlan was bought
stripeSubscriptionId   String?   @unique
stripeCustomerId       String?
status                 → add PAST_DUE, CANCELLING, CANCELLED, PAUSED
currentPeriodStart     DateTime?
cancelAtPeriodEnd      Boolean   @default(false)
cancelledAt            DateTime?
cancelReason           String?
lastPaymentFailedAt    DateTime?
failedPaymentCount     Int       @default(0)
applicationFeePercent  Decimal?  // what we actually set, for audit
```

`currentPeriodEnd` and `committedUntil` already exist and are unused —
Phase 1 starts writing them.

`CANCELLING` vs `CANCELLED` is not pedantry. "I cancelled but I still get my
sessions until the 14th" and "I'm cut off" are different states and the client
screen must show different words for them.

### 4.3 New: `MembershipConsent`

```
id, clientId, membershipId, planId
priceCents, currency, interval
consentText     String @db.Text   // verbatim
consentVersion  String
stripeMandateId String?
ipAddress, userAgent
createdAt
```

### 4.4 New: `StripeWebhookEvent` (idempotency ledger)

```
id            String  @id      // Stripe's event id, evt_…
type          String
accountId     String?          // connected account
sandbox       Boolean
processedAt   DateTime @default(now())
```

Primary key on Stripe's own event id. Insert-or-skip at the top of the handler.
See §6 — this is the single highest-value defensive change in the plan, and it
protects the existing one-off flow too.

### 4.5 New: `MembershipInvoice` (a row per cycle)

```
id, membershipPurchaseId
stripeInvoiceId  String @unique
periodStart, periodEnd
amountDue, amountPaid, currency
status            // DRAFT | OPEN | PAID | UNCOLLECTIBLE | VOID
paymentId         String?   // link to a Payment row if we create one
attemptCount      Int
sandbox           Boolean
```

Needed for the client's "here's what you've been charged" history, for the
trainer's earnings screen, and for Xero. **Do not try to reuse `Payment` as the
per-cycle record without care** — see §6.

---

## 5. The failure surface

This is the point of the plan. Every one of these will happen; most will happen
in the first hundred subscriptions.

### 5.1 Card expires

Stripe emails the customer if the connected account has that setting on (it is
on by default for Express accounts, but **verify per account — we can't assume**).
Stripe also tries Card Account Updater on major networks and may silently get
the new number.

*What we do:* on `invoice.upcoming` (fires ~3 days before renewal, if enabled),
check the PaymentMethod's expiry and notify the client in-app + email via
`notifyClient()`: *"Your card ending 4242 expires before your next payment to
[Trainer] on the 14th. Update it here."*

*What the client sees:* a card on their Memberships screen with a warning strip
and an **Update card** button that opens a Stripe-hosted card update. Not an
email they'll miss.

### 5.2 Insufficient funds / decline

Stripe fires `invoice.payment_failed`, marks the subscription `past_due`, and
starts its own retry schedule (Smart Retries, typically ~4 attempts over ~2–3
weeks; configurable per connected account in the Dashboard).

*What we do:* set `MembershipPurchase.status = PAST_DUE`, bump
`failedPaymentCount`. Notify client AND trainer.

*The real question — do the benefits stop?* Recommendation: **no, not
immediately.** Keep access through the retry window. Cutting a client off from
their dog's classes because a card bounced on a Tuesday is a bad experience and
they'll usually pay within days. Cut off only when Stripe gives up
(`customer.subscription.updated` → `unpaid`, or `.deleted`). **This is one of
the open questions in §10.**

*What the client sees:* a clear, non-shaming strip on the Memberships screen:
*"We couldn't take your payment of $400 on 14 July. We'll try again on the 18th.
Update your card if it's changed."* Plus a push + email. Never a silent failure.

### 5.3 SCA / 3DS demanded on a renewal

The nastiest case. A bank can require the customer to authenticate on a
*renewal*, when they're nowhere near their phone. Stripe fires
`invoice.payment_action_required` and the invoice sits open with a
`hosted_invoice_url`.

*What we do:* store that URL on the `MembershipInvoice` row and surface it as a
first-class action.

*What the client sees:* **"Your bank needs you to approve this payment"** with a
button that opens the Stripe-hosted page. This must be a push notification, not
just an in-app badge — the payment does not happen until they act, and nothing
in the app can act for them.

This is far more likely for UK/EU trainers than NZ/AU ones. If the pilot is
NZ-only it'll barely appear; do not let that lull you into skipping it before a
UK trainer goes live.

### 5.4 Client cancels

See §7 — it gets its own section because it's the thing most likely to be done
badly.

### 5.5 Trainer cancels a client's membership

From the trainer's membership screen. Options: **cancel at period end** (client
keeps what they've paid for) or **cancel now + refund the unused part**. Default
to period-end. Both call `stripe.subscriptions.update/cancel` with the
`stripeAccount` header, and both notify the client — a membership vanishing
without a word is a support ticket every time.

### 5.6 Refunds

Refunding a subscription invoice is refunding the underlying charge:
`stripe.refunds.create({ charge }, { stripeAccount })`. The existing
`charge.refunded` handler (`connect/route.ts:598-617`) already reconciles
`Payment.amountRefunded` idempotently from `charge.amount_refunded`, and will
work unchanged **if** each cycle also produces a `Payment` row.

**The application fee does not come back automatically.** When a trainer refunds
a client, our cut stays with us unless we pass `refund_application_fee: true`.
Charging a trainer a platform fee on money they gave back is indefensible.
**Decide: always refund our fee proportionally.** (Open question in §10, but the
answer is obvious.)

### 5.7 Disputes / chargebacks

`charge.dispute.created` already sets `Payment.status = DISPUTED`. For a
subscription, also **pause or cancel the subscription immediately** — continuing
to bill a card that has been disputed is how a trainer's Stripe account gets
shut down. Email the trainer; they own the dispute, not us (direct charges: the
trainer is merchant of record and the dispute fee is theirs).

### 5.8 Trainer disconnects Stripe or lapses

The scenario nobody plans for and everybody eventually hits.

- **Trainer switches `acceptPaymentsEnabled` off:** existing subscriptions keep
  charging (they live on their Stripe account). We must **either** cancel them
  or block the toggle while any active subscription exists. Recommendation:
  **block the toggle** with an explicit "You have 12 active subscriptions —
  cancel or transfer them first."
- **Trainer disconnects the Connect account entirely:** Stripe cancels or
  detaches; we get `account.application.deauthorized`. **We do not currently
  handle that event.** We should: mark every open `MembershipPurchase`
  `CANCELLED`, tell every affected client, and stop pretending they have a plan.
- **Trainer's PupManager subscription lapses (they stop paying us):** their
  clients' subscriptions keep running on Stripe regardless — the money flow
  doesn't touch us. That is arguably fine, but it means a churned trainer keeps
  billing clients through infrastructure we built. Needs a policy. **Open
  question.**

### 5.9 Amount changes mid-subscription

The trainer edits the plan from $400 to $450. Existing subscribers **must not**
silently jump. Recommendation: new price applies to **new** subscribers only;
changing an existing subscriber's price requires an explicit trainer action and
a notice to the client. Enforced by nulling the cached `stripePriceId` and
minting a new Stripe Price, leaving the old one attached to live subscriptions.

---

## 6. Webhooks and idempotency

This codebase already learned this lesson the hard way — raising an invoice per
row double-billed a purchase. The recurring flow multiplies the risk because
Stripe now sends events *forever*, not once per checkout.

### 6.1 New events to handle (all on the Connect endpoint)

| Event | What we do |
|---|---|
| `customer.subscription.created` | Activate the `MembershipPurchase`, stamp period dates |
| `customer.subscription.updated` | Sync status, `cancel_at_period_end`, period dates |
| `customer.subscription.deleted` | `CANCELLED`; revoke ongoing benefits |
| `invoice.paid` | Record a `MembershipInvoice` + `Payment`; regrant `regrantOnRenewal` items; roll `currentPeriodEnd` |
| `invoice.payment_failed` | `PAST_DUE`, bump counter, notify client + trainer |
| `invoice.payment_action_required` | Store `hosted_invoice_url`, push "your bank needs you" |
| `invoice.upcoming` | Pre-renewal reminder + card-expiry check |
| `account.application.deauthorized` | Cancel everything for that trainer, tell every client |

### 6.2 Idempotency — three layers, all of them

1. **Event ledger.** `INSERT` the Stripe `event.id` into `StripeWebhookEvent`
   at the top of the handler; if the insert conflicts, return 200 immediately.
   This is the only thing that reliably stops **replays** — the existing
   `PENDING → PAID` guard stops double-*fulfilment* but doesn't stop a
   re-delivered `invoice.paid` creating a second `Payment` row.
2. **Natural keys.** `MembershipInvoice.stripeInvoiceId` is `@unique`.
   `MembershipPurchase.stripeSubscriptionId` is `@unique`. Upsert against them
   rather than create. Even with a bug upstream, the DB refuses the duplicate.
3. **Re-check inside the transaction**, exactly as `markPaidAndFulfil` does at
   `route.ts:216-218`.

### 6.3 Idempotency keys on the outbound side too

Every `stripe.subscriptions.create` and `stripe.customers.create` gets an
`idempotencyKey` derived from our own ids (e.g. `sub:${membershipPurchaseId}`).
Without it, a client double-tapping **Subscribe** on a slow connection creates
two subscriptions and gets charged twice a month, forever, until someone
notices. This is the single most likely double-charge bug in the whole feature.

### 6.4 Ordering

Stripe does **not** guarantee event order. `invoice.paid` can arrive before
`customer.subscription.created`. Every handler must be able to create the rows
it needs, or safely defer. Do not write a handler that assumes a prior event
landed.

### 6.5 Do we create a `Payment` row per cycle?

**Yes.** It keeps the trainer's earnings screen, the refund handler, the
dispute handler and the Xero sync working with no changes. But create it in the
`invoice.paid` handler **keyed on the Stripe invoice id**, not by calling
`createPaymentRecord()` — that function appends a surcharge line and computes an
`application_fee_amount`, neither of which applies here. Write the `Payment` as
already-`PAID` with the actual amounts off the Stripe invoice.

---

## 7. Cancellation from inside the app

Non-negotiable. If a client has to email someone to stop a recurring payment, we
have built a dark pattern, and in several of our markets a legally
non-compliant one (the EU/UK expect the cancel to be no harder than the signup;
California's "click to cancel" rules say the same).

**The flow:** Memberships → the plan → **Cancel membership**. One confirmation
screen, not three. No retention offer, no "are you sure?" chain.

The confirmation screen says, in plain words:

- **When it stops** — "You'll keep your membership until 14 August. After that
  it won't renew and you won't be charged again."
- **If they're inside a minimum term** — "You committed to 3 months, ending
  14 October. Cancelling now means a $50 early-finish fee, charged today."
  (from `minTermCount` / `earlyTermFeeCents`). Show the exact number before they
  confirm, never after.
- **What happens to already-booked sessions** — this needs a decision (§10) and
  then a sentence.

**Implementation:** `stripe.subscriptions.update(subId, { cancel_at_period_end:
true }, { stripeAccount })`. Set `MembershipPurchase.status = CANCELLING`,
`cancelAtPeriodEnd = true`, `cancelledAt = now`. Notify the trainer. When the
period ends Stripe fires `customer.subscription.deleted` and we move to
`CANCELLED`.

**Also give them "Update card"** on the same screen — most people looking for
cancel are actually trying to fix a failed payment.

---

## 8. What breaks if we get this wrong

Stated plainly, because these are the outcomes that matter more than the code:

- **Charging after cancellation.** A client cancels, we mark our row cancelled,
  but the Stripe subscription keeps going because the API call failed and we
  didn't check. They get charged next month. This is the worst one — it destroys
  trust in the trainer, not in us, and it is a legal problem. *Mitigation:* our
  row is never the source of truth. Reconcile nightly: for every
  `MembershipPurchase` we think is cancelled, confirm Stripe agrees. Alert on
  any disagreement.
- **Double-charging.** Two subscriptions from one double-tap, or a replayed
  webhook creating a second charge. *Mitigation:* outbound idempotency keys +
  the event ledger + unique constraints (§6).
- **Wrong amount.** A trainer edits the price and every existing subscriber
  jumps. Or currency confusion — `payoutCurrency` vs the client's expectation.
  *Mitigation:* immutable Prices, price changes never applied retroactively, and
  the consent record proves what they agreed to.
- **Charging when the trainer has left.** The trainer disconnects Stripe or
  stops using PupManager, and clients keep paying for a service nobody is
  delivering. *Mitigation:* handle `account.application.deauthorized`, and block
  the accept-payments toggle while subscriptions are live.
- **Silent revenue loss to us.** If we go with Option B in §2.1 and the webhook
  window is missed, we earn nothing and nobody notices for months. *Mitigation:*
  Option A, plus a monthly reconciliation of application fees collected vs
  expected.
- **Cutting a client off wrongly.** A card bounces once and their dog is
  un-enrolled from a class they've attended for a year. *Mitigation:* the grace
  window in §5.2.

---

## 9. Rollout

No allowlist exists any more (§1.3), so the gate is built from what's there:

1. **Test keys only.** A trainer with `sandboxBilling = true` and a Connect
   Express test account. Every Stripe call already routes to test keys through
   `stripeFor(sandbox)`. Real cards cannot be charged. Prove the full lifecycle
   here with test clocks (§10... §Test strategy below).
2. **A feature flag on the trainer.** Add
   `TrainerProfile.recurringPaymentsEnabled Boolean @default(false)`. `buyable`
   in `client-memberships.ts` and the buy route both check it. This is the
   allowlist, but as a DB column rather than an env var — visible in the admin
   Businesses screen, flippable per trainer, no deploy needed.
3. **Pilot: 2–3 real trainers, live keys, low volume.** Ideally Brooke plus one
   friendly customer. Watch every webhook for a full billing cycle — you cannot
   shortcut this, the interesting events only fire a month in. Have a written
   manual-refund runbook ready before the first live charge.
4. **General availability** once a full cycle including at least one deliberate
   failed payment has been observed end to end.

Prod prerequisites before step 3: the new webhook events subscribed on the
Connect endpoint in the Stripe Dashboard (both live and test), and confirmation
that `STRIPE_CONNECT_WEBHOOK_SECRET` / `_TEST` are set.

---

## 10. Test strategy

Per `AGENTS.md`, tests ship **with** the feature, not after.

**Unit (`tests/unit/**/*.test.ts`, vitest, Prisma mocked with `vi.hoisted`):**

- Price/Product resolution: cache hit, cache miss, invalidation after a price
  edit.
- `application_fee_percent` maths for each currency in `PLATFORM_MARKUP_BPS`,
  including the `zar: 0` case (must not send the field).
- Every new webhook handler, fed a fixture event: correct status transition,
  correct notification, and **called twice → identical result** (the idempotency
  assertion is the important one; write it for every handler).
- Out-of-order delivery: `invoice.paid` before
  `customer.subscription.created`.
- Cancellation maths: early-termination fee inside vs outside `minTermCount`.
- **Security (`tests/unit/security/*.test.ts`, required by AGENTS.md):** a
  client cannot subscribe to another trainer's membership; cannot cancel someone
  else's; a webhook event carrying the wrong `event.account` does not fulfil
  (mirror the existing integrity gate).

**E2E (`tests/e2e/*.spec.ts`, Playwright, embedded Postgres):**

- Client sees a recurring plan → consent screen → (Stripe mocked) → active
  membership shows correct next-charge date.
- Client cancels → sees "active until <date>" → does not see "cancelled".
- Cross-tenant guard: trainer B's client cannot reach trainer A's plan.
- Beware the trap recorded in the undeployed-stack memory: **persisted prefs
  leak between specs**, and unseeded paid add-ons look like tenancy leaks. The
  `memberships` add-on must be seeded on for the test trainer.

**Stripe test clocks — the only way to test a renewal.**

A test clock is a Stripe test-mode object you attach a Customer to, then
fast-forward. Create the customer on the *connected test account* with
`test_clock`, subscribe, then advance a month and watch `invoice.paid` fire for
real. Scenarios worth scripting (`scripts/` one-offs, not in CI — they hit the
Stripe API and are slow):

- Normal renewal, three cycles.
- `4000000000000341` (attaches fine, fails on charge) → the full dunning
  sequence and our `PAST_DUE` handling.
- `4000002500003155` (requires 3DS) → `invoice.payment_action_required`.
- Cancel mid-cycle → confirm no charge at the next boundary.
- Card expiry → `invoice.upcoming` warning.

CI keeps its Stripe calls mocked; the test-clock scripts are run by hand before
each phase ships.

---

## 11. Phasing and effort

Rough, assuming Karl-scale focused days.

### Phase 1 — a client can subscribe and cancel (8–10 days)

The smallest thing that is genuinely useful.

- Schema + hand-written migrations (§4.1, §4.2, §4.3, §4.4). **1 day**
- `src/lib/connect-subscriptions.ts` — new module alongside
  `connect-checkout.ts`: ensure Customer, ensure Product/Price, create the
  Checkout Session in `mode: 'subscription'` with `application_fee_percent` and
  an idempotency key. **2 days**
- Buy route: replace the 409 at
  `my/memberships/[membershipId]/buy/route.ts:36-38` with the subscription
  path; `buyable` in `client-memberships.ts:96` follows. **1 day**
- Consent screen + `MembershipConsent`. **1 day**
- Webhook handlers: `customer.subscription.*`, `invoice.paid`,
  `invoice.payment_failed` + the event ledger. **2 days**
- Client-side cancel flow (§7). **1 day**
- Tests. **1–2 days**

*Ships behind `recurringPaymentsEnabled`, sandbox trainers only.*

### Phase 2 — the failure surface (5–7 days)

- `invoice.payment_action_required` + hosted-invoice surfacing. **1 day**
- Dunning states, notifications, the grace-window rule. **1.5 days**
- Update-card flow. **1 day**
- Trainer-side: view/cancel/refund a client's subscription. **1.5 days**
- `account.application.deauthorized` + block the accept-payments toggle. **1 day**
- Nightly Stripe↔DB reconciliation job (Supabase pg_cron, per
  `feedback_crons_via_supabase.md` — **never** vercel.json crons). **1 day**

### Phase 3 — polish (4–5 days)

- `regrantOnRenewal` for bundled products.
- Early-termination fee actually charged.
- `MembershipRequest` → subscription (trainer accepts a request, client gets a
  pay link).
- Xero sync for recurring invoices.
- Multi-plan picker on the storefront ($10/wk vs $35/mo).
- The `passProcessingFeeToClient` surcharge as a second recurring Price, if
  wanted.

**Total ≈ 17–22 focused days.**

---

## 12. Open questions — only Karl can answer these

The schema depends on the first three. **Answer before Phase 1 starts.**

1. **When a trainer leaves PupManager, what happens to their clients' plans?**
   Options: (a) we cancel every subscription and tell the clients; (b) they keep
   running on the trainer's Stripe account and we wash our hands; (c) we keep
   them running but stop taking our cut. This is as much a contract question as
   a technical one. *(Affects §5.8, and whether `MembershipPurchase` needs an
   "orphaned" state.)*

2. **Who picks the billing date?** Options: (a) the day they subscribe, so every
   client is on a different date — simplest, and what Stripe does by default;
   (b) the trainer sets a fixed day of the month for everyone, which needs
   proration on the first cycle and is materially more code. *(Affects the plan
   editor and the first-cycle maths.)*

3. **Does a failed payment stop their access immediately, or after Stripe gives
   up (~2–3 weeks)?** My recommendation is after — but it's the trainer's
   business and the trainer's call, so possibly this is a **per-trainer
   setting** rather than a global rule. *(Affects §5.2 and adds a
   `TrainerProfile` column if it's a setting.)*

4. **Refund policy.** Do we always refund our application fee proportionally
   when a trainer refunds a client? (I think obviously yes.) And is a mid-cycle
   cancellation refunded pro-rata, or do they simply keep the rest of the
   period? Recommendation: **keep the rest of the period, no pro-rata** — it's
   simpler, and it's what almost every subscription does.

5. **Does the early-termination fee actually get charged**, or is it just a
   deterrent shown on screen? Charging it is a one-off invoice on the connected
   account and is real work; showing it and letting the trainer chase is
   cheaper. The current schema (`earlyTermFeeCents`) doesn't say.

6. **Which trainers pilot this?** Needs two or three real businesses willing to
   have their clients on a brand-new billing system for a full cycle.

7. **Do recurring memberships support the `passProcessingFeeToClient`
   surcharge?** Recommendation: not in Phase 1, stated clearly in the plan
   editor.

---

## 13. Things I could not determine

Stated honestly rather than guessed:

- **Whether the Connect webhook endpoint in the Stripe Dashboard is subscribed
  to subscription/invoice events.** I can only see the code, not the Dashboard
  config. Must be checked before Phase 1 ships, in both live and test mode.
- **Stripe's Smart Retry schedule for our connected accounts** — it's a
  per-account Dashboard setting on Express accounts and I can't read it from
  here. The "~4 attempts over ~2–3 weeks" in §5.2 is Stripe's default, not a
  verified fact about our accounts.
- **Whether `application_fee_percent` is supported for every country in
  `COUNTRY_CURRENCY`** (`connect.ts:26-34`). It is standard, but ZA in
  particular has had Connect restrictions. Verify against the Stripe docs for
  each market before enabling that market.
- **Whether Card Account Updater is active** for our connected accounts — it
  materially changes how often expiry causes a failure.
- **The exact `MembershipPurchaseStatus` enum values currently defined** — I
  read the model but not the enum; §4.2's additions assume `ACTIVE` and
  something like `EXPIRED`/`CANCELLED` already exist and may partly overlap.
- **Whether a nightly reconciliation cron can be added given the broken-cron
  problem** recorded in `project_broken_supabase_crons.md` — ~7 existing pg_cron
  jobs silently 401 because `app.cron_secret` is unset. **That must be fixed
  before Phase 2 relies on a cron**, or the reconciliation job will fail
  silently, which is precisely the failure mode it exists to prevent.
