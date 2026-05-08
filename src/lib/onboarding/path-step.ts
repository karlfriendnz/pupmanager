// Maps the trainer's URL (pathname + ?tab= + #hash) to the wizard step that
// page belongs to. Shared between the onboarding FAB (which displays
// step-aware copy) and the AppShell (which decides whether to pulse a dot
// beside a sidebar menu item). Keep both consumers in sync — duplicating
// the table risks them drifting and the trainer seeing inconsistent guidance.

const STEP_PATH_MATCH: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /^\/settings(\?tab=forms|#forms)/, key: 'intake_form' },
  { pattern: /^\/settings(\?tab=notifications|#notifications)/, key: 'business_profile' },
  { pattern: /^\/forms\/intake/, key: 'intake_form' },
  { pattern: /^\/forms\/embed/, key: 'intake_form' },
  { pattern: /^\/forms\/session/, key: 'intake_form' },
  { pattern: /^\/forms/, key: 'intake_form' },
  { pattern: /^\/packages/, key: 'program_package' },
  { pattern: /^\/achievements/, key: 'achievements' },
  { pattern: /^\/preview-as/, key: 'client_view' },
  { pattern: /^\/clients\/invite/, key: 'invite_client' },
  // Match /clients (the list page) but NOT /clients/<id> (a specific client
  // profile). The list is where the Invite Client button lives.
  { pattern: /^\/clients(?:\?|#|$)/, key: 'invite_client' },
  { pattern: /^\/schedule/, key: 'schedule_session' },
  { pattern: /^\/settings/, key: 'business_profile' },
]

export function stepKeyForLocation(loc: string): string | null {
  for (const m of STEP_PATH_MATCH) {
    if (m.pattern.test(loc)) return m.key
  }
  return null
}

// Maps a step key to the top-level sidebar menu the trainer should click
// to reach that step. Used by the trainer layout to decide which menu
// item to highlight in the sidebar when onboarding is in progress.
export const STEP_TO_MENU: Record<string, string> = {
  business_profile: '/settings',
  intake_form: '/settings',
  session_form: '/settings',
  program_package: '/packages',
  achievements: '/achievements',
  client_view: '/clients',
  invite_client: '/clients',
  schedule_session: '/schedule',
}
