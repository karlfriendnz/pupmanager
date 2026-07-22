import type { Prisma, SubscriptionStatus } from '@/generated/prisma'

// Where a trainer sits in the lifecycle, for the admin Businesses screen.
//
// The subtlety this exists to handle: when a trainer starts a plan we carry
// the REMAINDER of their free trial into Stripe (checkout sets
// `trial_period_days` to the days they had left), so Stripe reports the
// subscription as `trialing` and the webhook faithfully stores TRIALING.
// Reading status alone therefore filed a customer who had entered their card
// and committed to a plan under "In Trial" — indistinguishable from someone
// still kicking the tyres with no card on file.
//
// The signal that separates them is `stripeSubscriptionId`: it's only set once
// checkout completes. So:
//   paying  = has a subscription (even if inside the carried-over trial window)
//   trial   = TRIALING with NO subscription — the genuine free trial
// Status still decides churned/past-due; this only splits the trial bucket.

export type TrainerLifecycle = 'trial' | 'paying' | 'churned' | 'none'

/** Statuses that mean "this subscription is live" (billing may be in its trial). */
const LIVE_STATUSES: SubscriptionStatus[] = ['ACTIVE', 'PAST_DUE', 'TRIALING']

export function trainerLifecycle(profile: {
  subscriptionStatus: SubscriptionStatus | null
  stripeSubscriptionId: string | null
}): TrainerLifecycle {
  const { subscriptionStatus: status, stripeSubscriptionId } = profile
  if (status === 'CANCELLED') return 'churned'
  if (stripeSubscriptionId && status && LIVE_STATUSES.includes(status)) return 'paying'
  if (status === 'TRIALING') return 'trial'
  return 'none'
}

/** True once they've completed checkout — the "paying customer" test. */
export function isPayingCustomer(profile: {
  subscriptionStatus: SubscriptionStatus | null
  stripeSubscriptionId: string | null
}): boolean {
  return trainerLifecycle(profile) === 'paying'
}

/**
 * The TrainerProfile filter for a lifecycle bucket, so the tab counts, the tab
 * list and the row chip are all driven by one definition.
 */
export function lifecycleProfileFilter(bucket: TrainerLifecycle): Prisma.TrainerProfileWhereInput {
  switch (bucket) {
    case 'paying':
      return { stripeSubscriptionId: { not: null }, subscriptionStatus: { in: LIVE_STATUSES } }
    case 'trial':
      // A real free trial: trialing with nothing bought yet.
      return { subscriptionStatus: 'TRIALING', stripeSubscriptionId: null }
    case 'churned':
      return { subscriptionStatus: 'CANCELLED' }
    case 'none':
      return { subscriptionStatus: { notIn: ['ACTIVE', 'PAST_DUE', 'TRIALING', 'CANCELLED'] } }
  }
}
