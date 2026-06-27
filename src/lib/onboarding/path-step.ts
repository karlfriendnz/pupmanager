// Maps the trainer's URL (pathname + ?tab= + #hash) to the wizard step that
// page belongs to. Shared between the onboarding FAB (which displays
// step-aware copy) and the AppShell (which decides whether to pulse a dot
// beside a sidebar menu item). Keep both consumers in sync — duplicating
// the table risks them drifting and the trainer seeing inconsistent guidance.

const STEP_PATH_MATCH: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /^\/settings(\?tab=forms|#forms)/, key: 'intake_form' },
  { pattern: /^\/settings(\?tab=team|#team)/, key: 'invite_staff' },
  { pattern: /^\/settings(\?tab=payments|#payments)/, key: 'payments' },
  { pattern: /^\/settings(\?tab=notifications|#notifications)/, key: 'business_profile' },
  { pattern: /^\/website/, key: 'booking_page' },
  { pattern: /^\/forms\/intake/, key: 'intake_form' },
  { pattern: /^\/forms\/embed/, key: 'intake_form' },
  { pattern: /^\/forms\/session/, key: 'intake_form' },
  { pattern: /^\/forms/, key: 'intake_form' },
  { pattern: /^\/packages/, key: 'program_package' },
  { pattern: /^\/preview-as/, key: 'client_view' },
  // Session notes screen — serves both the "show_notes" and "homework" steps
  // (homework is added inside the session write-up). Attribute the page to
  // show_notes; both complete on CTA click so the distinction is cosmetic.
  { pattern: /^\/sessions/, key: 'show_notes' },
  // The invite form itself is where "Create a client" happens (add a record,
  // optionally without an email). The "Invite your first client" step's CTA
  // lands on the /clients list instead. The FAB's order-clamp handles the
  // rare case where the final-step trainer opens the form directly.
  { pattern: /^\/clients\/invite/, key: 'create_client' },
  // Match /clients (the list page) but NOT /clients/<id> (a specific client
  // profile). The list is where the Invite Client button lives.
  { pattern: /^\/clients(?:\?|#|$)/, key: 'invite_client' },
  // /schedule serves two onboarding steps. The query/hash flag from the
  // FAB CTA differentiates: ?availability=1 or #availability → the
  // "block out hours" step; bare /schedule → "create your first session".
  { pattern: /^\/schedule(\?availability=1|#availability)/, key: 'availability' },
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
  availability: '/schedule',
  business_profile: '/settings',
  intake_form: '/settings',
  program_package: '/packages',
  create_client: '/clients',
  client_view: '/clients',
  // No top-level nav item for the notes screen; sessions live under Schedule.
  // Homework is added on the same session write-up screen.
  show_notes: '/schedule',
  homework: '/schedule',
  invite_client: '/clients',
  payments: '/settings',
  booking_page: '/website',
  invite_staff: '/settings',
  // download_app opens a QR popup rather than a page; no sidebar item to pulse.
  download_app: '/dashboard',
  schedule_session: '/schedule',
}
