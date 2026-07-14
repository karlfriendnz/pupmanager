# Go-live: client → trainer payments

What to do the moment the payments work is deployed, in order. Stop at the first
step that doesn't behave as described — everything below it assumes the one above
worked.

Context: these are **direct charges**. The trainer is the merchant of record, the
money lands in *their* bank account, and they pay Stripe's processing fee. Our
margin rides on top as a Stripe `application_fee_amount`, which Stripe transfers
to the platform automatically. Nothing here touches trainer→PupManager
subscription billing, which is a separate flow.

## Before the deploy

- [ ] **Confirm Stripe's base rates for USD, CAD and ZAR.** Our margin per
      currency lives in `PLATFORM_MARKUP_BPS` (`src/lib/connect.ts`) and is the
      gap between the advertised 3.5% and what Stripe charges the trainer in
      their country. NZ/AU/GB were checked against Stripe's live rate card;
      US/CAD use the published 2.9% and **ZAR takes 0%** because the rate was
      never confirmed. A wrong number here silently overcharges a trainer.
- [ ] **Check the live Connect webhook endpoint exists in the Stripe Dashboard**
      (Developers → Webhooks), pointing at `/api/webhooks/stripe/connect` and
      sending `account.updated`. Without it, `connectChargesEnabled` never mirrors
      back and a trainer's setup checklist looks stuck. It degrades rather than
      deadlocks — the Payments panel re-syncs from Stripe on load — but fix it.

## After the deploy

- [ ] `npm run smoke:prod` once the Vercel build reports Ready.

## The first real payment (do this BEFORE telling any trainer)

Use the **demo / sandbox trainer**, not a real customer.

1. [ ] Settings → Payments → **Set up payments**. It should redirect to Stripe's
       hosted onboarding. (If it shows "Payments aren't available for your account
       yet", the deploy didn't take — that message no longer exists in the code.)
2. [ ] Complete Stripe onboarding. The panel's checklist should tick over to
       **Active** (details submitted / able to take payments / payouts).
3. [ ] Take a **real payment of a couple of dollars** — a cheap product or a
       package — as a client would, with a real card.
4. [ ] In the **Stripe Dashboard → Payments**, open that charge and confirm:
       - it sits on the **connected account**, not the platform;
       - there is an **application fee** on it;
       - the fee is what we expect (NZD: 0.85% of the gross — e.g. $5.00 → 4c);
       - the trainer's net = gross − Stripe's fee − our fee.
5. [ ] **Refund it** from the app (Finances → the payment → Refund). Then confirm
       in Stripe that the **application fee was refunded too**. If our fee is NOT
       returned, stop — the trainer is funding our margin out of their own balance
       on every refund, and that must be fixed before anyone else transacts.
6. [ ] Check the `Payment` row in the DB has `applicationFeeAmount` matching what
       Stripe actually took.

## Then, and only then

- [ ] Turn one **real** trainer on and watch their first transaction.
- [ ] Tell the rest.

## Known limits (say these out loud before anyone asks)

- **International cards.** Stripe charges ~3.5% on an overseas card, so a trainer
  paid with one pays our margin *on top* of the advertised 3.5% + $0.30. The
  application fee is fixed when the checkout is created — before the card is
  known — so it cannot vary by card type. pupmanager.com/pricing doesn't mention
  this.
- **Margin varies by country** because Stripe's costs do: AUD 1.80% and GBP 2.00%
  are healthy; NZD 0.85% is thin; USD/CAD 0.60% thinner; ZAR earns nothing until
  its rate is confirmed. That's the cost of advertising one flat rate everywhere.
- **A trainer who hasn't finished Stripe onboarding cannot be charged** — no
  connected account, no checkout. That's a guard, not a bug.
