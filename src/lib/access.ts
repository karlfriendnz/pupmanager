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

export interface TrainerMailState extends TrainerAccessState {
  /** Set when the account has been deactivated (soft-deleted). */
  deactivatedAt?: Date | null
}

/**
 * True when PupManager should STOP sending this trainer our own mail.
 *
 * "Cancel the trial, cancel the emails." A trainer who cancelled, let their
 * trial lapse, or had their account closed kept receiving onboarding drips,
 * trial nudges, daily/weekly summaries and session reminders — mail about an
 * app they can no longer open, because the paywall in (trainer)/layout locks
 * out exactly the same people this returns true for.
 *
 * Deliberately the SAME test as `trainerHasAccess`, so the two can't drift:
 * if we won't let them in, we don't write to them. An admin grace period
 * therefore restores their mail as well as their access.
 *
 * This covers our own lifecycle mail only. Transactional mail a person is
 * entitled to regardless — verification codes, password resets, a team invite,
 * "a client paid you and it failed", and the win-back mail asking a lapsed
 * trainer to come back — is sent with `alwaysSend` and bypasses this.
 */
export function trainerMailStopped(t: TrainerMailState): boolean {
  if (t.deactivatedAt) return true
  return !trainerHasAccess(t)
}
