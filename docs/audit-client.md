# Client-side audit — everything a dog owner experiences

**Date:** 2026-08-04 · **Scope:** the `(client)` route group, `/api/my/*`, the public
signup/enquiry doors, and the trainer-side set-up a client depends on.
**Environment:** local dev on port 7777 against the local `pupmanager_dev` Postgres.
Never production. The demo login was never touched.

**Fixture** — `tests/audit/client-fixture.ts` builds two throwaway businesses
(`Audit Paws Academy`, `Rival Audit Dogs`), an established dog owner who is a
client of **both**, a second client on business A, an empty client, and a full
spread of offerings, products, library items, sessions, notes and invoices.
Sentinel strings (`…-DO-NOT-LEAK`) are planted in everything a client must never
see, so a leak is a string match rather than a judgement call.

**Probes** — `tests/audit/client-probe.ts` (page sweep + leak strings),
`client-actions.ts` (booking and buying through the real API),
`client-signup.ts` (a brand-new owner), `client-shop-payload.ts`.
**Regression tests** — `tests/e2e/audit-client.spec.ts`.

Severity words are Karl's: *leaks data / loses money / breaks the journey /
confusing / cosmetic*.

---

## Summary

Nothing leaked. Every one of the "a client can see something that isn't theirs"
probes came back clean — private answers, unsent drafts, another client's
write-up, another business's homework, hidden products and not-yet-open
offerings are all refused server-side, and the refusals are refusals (404), not
blank screens with the data still in the payload.

What did break is on the way IN and on the way OUT: an intake form that asks for
an address makes the client permanently unable to finish it; the intake accepts
a form with every required answer blank; a cancelled shop order leaves the money
owing and the stock spent; and a paid digital download's URL is handed to every
client before they buy it.

| # | Finding | Severity |
|---|---------|----------|
| C-1 | An intake form with an **Address** question 500s — the client can never get past the gate | breaks the journey |
| C-2 | The intake submit route **never checks `required`** — a blank form is accepted and the gate lifts | breaks the journey |
| C-3 | Cancelling a shop order leaves the **invoice standing and the stock spent** | loses money |
| C-4 | A paid **digital download's URL is in the page source** before purchase | loses money |
| C-5 | The shop grid gives **no sign that something is sold out** until you tap it | confusing |
| C-6 | The client **Help page's FAQ describes an app that no longer exists** | confusing |
| C-7 | A required **"Dog's name"** intake answer is silently discarded when the client has no dog record yet | confusing |
| C-8 | With payments off, a **priced digital product downloads free** and raises nothing | loses money |

---

## Findings

### C-1 · An intake form that asks for an Address can never be submitted — *breaks the journey*

**What I did.** Built a client form with a built-in **Address** question (the
`CLIENT_FIELD` / `fieldKey: 'address'` type the forms builder offers), assigned
it to a client as their intake, and submitted an answer.

**What happened.** `POST /api/my/intake-form/submit` throws. `collectClientFieldWrites`
maps the answer to `{ profile: { address: … } }` and the route runs
`prisma.clientProfile.update({ data: { address } })` — but **`ClientProfile` has
no `address` column**. It has `addressLine` (plus `addressLat` / `addressLng` /
`addressPlaceId`). Prisma rejects the write, the route 500s, `intakeCompletedAt`
is never stamped, and the client is returned to the same gate. There is no way
past it: the gate replaces the entire app, and the only exit it offers is the
trainer switcher.

**What should have happened.** The answer should land in `addressLine` and the
form should complete.

**Reproduction**
```
npx dotenv -e .env.development.local -o -- npx tsx -e "
import { scriptPrisma } from './src/lib/prisma-script'
import { collectClientFieldWrites } from './src/lib/client-field-writes'
const p = scriptPrisma()
;(async()=>{
  const w = collectClientFieldWrites([{ id:'a', type:'CLIENT_FIELD', fieldKey:'address', required:true }], { a: '12 Queen St' })
  console.log(w)                       // { profile: { address: '12 Queen St' } }
  const cp = await p.clientProfile.findFirst()
  await p.clientProfile.update({ where:{ id: cp.id }, data: w.profile })  // throws
})().finally(()=>p.\$disconnect())"
```
`src/lib/client-field-writes.ts` line ~33: `address: { on: 'profile', column: 'address' }`.

**Test:** `audit-client.spec.ts` → *C-1 · an intake form that asks for an Address can be submitted* (currently `test.fail`).

---

### C-2 · The intake submit route never checks `required` — *breaks the journey*

**What I did.** Read `src/app/api/my/intake-form/submit/route.ts`, then posted an
intake with every required answer blank.

**What happened.** The route's zod schema only checks that `answers` is a record
of strings. It never reads the form's `required` flags. Any submission — an
empty one, one with unknown question ids, one missing half the questions — is
accepted, written to `intakeAnswers`, and stamps `intakeCompletedAt`, which is
the thing that lifts the gate. The trainer's screen then says the client has
completed their intake.

Required-ness is enforced only in the browser (`FormRunner`). Anything that
isn't the browser — a stale tab, a script, a client tapping through with
JavaScript half-loaded — walks straight past it.

The same route also lets a completed client **re-submit** and overwrite their
answers with `{}` (the `intakeFormId !== formId` guard still passes), so answers
a trainer relies on can be wiped after the fact.

**What should have happened.** A blank required answer should be a 400 and the
gate should stay down.

**Reproduction.** As a client gated on a form with one required question:
`POST /api/my/intake-form/submit { formId, answers: { <requiredId>: "" } }` → 200,
and `ClientProfile.intakeCompletedAt` is set.

**Test:** `audit-client.spec.ts` → *C-2 · an intake with every required answer left blank is refused* (currently `test.fail`).

---

### C-3 · Cancelling a shop order leaves the invoice standing and the stock spent — *loses money*

**What I did.** Requested a product from the client shop, then tapped the same
button again — the UI labels it **"Requested · Tap to cancel"**, so this is the
one-tap undo a client is invited to use.

**What happened.** `POST /api/my/products/[productId]/request` does three things:
`takeStock()` (decrements the shelf), creates the `ProductRequest`, and calls
`createInvoiceForAssignment()` (raises a receivable). The `DELETE` half undoes
exactly one of the three — it deletes the `ProductRequest` row and nothing else:

```ts
await prisma.productRequest.deleteMany({ where: { clientId, productId, status: 'PENDING', … } })
return NextResponse.json({ ok: true })
```

So after a cancel the client still owes for an item they cancelled and will
never receive, and the trainer's stock count is short by one with no movement
explaining it. `addStock()` exists in `src/lib/stock.ts` and is never called
here; nothing cancels the invoice.

**What should have happened.** Cancelling should void (or cancel) the receivable
and put the unit back on the shelf.

**Reproduction.** As a client, `POST /api/my/products/<id>/request` then
`DELETE /api/my/products/<id>/request`, then check
`Invoice where sourceType='PRODUCT' and sourceId=<id>` (still UNPAID) and
`Product.stockCount` (still decremented).

**Test:** `audit-client.spec.ts` → *C-3 · cancelling a product request cancels the money and puts the stock back* (currently `test.fail`).

---

### C-4 · A paid digital download's URL is in the page source before purchase — *loses money*

**What I did.** Opened `/my-shop` as a client and read the page source.

**What happened.** `listShopProducts()` (`src/lib/shop-catalog.ts`) selects
`downloadUrl: true` for every product, and `my-shop/page.tsx` passes
`downloadUrl: p.downloadUrl` into `<ShopGrid>` — which is a `'use client'`
component. Client-component props are serialised into the page, so **every
client is sent the download URL of every digital product the moment they open
the shop**, whether or not they have paid.

The UI is careful (`canDownload = … (!isPaidDigital || !!product.purchased)`) —
the button is hidden. The URL is not. These are Vercel Blob URLs: unguessable,
public, and permanent. The URL *is* the paywall, and it is being published.

**What should have happened.** `downloadUrl` should never leave the server for a
product this client hasn't bought — resolve it server-side per client (as
`purchased` already is), or hand it out from a short-lived signed endpoint.

**Reproduction.** `/my-shop` → View source → search for the digital product's
`downloadUrl`.

---

### C-5 · The shop grid gives no sign that something is sold out — *confusing*

A product with `stockCount: 0` renders in the grid as name + price, identical to
one with stock. `stockLabel()` / "Out of stock" only appear **inside** the
product sheet (`VariantPicker`, and the sheet's own stock line) — `CardPrice`,
which is all a card shows, has no stock branch. So a client browses a shelf,
picks the thing they want, taps it, and only then finds out it's gone.

Variants get this right inside the sheet ("a sold-out option stays VISIBLE and
disabled") — the grid card just hasn't caught up.

---

### C-6 · The client Help page describes an app that no longer exists — *confusing*

`src/app/(client)/my-help/page.tsx` hard-codes a four-item FAQ that refers to:

- **"My Diary"** — there is no such screen; the nav says Home / Offerings /
  Sessions / Messages / Products / Invoices.
- **"tap the circle next to each task to mark it complete"** — homework is
  logged from the homework screen, and the model has since grown timings,
  library media and training logs.
- **"Go to My Profile and toggle *Email reminders*"** — the screen is called
  **My details** and notification settings live elsewhere.

It is the one page a confused client is sent to, and every answer on it is
wrong. Worth deleting or rewriting rather than leaving.

---

### C-7 · A required "Dog's name" intake answer is silently discarded — *confusing*

`intake-form/submit` writes dog answers only when the profile already has a
primary dog:

```ts
if (Object.keys(writes.dog).length > 0 && profile?.dogId) { … }
```

A dog owner who signs up **without** giving a dog name (it's optional on
`/c/<slug>/join`) has no `Dog` row, so `dogId` is null. If their trainer's
intake form then asks for the dog's name as a **required** question, the client
types it, the form accepts it, and the answer goes nowhere — the trainer's
client list still shows no dog. The comment says creating a dog here is "a
bigger decision than this route should take", which is a reasonable position for
an *optional* question and the wrong one for a required one.

---

### C-8 · With payments off, a priced digital product downloads free — *loses money*

`isPaidDigital = product.kind === 'DIGITAL' && payable`, where `payable` is
"this trainer can take cards". A trainer who hasn't finished Stripe Connect —
which is most trainers on day one — sells a $9 PDF that every client can
download immediately, with no request raised and no invoice. The book-now-pay-
later path that covers every other product kind doesn't apply, because the
download button bypasses it entirely.

---

## What works — verified, and now guarded by tests

These are the ones that would be quietly catastrophic, and they all hold:

| Guard | Result |
|---|---|
| A **team-only (`isPrivate`) session-form answer** never reaches the client — not in the page, not in the RSC payload | ✅ filtered server-side in `components/shared/session-report` |
| A **write-up on a session the trainer hasn't ticked off** is invisible ("There's no report for this session yet") | ✅ `lib/report-visibility` |
| **Homework timed AFTER the session** is hidden until the session runs; BEFORE-session homework shows straight away; the AFTER item appears the moment the session is marked done | ✅ `lib/homework-visibility` |
| **Another client's session** on the same business, by direct URL | ✅ 404 |
| **The same person's session at their other trainer**, while business A is active | ✅ 404 |
| A **not-yet-visible offering** (`visibleFrom` in the future) is absent from Offerings, and its run/package are refused by the enrol, self-book and waitlist routes | ✅ `lib/offering-visibility`, gated on 11 independent reads |
| An **inactive product** never appears in the shop | ✅ `active: true` in `lib/shop-catalog` |
| A **past drop-in date** is not openable | ✅ 404 |
| **Switching trainer** works, and each business's branding, nav labels, currency and contact details follow | ✅ |
| A **client of two businesses** sees exactly one business's data at a time | ✅ no cross-tenant string ever appeared |
| **Emoji and very long names** (a 33-character hyphenated owner name, `Mr. Wigglebottom the Third 🦴`) render correctly at 390px and 1440px | ✅ |
| **Invoices** list unpaid + paid correctly, with the right totals and a pay link | ✅ |
| The **intake gate** takes the whole screen with no nav, and the trainer switcher stays reachable from behind it | ✅ deliberate, and correct |

Two more that read as bugs and are not:

- **Memberships/packages are missing from the client Offerings flow.** Deliberate
  — `PACKAGES_HIDDEN_FROM_CLIENTS = true` in `src/lib/feature-flags.ts` (Karl,
  2026-07-27). The `/my-memberships` page and the buy route still work by direct
  link because they are the Stripe return targets.
- **Public class self-enrolment is off.** `PUBLIC_CLASS_ENROLLMENT_ENABLED = false`,
  hidden 2026-05-16 pending rework.

---

## What I could not test

- **Anything that ends at Stripe.** The audit trainers have no Connect account,
  so `POST /api/my/basket/checkout` returns 409 ("this trainer isn't taking card
  payments yet") before it can mint a session, and the pay-to-book branch of
  self-book and class enrolment is never entered. Buying a basket, paying for a
  class, buying a membership and the digital-goods purchase gate are therefore
  **unverified end-to-end** — I could only read the guards, which are unusually
  careful (nothing is trusted from the basket, a stale line refuses the whole
  basket, and a double-tapped Pay is fingerprinted to one charge).
- **Real email.** Verification codes, invite emails and invoice emails go through
  Resend; I asserted the rows and tokens, not the delivered mail.
- **Push notifications** and anything that needs the Capacitor shell
  (`x-pm-platform: ios|android`), including the Apple digital-goods block.
- **Memberships as a client journey** — hidden behind the kill-switch above.
- **A real device.** iPad and safe-area behaviour can only be confirmed on
  hardware; I tested 390px and 1440px viewports.
- The dev server was shared with four other audits running at the same time and
  spent most of the session at load ~7 with page compiles taking 30–120s. Several
  probe passes were re-run for that reason; none of the findings above depend on
  timing.

---

## One thing about the environment, for whoever reads the other audits

For part of this session the shared dev server on :7777 was serving a
**truncated route manifest**. `.next/dev/types/routes.d.ts` had been caught
mid-write: `AppRouteHandlerRoutes` listed `/api/my/self-book` and
`/api/my/waitlist` but *not* `/api/my/classes/[runId]/enroll`,
`/api/my/products/[productId]/request`, `/api/my/basket/checkout`,
`/api/my/intake-form/submit` or `/api/my/self-book/availability` — and every one
of those returned **an HTML 404** to an authenticated request, while the routes
listed alongside them worked normally.

It looks exactly like a tenancy or auth bug and is neither. It also broke
`next build` (`Type error: ';' expected` at `.next/dev/types/routes.d.ts:391`),
which is what `npm run test:e2e:full` starts with, so any agent's e2e run in that
window failed before a single test executed.

`touch`ing any route file makes the dev server rewrite the manifest and both
symptoms clear. Worth knowing before anyone files "dynamic API routes 404" as a
finding — I nearly did.
