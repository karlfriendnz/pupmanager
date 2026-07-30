import { prisma } from '@/lib/prisma'
import { stripeFor } from '@/lib/stripe'

/**
 * Does Stripe agree with what we think we are billing?
 *
 * Nothing asked, and the gap cost a customer real money: Mersea Mutts held two
 * live subscriptions from 21 and 25 July and paid both. Our row showed one,
 * because the billing webhook writes `stripeSubscriptionId` from whatever
 * subscription it last heard about — the second one's events replaced our
 * reference to the first, and the first kept charging with nothing pointing at
 * it. Ten days, and the only trace was a second PDF in an inbox.
 *
 * Lives here rather than in the cron route so the daily email and the admin
 * screen run the SAME checks. Two implementations of "is this customer being
 * billed twice" would eventually disagree, and the one nobody is reading would
 * be the one that was right.
 *
 * Read-only. It cancels nothing and refunds nothing: which subscription of a
 * duplicated pair to keep depends on what each has already charged, and that is
 * a judgement, not a rule.
 */

export type FindingKind = 'DUPLICATE' | 'ORPHAN' | 'MISMATCH'

export interface Finding {
  kind: FindingKind
  who: string
  trainerId: string | null
  customerId: string
  detail: string
  /** Every live subscription Stripe holds for this customer. */
  subscriptions: { id: string; status: string; created: string }[]
}

export interface ReconcileResult {
  checkedAt: string
  customersWithLiveSubscriptions: number
  trainersChecked: number
  findings: Finding[]
  duplicates: number
}

const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'unpaid']
const SEVERITY: Record<FindingKind, number> = { DUPLICATE: 0, ORPHAN: 1, MISMATCH: 2 }

export async function reconcileBilling(): Promise<ReconcileResult> {
  const stripe = stripeFor(false) // live mode; sandbox trainers bill in test
  const findings: Finding[] = []

  // Walked from STRIPE's side, not ours. Iterating our own trainers could never
  // surface a subscription we hold no row for — which is exactly the orphan
  // case, and the one most likely to be quietly charging somebody.
  const byCustomer = new Map<string, { id: string; status: string; created: number }[]>()
  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
    if (!LIVE_STATUSES.includes(sub.status)) continue
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
    byCustomer.set(customerId, [
      ...(byCustomer.get(customerId) ?? []),
      { id: sub.id, status: sub.status, created: sub.created },
    ])
  }

  const trainers = await prisma.trainerProfile.findMany({
    where: { sandboxBilling: false, isInternal: false },
    select: {
      id: true, businessName: true, stripeCustomerId: true,
      stripeSubscriptionId: true, subscriptionStatus: true,
    },
  })
  const byStripeCustomer = new Map(
    trainers.filter(t => t.stripeCustomerId).map(t => [t.stripeCustomerId as string, t]),
  )

  const shape = (subs: { id: string; status: string; created: number }[]) =>
    [...subs]
      .sort((a, b) => a.created - b.created)
      .map(s => ({ id: s.id, status: s.status, created: new Date(s.created * 1000).toISOString() }))

  for (const [customerId, subs] of byCustomer) {
    const trainer = byStripeCustomer.get(customerId)
    const who = trainer?.businessName ?? `(no trainer row)`
    const listed = shape(subs)

    if (subs.length > 1) {
      findings.push({
        kind: 'DUPLICATE',
        who,
        trainerId: trainer?.id ?? null,
        customerId,
        subscriptions: listed,
        detail:
          `${subs.length} live subscriptions: ` +
          listed.map(s => `${s.id} (${s.status}, created ${s.created.slice(0, 10)})`).join(' AND ') +
          `. This customer is being charged more than once.`,
      })
    }

    if (!trainer) {
      findings.push({
        kind: 'ORPHAN', who, trainerId: null, customerId, subscriptions: listed,
        detail: `Stripe is billing this customer but no trainer row has that customer id.`,
      })
      continue
    }

    const liveIds = listed.map(s => s.id)
    if (trainer.stripeSubscriptionId && !liveIds.includes(trainer.stripeSubscriptionId)) {
      findings.push({
        kind: 'MISMATCH', who, trainerId: trainer.id, customerId, subscriptions: listed,
        detail:
          `We hold ${trainer.stripeSubscriptionId} (we say ${trainer.subscriptionStatus}), but Stripe's live ` +
          `subscription${liveIds.length > 1 ? 's are' : ' is'} ${liveIds.join(', ')}.`,
      })
    }
    if (!trainer.stripeSubscriptionId) {
      findings.push({
        kind: 'MISMATCH', who, trainerId: trainer.id, customerId, subscriptions: listed,
        detail: `Stripe has a live subscription but we hold none — add-ons and seats have nothing to attach to.`,
      })
    }
  }

  // The other direction: we claim a subscription Stripe has no live record of.
  for (const t of trainers) {
    if (!t.stripeSubscriptionId || !t.stripeCustomerId) continue
    if (byCustomer.has(t.stripeCustomerId)) continue
    if (t.subscriptionStatus === 'CANCELLED') continue
    findings.push({
      kind: 'MISMATCH', who: t.businessName, trainerId: t.id,
      customerId: t.stripeCustomerId, subscriptions: [],
      detail: `We say ${t.subscriptionStatus} on ${t.stripeSubscriptionId}, but Stripe has no live subscription for this customer.`,
    })
  }

  findings.sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind] || a.who.localeCompare(b.who))

  return {
    checkedAt: new Date().toISOString(),
    customersWithLiveSubscriptions: byCustomer.size,
    trainersChecked: trainers.length,
    findings,
    duplicates: findings.filter(f => f.kind === 'DUPLICATE').length,
  }
}
