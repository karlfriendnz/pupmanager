// Single source of truth for "can this trainer use the platform?".
// Used by the (trainer) layout to hard-gate access and by the billing
// surfaces to decide what to show. Keep this in lockstep with the trial
// banner's copy so the nudge and the gate never disagree.

export interface TrainerAccessState {
  subscriptionStatus: 'ACTIVE' | 'INACTIVE' | 'TRIALING' | 'PAST_DUE' | 'CANCELLED'
  trialEndsAt: Date | null
  // Set once the trainer has a Stripe subscription (incl. one still inside
  // its Stripe trial window — they've paid/committed, so they keep access).
  stripeSubscriptionId: string | null
  // Admin-granted grace period. While in the future it grants access
  // regardless of subscription/trial state.
  gracePeriodUntil?: Date | null
}

/**
 * True when the trainer is entitled to use the app. Access is granted when:
 *   - they're on an ACTIVE paid subscription, or
 *   - they have a Stripe subscription (incl. its trial window), or
 *   - they're still inside their free (no-card) trial.
 * Everything else — expired free trial, cancelled, past-due, inactive —
 * is locked out until they sort billing. (No pay, no access.)
 */
export function trainerHasAccess(t: TrainerAccessState): boolean {
  // Admin grace period overrides everything while it lasts.
  if (t.gracePeriodUntil && t.gracePeriodUntil.getTime() > Date.now()) return true
  if (t.subscriptionStatus === 'ACTIVE') return true
  if (t.subscriptionStatus === 'TRIALING') {
    if (t.stripeSubscriptionId) return true
    if (t.trialEndsAt && t.trialEndsAt.getTime() > Date.now()) return true
    return false
  }
  // PAST_DUE, CANCELLED, INACTIVE
  return false
}
