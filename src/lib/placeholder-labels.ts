// Plain-language names for the {{tokens}} a trainer can drop into a message.
//
// DISPLAY ONLY — this file never changes what gets inserted or substituted.
// The tokens are the stored vocabulary: comms-flow steps, email templates and
// saved drafts already hold `{{name}}` / `{{clientName}}` etc. as literal text
// in the database, and every substitution path keys off those exact strings
// (`fill` in `lib/comms-flows.ts`, `fillPlaceholders` in `lib/client-email.ts`).
// Renaming a token would silently break every message a trainer has already
// written, so a token only ever gains a label beside it.
//
// One vocabulary, one place: every screen where a trainer picks a placeholder
// reads its options from here, so "Dog name" means the same thing everywhere.

export interface PlaceholderOption {
  /** The literal text inserted into the message. Never rename these. */
  token: string
  /** What the trainer reads on the button. */
  label: string
}

/**
 * Automated comms-flow steps on a class / drop-in / event / package.
 * Mirrors `COMMS_PLACEHOLDERS` in `lib/comms-flows.ts` — the tokens `fill()`
 * knows how to substitute.
 */
export const COMMS_PLACEHOLDER_OPTIONS: readonly PlaceholderOption[] = [
  { token: '{{name}}', label: 'Client name' },
  { token: '{{dog}}', label: 'Dog name' },
  { token: '{{time}}', label: 'Session time' },
  { token: '{{date}}', label: 'Session date' },
  { token: '{{class}}', label: 'Class name' },
  { token: '{{business}}', label: 'Business name' },
  { token: '{{location}}', label: 'Location' },
] as const

/**
 * Membership comms-flow steps. A membership has no session, so time/class/
 * location have nothing to say — mirrors `MEMBERSHIP_PLACEHOLDERS`.
 */
export const MEMBERSHIP_PLACEHOLDER_OPTIONS: readonly PlaceholderOption[] = [
  { token: '{{name}}', label: 'Client name' },
  { token: '{{dog}}', label: 'Dog name' },
  { token: '{{membership}}', label: 'Membership name' },
  { token: '{{business}}', label: 'Business name' },
  { token: '{{date}}', label: 'Date' },
] as const

/**
 * Which of the two comms-flow vocabularies a step editor may offer, decided by
 * what the flow hangs off. The two flows are filled by different code paths in
 * `lib/comms-flows.ts`: a class / drop-in / event step renders against a
 * SESSION and knows the time, the date, the class and the venue; a membership
 * step renders against a PURCHASE, where `processMembershipStep` passes
 * `location: ''` and only echoes the membership's own name into `{{class}}`.
 *
 * Offering the session set on a membership therefore handed the trainer
 * "Session time / Session date / Class name / Location" — tokens that
 * substitute to nothing or to the wrong noun — while hiding `{{membership}}`,
 * the one token that flow actually fills. Picking the set here rather than at
 * the screen keeps the choice testable against the engine.
 */
export function commsPlaceholderOptionsFor(
  context: 'session' | 'membership',
): readonly PlaceholderOption[] {
  return context === 'membership' ? MEMBERSHIP_PLACEHOLDER_OPTIONS : COMMS_PLACEHOLDER_OPTIONS
}

/**
 * Trainer→client email: the bulk marketing broadcast and the one-off Messages
 * composer, both rendered by `buildClientEmail`. A different token set from the
 * comms flows above (longer names, no session context) — kept as it is because
 * trainers' saved templates and drafts contain these strings verbatim.
 */
export const CLIENT_EMAIL_PLACEHOLDER_OPTIONS: readonly PlaceholderOption[] = [
  { token: '{{clientName}}', label: 'Client name' },
  { token: '{{trainerName}}', label: 'Your name' },
  { token: '{{businessName}}', label: 'Business name' },
  { token: '{{dogName}}', label: 'Dog name' },
] as const

/**
 * The trainer→client INVITE email (Settings → Email templates → "Client
 * invitation", stored on `TrainerProfile.inviteTemplate`). It is rendered by
 * `renderClientInviteEmail`, NOT `buildClientEmail`, and that renderer only
 * knows two tokens — offering the other client-email ones here would print
 * `{{businessName}}` verbatim in a real invite.
 */
export const CLIENT_INVITE_PLACEHOLDER_OPTIONS: readonly PlaceholderOption[] = [
  { token: '{{clientName}}', label: 'Client name' },
  { token: '{{dogName}}', label: 'Dog name' },
] as const

/**
 * Booking-page automations (Settings → Booking pages → Automations).
 *
 * SINGLE brace on purpose. This is a different substitution engine: `fill()` in
 * `lib/booking-automations.ts` matches `/\{name\}/g` — a one-brace regex that
 * would not see `{{name}}` as its own token, and the `{{…}}` engines would not
 * see `{name}`. The two vocabularies are unrelated and neither can be migrated
 * to the other without rewriting every automation a trainer has saved, so this
 * list stays single-brace and lives beside the others only so the LABELS match.
 * Mirrors `AUTOMATION_PLACEHOLDERS` in `lib/booking-automations.ts`.
 */
export const BOOKING_PAGE_PLACEHOLDER_OPTIONS: readonly PlaceholderOption[] = [
  { token: '{name}', label: 'Client name' },
  { token: '{dog}', label: 'Dog name' },
  { token: '{time}', label: 'Session time' },
  { token: '{business}', label: 'Business name' },
] as const

/**
 * Trainer/client notification copy (Settings → Notifications). A fourth
 * vocabulary: `notification-types.ts` stores placeholder names BARE (`dogName`,
 * not `{{dogName}}`) per notification type and the panel wraps them in braces,
 * so this map is keyed by the bare name. `renderTemplate` substitutes whatever
 * key the sender puts in its values map — every name below is one a cron or a
 * notify helper genuinely fills (each type's `sampleValues` is the proof, and
 * a unit test pins the two together).
 */
export const NOTIFICATION_PLACEHOLDER_LABELS: Record<string, string> = {
  amount: 'Amount',
  clientCount: 'Number of clients',
  clientName: 'Client name',
  description: 'Description',
  detail: 'Details',
  dogName: 'Dog name',
  email: 'Email address',
  endTime: 'End time',
  firstSessionTime: 'First session time',
  hours: 'Hours waiting',
  message: 'Message',
  minutesBefore: 'Minutes before',
  name: 'Name',
  nextWeekSessions: 'Sessions next week',
  nextWeekTasks: 'Tasks next week',
  planName: 'Plan name',
  preview: 'Message preview',
  revenue: 'Revenue',
  senderName: 'Sender name',
  sessionCount: 'Number of sessions',
  sessionsCompleted: 'Sessions completed',
  startTime: 'Start time',
  summary: 'Summary',
  taskCount: 'Number of tasks',
  taskTitle: 'Task name',
  title: 'Session title',
  trainerName: 'Trainer name',
  waited: 'Time waiting',
  weeks: 'Number of weeks',
}

/** The label for a bare notification placeholder name, e.g. `dogName`. */
export function notificationPlaceholderLabel(name: string): string {
  return NOTIFICATION_PLACEHOLDER_LABELS[name] ?? name
}

/**
 * Every `{{token}}` → its plain-language label, for one-off lookups.
 * Deliberately excludes the booking-page list (single-brace, different engine)
 * and the notification names (bare, no braces) — those have their own lookups.
 */
export const PLACEHOLDER_LABELS: Record<string, string> = Object.fromEntries(
  [
    ...COMMS_PLACEHOLDER_OPTIONS,
    ...MEMBERSHIP_PLACEHOLDER_OPTIONS,
    ...CLIENT_EMAIL_PLACEHOLDER_OPTIONS,
    ...CLIENT_INVITE_PLACEHOLDER_OPTIONS,
  ].map(o => [o.token, o.label]),
)

/** The label for a token, falling back to the raw token if it's unknown. */
export function placeholderLabel(token: string): string {
  return PLACEHOLDER_LABELS[token] ?? token
}
