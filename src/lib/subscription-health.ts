import { stripeFor, isStripeConfigured } from './stripe'

// Is the subscription id we hold for a business a real, live subscription?
//
// This exists because of a state nobody could see. Mersea Mutts' TrainerProfile
// named sub_1Twz2y…, a subscription that does not exist in the live Stripe
// account. Everything in the product behaved as though they were subscribed —
// the plan showed, the add-ons page offered paid extras — while the truth was
// only discoverable by reading a Vercel log after a customer complained. If the
// link is broken, they may not be being billed at all.
//
// One Stripe read, on an admin-only page, for one business at a time. It is
// deliberately NOT a sweep, a cron or a reconciliation job — the ask was to make
// the state visible, and the place someone already looks when a customer asks a
// billing question is that customer's admin page.

export type SubscriptionHealth =
  /** No subscription id stored — a trialist or a never-subscribed account. */
  | { state: 'none' }
  /** Stripe isn't configured in this environment, so we can't tell. */
  | { state: 'unchecked' }
  | { state: 'ok'; id: string; status: string }
  /** The id names nothing in Stripe. Permanent, and probably unbilled. */
  | { state: 'missing'; id: string }
  /** It exists but is cancelled/incomplete/paused — not billing. */
  | { state: 'inactive'; id: string; status: string }
  /** Stripe could not be reached; says nothing about the subscription. */
  | { state: 'unknown'; id: string; detail: string }

const LIVE = ['active', 'trialing', 'past_due', 'unpaid']

export async function checkSubscriptionHealth(trainer: {
  stripeSubscriptionId: string | null
  sandboxBilling: boolean
}): Promise<SubscriptionHealth> {
  const id = trainer.stripeSubscriptionId
  if (!id) return { state: 'none' }
  if (!isStripeConfigured(trainer.sandboxBilling)) return { state: 'unchecked' }

  try {
    const sub = await stripeFor(trainer.sandboxBilling).subscriptions.retrieve(id)
    return LIVE.includes(sub.status)
      ? { state: 'ok', id, status: sub.status }
      : { state: 'inactive', id, status: sub.status }
  } catch (err) {
    const e = err as { code?: string; message?: string }
    if (e?.code === 'resource_missing') return { state: 'missing', id }
    return { state: 'unknown', id, detail: e?.message ?? String(err) }
  }
}
