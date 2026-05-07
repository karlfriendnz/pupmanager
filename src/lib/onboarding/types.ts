// Shared types for the onboarding system. Mirror the shape returned by
// /api/onboarding/state so the dashboard panel and API can stay in step.

export type StepStatus = 'completed' | 'skipped' | 'in_progress' | 'pending'

export interface OnboardingStepView {
  key: string
  order: number
  title: string
  body: string
  ctaLabel: string
  ctaHref: string
  skippable: boolean
  skipWarning: string | null
  status: StepStatus
}

export interface LimboClient {
  id: string
  name: string
  dogName: string | null
}

export interface OnboardingState {
  steps: OnboardingStepView[]
  ahaReachedAt: string | null
  backfilledAt: string | null
  checklistDismissedAt: string | null
  // Set when the trainer dismissed the first-visit welcome modal (Start or
  // Skip). Null = haven't seen it yet → show welcome modal first.
  welcomeShownAt: string | null
  // Whichever client is most likely "the one we're waiting on" — most recent
  // ClientProfile when ahaReachedAt is null. Null otherwise.
  limboClient: LimboClient | null
  // Step keys that the modal/checklist treats as review-only (no live-state
  // signal — must be marked done explicitly via /complete API).
  explicitOnlyStepKeys: string[]
}
