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

/** Every token → its plain-language label, for one-off lookups. */
export const PLACEHOLDER_LABELS: Record<string, string> = Object.fromEntries(
  [
    ...COMMS_PLACEHOLDER_OPTIONS,
    ...MEMBERSHIP_PLACEHOLDER_OPTIONS,
    ...CLIENT_EMAIL_PLACEHOLDER_OPTIONS,
  ].map(o => [o.token, o.label]),
)

/** The label for a token, falling back to the raw token if it's unknown. */
export function placeholderLabel(token: string): string {
  return PLACEHOLDER_LABELS[token] ?? token
}
