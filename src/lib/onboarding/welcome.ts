export type WelcomeGateState = {
  welcomeShownAt?: Date | string | null
  backfilledAt?: Date | string | null
  checklistDismissedAt?: Date | string | null
  ahaReachedAt?: Date | string | null
}

/**
 * Whether the first-run welcome / personalization modal should pop on the
 * dashboard. Suppressed entirely during admin impersonation — an admin viewing
 * a trainer wants their dashboard, not the trainer's first-run wizard.
 */
export function shouldShowWelcome(state: WelcomeGateState, impersonating: boolean): boolean {
  if (impersonating) return false
  return (
    !state.welcomeShownAt &&
    !state.backfilledAt &&
    !state.checklistDismissedAt &&
    !state.ahaReachedAt
  )
}
