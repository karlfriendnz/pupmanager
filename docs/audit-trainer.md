# Trainer-side audit — does what I typed save, and does the money follow

**Date:** 2026-08-04 · **Scope so far:** the offering editors, products, clients,
and what happens to a receivable when a class booking changes.
**Environment:** the isolated embedded Postgres the e2e suite uses. Never
production. The demo login was never touched.

Started because Karl asked a single question — *"have you checked all the fields
when editing an offering?"* — which nothing in the suite answered.

**Method.** Two probes, both the same shape as the settings audit's
"save → reload → still there": send every field an editor can send, one distinct
value each, through the API the form actually uses, then read the row back out
of the database and report anything that didn't stick.

- `tests/e2e/audit-trainer-offerings.spec.ts` — the offering editors
- `tests/e2e/audit-trainer-fields.spec.ts` — products, clients, a scheduled class
- `tests/e2e/audit-trainer-money.spec.ts` — the receivable when a booking changes

Severity words are Karl's: *leaks data / loses money / breaks the journey /
confusing / cosmetic*.

---

## Summary

| # | Finding | Severity |
|---|---------|----------|
| T-1 | The settings API took **any string** as the client-facing business email — **FIXED** | breaks the journey |
| T-2 | An offering **loses its cadence note** when saved before it has been scheduled — **FIXED** | confusing |
| T-3 | **Withdrawing a client leaves them owing** for the class — **FIXED** | loses money |
| T-4 | A client **promoted off the waitlist is never billed** — **FIXED** | loses money |
| T-5 | Deleting a package **deletes the purchases of everyone on it**, live Stripe subscriptions and all — **FIXED** | loses money |
| T-6 | Cancelling a whole class **leaves everyone on it still owing** for it — **FIXED** | loses money |
| T-7 | Deleting a product **deletes the orders behind it** and orphans their invoices — **FIXED** | loses money |

**What came back clean.** The field question Karl asked is answered: a 1:1
offering's twenty fields, a product's eleven, a client's four, the hand-typed
client address (the old "Address is required" trap is genuinely closed), and a
scheduled class's run-backed fields all round-trip. `visibleFromDate` looks wrong
in the probe output and isn't — "2027-01-15" correctly stores as
`2027-01-14T11:00Z`, which is midnight in Auckland.

---

## Findings

### T-1 · The business email clients are given was never checked — *breaks the journey*

Both signup routes validate it with `z.string().email()`. `PATCH
/api/trainer/profile` — the screen a trainer actually edits it on — had
`z.string().max(200)`, so any string was accepted and stored.

The field is `type="email"`, so the browser refuses the obvious case and nobody
sees this by hand. Anything that isn't that form — a script, a stale tab, an
import — went straight in. That address is the `mailto:` on the client Help
page, the reply-to on enquiry auto-replies and the address on the public link
page, so a broken one quietly cuts a trainer off from the people trying to reach
them.

**Fixed.** Same shape as the signup routes. The e2e test asserts the API returns
400, not just that the browser refused.

### T-2 · An offering loses its cadence note before it is scheduled — *confusing*

"Thursdays 4:00pm" was only ever written to the `ClassRun`. A group offering can
be defined before it is scheduled, and one saved in that state took the note,
returned 200, and lost it — on create and on edit both.

This is the identical twin of a bug already fixed here: `Package.location` exists
because the *venue* used to vanish the same way. The note was left behind.

**Fixed.** `packages.scheduleNote`, a new run inherits it when it doesn't name
its own, and the edit form falls back to it when there is no run.

### T-3 · Withdrawing a client leaves them owing for the class — *loses money*

Enrolling calls `createInvoiceForAssignment`. `withdrawEnrollment` marked the row
WITHDRAWN, promoted the waitlist, and said nothing about the invoice — so the
client kept owing for a class they were no longer in, and it sat in the
trainer's Owed column looking real.

This is audit C-3 exactly (cancelling a shop order left the invoice standing),
on a much bigger number: a class seat, not a $25 bag of treats.

**Fixed.** `cancelReceivableForEnrollment` cancels the UNPAID receivable. PARTIAL
and PAID are left alone — money that has moved is a refund decision and that is
the trainer's. A ticketed event is several enrolment rows sharing ONE invoice, so
the invoice only goes once the last of them has.

### T-4 · A client promoted off the waitlist is never billed — *loses money*

The mirror of T-3, found by the same test. Waiting is free and correctly raises
no invoice. Promotion sets the row to ENROLLED — and raised no invoice either,
so the seat that opened up was handed over for nothing. Silent: the trainer sees
a full class and no receivable to chase.

**Fixed.** Promotion bills like the enrolment it is, in the shared
`withdrawEnrollmentAndNotify` so the trainer-side withdraw and the client
self-cancel behave the same.

### T-5 · Deleting a package deletes what everyone on it bought — *loses money*

`MembershipPurchase.membership` is `onDelete: Cascade`, so deleting a package
took every purchase row with it — including ACTIVE ones carrying a live Stripe
subscription on the trainer's connected account. **Stripe carries on charging
that client every week and PupManager no longer has a record that they exist:**
no access, no renewal, and nothing left to cancel it with.

The confirm dialog meanwhile promised *"Anyone who already bought it keeps what
it gave them"* — the exact opposite of what happened.

**Fixed.** Refused with a 409 that names the way out (unpublish). Any purchase
counts, not just live ones: a settled one-off is the record of what somebody
paid for.

### T-6 · Cancelling a class leaves everyone on it owing — *loses money*

Deleting a run tells every client "This class has been cancelled" and cascades
their enrolments away, taking with them the only link back to the invoices those
enrolments raised. The bill stayed.

**Fixed.** Receivables are settled before the delete, while the enrolment ids
still exist. UNPAID only.

### T-7 · Deleting a product deletes the orders behind it — *loses money*

`ProductRequest.product` is `onDelete: Cascade`. Deleting a product took every
order with it — the ones clients were waiting on and the fulfilled ones that are
the purchase record — while their invoices survived, still owed, pointing at
rows that no longer existed.

**Fixed** with the rule the offering DELETE had already settled on: **money
refuses**. On order → 409. Billed or paid → 409, hide it instead.

---

## The shape underneath T-3, T-5, T-6, T-7 (and C-3)

Five instances of one bug: **an undo that undid less than the action did.**

| Where | What was left behind |
|---|---|
| C-3 · cancel a shop order | invoice standing, stock spent |
| T-3 · withdraw one client | invoice standing |
| T-5 · delete a package | purchases and live subscriptions destroyed |
| T-6 · cancel a whole class | every client's invoice standing |
| T-7 · delete a product | orders destroyed, invoices orphaned |

Two rules came out of it and are applied consistently now:

- **Money refuses.** You cannot delete something that has been billed or bought.
  Unpublish or hide it instead.
- **UNPAID only.** Cancelling a receivable is automatic; refunding a paid one is
  a decision with a human in it.

`tests/unit/undo-paths-have-tests.test.ts` is the ratchet that stops the next one
arriving unnoticed: it fails when a new DELETE route appears with no test naming
it, and its backlog list can only shrink.

---

## Still open

- **Xero.** T-3 cancels the invoice locally; an invoice already mirrored to Xero
  is not voided there. Same gap as C-3 — there is no void-in-Xero helper yet, and
  the existing "combine receivables" path cancels locally the same way.
- **Not yet audited:** the schedule and sessions, finances beyond enrolment,
  staff permission boundaries, forms, marketing, timesheets, library,
  achievements, comms flows. Roughly three quarters of the trainer's surface.
