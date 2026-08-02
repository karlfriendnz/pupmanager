import type Stripe from 'stripe'
import { prisma } from './prisma'
import { resolvePriceId, loadPriceIndex } from './billing'
import { stripeFor, isStripeConfigured } from './stripe'
import { ADDONS, addonById, isCurrencyCode, DEFAULT_CURRENCY, type AddonDef, type CurrencyCode } from './pricing'

// ── One place that turns an add-on on or off ────────────────────────────────
//
// This used to live inside POST /api/addons, which meant the only caller that
// could ever run it was the signed-in trainer. When Mersea Mutts could not
// switch their achievements add-on back on, the two options were hand-editing
// the database (which skips Stripe, so they get a paid feature free) or asking
// the customer to keep tapping a button that was never going to work. Lifting it
// here gives an admin the SAME path — the same Stripe calls, the same rules, the
// same audit entry — rather than a second, subtly different one.
//
// Everything that decides *whether* the change is allowed for a given person
// stays with the caller: the trainer route checks their permission, the admin
// route checks they're a platform admin. This function only knows how to make
// the change happen, and how to say honestly when it can't.

/** Who asked for the change — and in what capacity. */
export type AddonActorKind =
  /** The business acting for itself, through the Add-ons screen. */
  | 'trainer'
  /** A PupManager super-admin acting on the business's behalf. */
  | 'admin'
  /** No human: the Stripe webhook's reconciliation sweep. */
  | 'system'

export interface AddonActor {
  kind: AddonActorKind
  /** User.id of the person, or null for `system`. */
  userId: string | null
  ip?: string | null
  userAgent?: string | null
}

/**
 * Machine-readable "why not". The client uses it to tell a permanent failure
 * (nothing the trainer does will help) from a transient one (Stripe was down for
 * a second), which is the whole point — "Please try again" was the wrong advice
 * for exactly one of these and it was the one that happened.
 */
export type AddonChangeFailure =
  | 'unknown_addon'
  | 'not_configured'
  | 'no_subscription'
  | 'subscription_missing'
  | 'subscription_inactive'
  | 'no_price'
  | 'price_lookup_failed'
  | 'stripe_unavailable'
  | 'stripe_rejected'

export type AddonChangeResult =
  | { ok: true; status: 200; body: Record<string, unknown> }
  | { ok: false; status: number; reason: AddonChangeFailure; error: string; body?: Record<string, unknown> }

/** Failures the trainer can do nothing about by repeating themselves. */
export const PERMANENT_FAILURES: ReadonlySet<AddonChangeFailure> = new Set<AddonChangeFailure>([
  'unknown_addon',
  'subscription_missing',
  'subscription_inactive',
  'no_price',
  'stripe_rejected',
])

// TrainerAddon.itemId is an FK to BillingItem.id, so enabling an add-on whose
// BillingItem row was never seeded in this environment 500s on a FK violation.
// Historically that meant re-running scripts/backfill-addon-billing-items.ts by
// hand every time a new add-on shipped. Instead, self-heal: ensure the row
// exists (from the catalog) before we touch TrainerAddon. Idempotent; `update:{}`
// leaves an existing row's Stripe price wiring untouched.
async function ensureBillingItem(def: AddonDef): Promise<void> {
  await prisma.billingItem.upsert({
    where: { id: def.id },
    create: {
      id: def.id,
      kind: 'ADDON',
      name: def.name,
      description: def.description,
      priceMonthly: def.price.NZD,
      sortOrder: ADDONS.findIndex(a => a.id === def.id) + 1,
    },
    update: {},
  })
}

// ── Reading a Stripe failure ────────────────────────────────────────────────

interface StripeFacts {
  type: string | null
  code: string | null
  message: string
}

function stripeFacts(err: unknown): StripeFacts {
  const e = err as { type?: string; code?: string; rawType?: string; message?: string } | null
  return {
    type: e?.type ?? e?.rawType ?? null,
    code: e?.code ?? null,
    message: e?.message ?? String(err),
  }
}

/**
 * The subscription id we hold names nothing in Stripe.
 *
 * This is NOT a blip. The id is written by the billing webhook from whatever
 * subscription it last saw; when Stripe answers `resource_missing` the row is
 * pointing at something that no longer exists (deleted account, wrong mode, a
 * subscription removed in the Dashboard) and it will answer the same way
 * forever. It also means the business may not be being billed at all — worth
 * shouting about in the log even though the trainer only sees one sentence.
 */
function isMissingResource(f: StripeFacts): boolean {
  return f.code === 'resource_missing'
}

/** Stripe answered, and the answer was no. Repeating the request changes nothing. */
function isDeterministic(f: StripeFacts): boolean {
  return (
    f.type === 'StripeInvalidRequestError' ||
    f.type === 'StripeCardError' ||
    f.type === 'StripePermissionError' ||
    f.type === 'StripeAuthenticationError' ||
    f.type === 'invalid_request_error' ||
    f.type === 'card_error'
  )
}

const CANT_REACH_STRIPE =
  'We couldn’t reach Stripe just then, so nothing changed. Try again in a minute.'

function missingSubscriptionMessage(subscriptionId: string): string {
  return (
    `Your subscription (${subscriptionId}) no longer exists in Stripe, so add-ons can’t be ` +
    'changed. Trying again won’t fix it — please contact support and we’ll reconnect your billing.'
  )
}

// ── The change itself ───────────────────────────────────────────────────────

export async function applyAddonChange(input: {
  /** TrainerProfile.id (== the tenant / companyId everywhere else). */
  trainerId: string
  itemId: string
  active: boolean
  actor: AddonActor
}): Promise<AddonChangeResult> {
  const { trainerId, itemId, active, actor } = input

  // Must be a real add-on that isn't a coming-soon preview (e.g. AI). Not
  // audited: nothing was attempted against a real add-on, so an entry here would
  // only record that someone sent a typo.
  const def = addonById(itemId)
  if (!def || def.comingSoon) {
    return { ok: false, status: 404, reason: 'unknown_addon', error: 'This add-on isn\'t available yet.' }
  }

  const fail = async (
    status: number,
    reason: AddonChangeFailure,
    error: string,
    extra?: { body?: Record<string, unknown>; detail?: string },
  ): Promise<AddonChangeResult> => {
    return { ok: false, status, reason, error, body: extra?.body }
  }

  const applied = async (extra?: Record<string, unknown>): Promise<AddonChangeResult> => {
    await prisma.trainerAddon.upsert({
      where: { trainerId_itemId: { trainerId, itemId } },
      create: { trainerId, itemId, active },
      update: { active },
    })
    return { ok: true, status: 200, body: { ok: true, itemId, active, ...extra } }
  }

  // Guarantee the BillingItem the TrainerAddon FK points at exists in this env.
  await ensureBillingItem(def)

  // FREE add-ons (e.g. Timesheets) toggle with no Stripe involvement.
  if (def.free) return applied()

  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: { stripeSubscriptionId: true, sandboxBilling: true, trialEndsAt: true },
  })
  const sandbox = trainer?.sandboxBilling ?? false

  // Sandbox/demo accounts (sandboxBilling) with no real subscription comp paid
  // add-ons: toggle directly in the DB with no Stripe, so a demo works fully
  // without billing set up. Real trainers (sandboxBilling=false) still require a
  // subscription; sandbox accounts that DID set up a test subscription fall
  // through to the normal Stripe path below.
  if (sandbox && !trainer?.stripeSubscriptionId) return applied({ comped: true })

  // ── Still on the free trial, no subscription yet? Switch it on locally. ──
  //
  // A trialist has no Stripe subscription to hang a line item off, and this used
  // to be a dead end: "Subscribe to your plan to add extras." — i.e. the only way
  // to try a paid extra was to end your own trial and start paying. Karl's call:
  // "people can turn this on — not on by default — but they can turn it on, and
  // then they get invoiced when the trial is up."
  //
  // So write the TrainerAddon row active with NO Stripe call. hasAddon() gates on
  // that row, so the feature works immediately, and /api/billing/checkout carries
  // whatever is still switched on into the subscription it creates — which keeps
  // the trainer's remaining trial days, so the first charge lands when the trial
  // ends, not now.
  //
  // stripeSubscriptionItemId stays NULL deliberately. That is what marks the row
  // as "on, but not a billed line item yet": the Stripe webhook's reconciliation
  // sweep only deactivates rows that DO have one, so a locally-activated row is
  // left alone until checkout puts it on a real subscription — at which point the
  // webhook updates this same row (unique on trainerId+itemId) rather than adding
  // a second one.
  //
  // An EXPIRED trial with no subscription is NOT this case — they get the old
  // error. Otherwise "turn it on during the trial" would quietly become "paid
  // extras are free forever if you never subscribe".
  const inTrial = (trainer?.trialEndsAt?.getTime() ?? 0) > Date.now()
  if (!trainer?.stripeSubscriptionId && inTrial) return applied({ billsAtTrialEnd: true })

  if (!isStripeConfigured(sandbox)) {
    return fail(503, 'not_configured', 'Billing not configured yet')
  }
  if (!trainer?.stripeSubscriptionId) {
    return fail(409, 'no_subscription', 'Subscribe to your plan to add extras.', {
      body: { needsSubscription: true },
    })
  }

  const subscriptionId = trainer.stripeSubscriptionId
  const stripeClient = stripeFor(sandbox)

  // ── Every Stripe call from here down can fail, and each failure has to say
  //    something different. Until today they all said the same thing, because
  //    they all threw out of the route as a 500. ──
  let sub: Stripe.Subscription
  try {
    sub = await stripeClient.subscriptions.retrieve(subscriptionId)
  } catch (err) {
    const f = stripeFacts(err)
    if (isMissingResource(f)) {
      // The loudest line in this file, on purpose: the trainer's billing link is
      // broken, which usually also means nothing is being charged.
      console.error(
        `[addons] SUBSCRIPTION MISSING IN STRIPE — trainer ${trainerId} holds ${subscriptionId} ` +
        `but Stripe says it does not exist (addon ${itemId}, code ${f.code}). ` +
        'They may not be being billed at all — check the customer in Stripe.',
      )
      return fail(409, 'subscription_missing', missingSubscriptionMessage(subscriptionId), {
        detail: `${f.code}: ${f.message}`,
        body: { subscriptionId },
      })
    }
    console.error(
      `[addons] could not load subscription for trainer ${trainerId} (addon ${itemId}): ` +
      `${f.type ?? 'unknown'}/${f.code ?? 'no-code'} — ${f.message}`,
    )
    return fail(502, 'stripe_unavailable', CANT_REACH_STRIPE, { detail: `${f.type}: ${f.message}` })
  }

  // The stored id is not proof the subscription is still alive. It is written
  // by the billing webhook from whatever subscription it last saw, so it can
  // name one that has since been cancelled — and adding a paid add-on to a dead
  // subscription bills nobody while switching the feature on, or fails in a way
  // the trainer reads as "the button is broken".
  if (!['active', 'trialing', 'past_due', 'unpaid'].includes(sub.status)) {
    console.warn(
      `[addons] trainer ${trainerId} has stripeSubscriptionId ${sub.id} but it is ${sub.status}`,
    )
    return fail(
      409,
      'subscription_inactive',
      'Your subscription is not active, so extras cannot be changed. Check Billing.',
      { detail: `status ${sub.status}`, body: { needsSubscription: true } },
    )
  }

  const currency = (sub.currency ?? DEFAULT_CURRENCY).toUpperCase()
  const cur: CurrencyCode = isCurrencyCode(currency) ? currency : DEFAULT_CURRENCY

  const item = await prisma.billingItem.findUnique({
    where: { id: itemId },
    select: { stripePriceId: true, stripePriceIdsByCurrency: true, stripePriceIdTest: true, stripePriceIdsByCurrencyTest: true },
  })
  const priceId = item ? resolvePriceId(item, cur, sandbox) : null
  if (!priceId) {
    return fail(409, 'no_price', 'This add-on isn\'t available for purchase yet.', {
      detail: `no ${cur} price for ${itemId}`,
    })
  }

  // Find any existing line item for THIS add-on on the subscription. The index
  // is a database read today, but it is the thing that decides whether we ADD a
  // line or DELETE one — getting no answer must not be read as "no line".
  let line: Stripe.SubscriptionItem | undefined
  try {
    const index = await loadPriceIndex(sandbox)
    line = sub.items.data.find(li => {
      const c = index.get(li.price.id)
      return c?.type === 'addon' && c.id === itemId
    })
  } catch (err) {
    const f = stripeFacts(err)
    console.error(
      `[addons] price index failed for trainer ${trainerId} (addon ${itemId}): ${f.message}`,
    )
    return fail(
      503,
      'price_lookup_failed',
      'We couldn’t read the current prices, so nothing changed. Try again in a minute.',
      { detail: f.message },
    )
  }

  const items: Stripe.SubscriptionUpdateParams.Item[] = []
  if (active && !line) items.push({ price: priceId, quantity: 1 })
  else if (!active && line) items.push({ id: line.id, deleted: true })

  if (items.length > 0) {
    try {
      await stripeClient.subscriptions.update(sub.id, {
        items,
        // Pro-rate to the next billing date: the prorated amount goes on the
        // upcoming invoice (no immediate charge); removing credits the remainder.
        proration_behavior: 'create_prorations',
      })
    } catch (err) {
      const f = stripeFacts(err)
      console.error(
        `[addons] subscription update REJECTED for trainer ${trainerId} (addon ${itemId}, ` +
        `sub ${sub.id}): ${f.type ?? 'unknown'}/${f.code ?? 'no-code'} — ${f.message}`,
      )
      if (isMissingResource(f)) {
        return fail(409, 'subscription_missing', missingSubscriptionMessage(sub.id), {
          detail: `${f.code}: ${f.message}`,
          body: { subscriptionId: sub.id },
        })
      }
      if (isDeterministic(f)) {
        // Stripe's own sentence, because it is the only one that knows what
        // went wrong, and a generic paraphrase would lose it.
        return fail(409, 'stripe_rejected', `Stripe wouldn’t accept the change: ${f.message}`, {
          detail: `${f.type}/${f.code}: ${f.message}`,
        })
      }
      return fail(502, 'stripe_unavailable', CANT_REACH_STRIPE, { detail: `${f.type}: ${f.message}` })
    }
  }

  // Reflect immediately (the webhook will also reconcile + set the sub-item id).
  return applied()
}
