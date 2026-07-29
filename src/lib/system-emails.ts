/**
 * Every email the platform sends on a trainer's behalf, in one list.
 *
 * Until now each of these lived only inside the function that sent it, so the
 * wording could only be changed by editing code — and email copy was editable
 * in four unrelated places (the trainer's profile, a form, a booking page,
 * notification preferences) with no single screen showing what exists.
 *
 * This is that list. Settings → Email templates renders one row per entry;
 * a trainer edits the subject and body, and the sender resolves
 * `saved override → the default below`.
 *
 * WHAT A TRAINER CAN AND CANNOT CHANGE
 * The words, not the wrapper. The shell carries their logo, their colour and
 * the "Sent with PupManager" line — letting that be edited would break the
 * white-labelling the first time someone pasted something odd in. So: subject
 * and body text, with {{placeholders}}. Everything else is ours.
 */

export interface SystemEmailPlaceholder {
  token: string
  label: string
}

export interface SystemEmailDef {
  key: string
  label: string
  /** One line, plain English — shown under the name in the editor. */
  description: string
  /** Who receives it. */
  audience: 'client' | 'trainer' | 'staff'
  /**
   * What makes it send. `manual` = someone presses a button; `action` = it
   * follows an event like a signup or a payment; `scheduled` = a timed job.
   * Shown as a chip so a trainer knows whether editing it affects something
   * that goes out on its own.
   */
  trigger: 'manual' | 'action' | 'scheduled'
  placeholders: SystemEmailPlaceholder[]
  defaultSubject: string
  defaultBody: string
  /**
   * Some emails have no editable subject because the sender composes it (the
   * invite is the long-standing example — its subject is built from the
   * business name). Those show a body editor only.
   */
  subjectEditable?: boolean
}

const CLIENT_TOKENS: SystemEmailPlaceholder[] = [
  { token: '{{clientName}}', label: "Client's first name" },
  { token: '{{businessName}}', label: 'Your business name' },
  { token: '{{trainerName}}', label: 'Your name' },
]

const DOG_TOKEN: SystemEmailPlaceholder = { token: '{{dogName}}', label: "Dog's name" }

export const SYSTEM_EMAILS: SystemEmailDef[] = [
  {
    key: 'client_invite',
    label: 'Client invitation',
    description: 'Sent when you invite a client, or re-send their invite. Never sends on its own.',
    audience: 'client',
    trigger: 'manual',
    placeholders: [...CLIENT_TOKENS, DOG_TOKEN],
    defaultSubject: '',
    subjectEditable: false,
    defaultBody: `Hi {{clientName}},

You're invited to join my training app, where I'll share session notes, training plans, and progress for {{dogName}}.

Tap the button below to set up your account — takes about 30 seconds.

Looking forward to working with you and {{dogName}}.`,
  },
  {
    key: 'client_welcome',
    label: "You're in — client added",
    description: 'Goes to someone who signed themselves up once you accept them. They already have a password.',
    audience: 'client',
    trigger: 'action',
    placeholders: CLIENT_TOKENS,
    defaultSubject: "You're in — {{businessName}} added you",
    defaultBody: `{{businessName}} has added you to their client list. Sign in with the email and password you chose to see your sessions, notes and messages.`,
  },
  {
    key: 'client_verification',
    label: 'Confirm your email',
    description: 'Carries the 6-digit code when a client signs up through your link.',
    audience: 'client',
    trigger: 'action',
    placeholders: [...CLIENT_TOKENS, { token: '{{code}}', label: 'The 6-digit code' }],
    defaultSubject: 'Confirm your email to join {{businessName}}',
    defaultBody: `Hi {{clientName}} — thanks for signing up. We've let {{businessName}} know you'd like to join. They'll add you to their client list, and you'll get an email the moment they do.`,
  },
  {
    key: 'client_login_link',
    label: 'Sign-in link',
    description: 'A one-tap link so a client can get in without a password.',
    audience: 'client',
    trigger: 'action',
    placeholders: CLIENT_TOKENS,
    defaultSubject: 'Your sign-in link for {{businessName}}',
    defaultBody: `{{trainerName}} sent you a one-tap sign-in link for {{businessName}}. Tap the button below — you'll be straight in, no password needed.`,
  },
  {
    key: 'invoice_new',
    label: 'New invoice',
    description: 'Sent when you raise an invoice a client still owes.',
    audience: 'client',
    trigger: 'action',
    placeholders: [...CLIENT_TOKENS, { token: '{{amount}}', label: 'Amount due' }],
    defaultSubject: '{{businessName}}: new invoice',
    defaultBody: `Hi {{clientName}},

Here's your invoice for {{amount}}. You can pay it using the button below.

Thanks!`,
  },
  {
    key: 'booking_confirmed',
    label: 'Booking confirmed',
    description: 'Sent when you approve a booking request.',
    audience: 'client',
    trigger: 'action',
    placeholders: [...CLIENT_TOKENS, DOG_TOKEN, { token: '{{sessionDate}}', label: 'Date and time' }],
    defaultSubject: 'Booking confirmed: {{businessName}}',
    defaultBody: `Hi {{clientName}},

You're booked in for {{sessionDate}}. See you then!`,
  },
  {
    key: 'booking_declined',
    label: 'Booking declined',
    description: "Sent when you can't take a booking request.",
    audience: 'client',
    trigger: 'action',
    placeholders: [...CLIENT_TOKENS, { token: '{{sessionDate}}', label: 'Date and time' }],
    defaultSubject: 'About your booking request',
    defaultBody: `Hi {{clientName}},

Sorry — I can't make {{sessionDate}}. Get in touch and we'll find another time.`,
  },
  {
    key: 'waitlist_promoted',
    label: 'Off the waitlist',
    description: 'Sent automatically when a place opens on a full class and someone moves up.',
    audience: 'client',
    trigger: 'action',
    placeholders: [...CLIENT_TOKENS, { token: '{{className}}', label: 'Class name' }],
    defaultSubject: "You're off the waitlist for {{className}}",
    defaultBody: `Good news {{clientName}} — a place has come up on {{className}} and it's yours.

Have a look at the dates and we'll see you there.`,
  },
]

export const SYSTEM_EMAIL_KEYS = SYSTEM_EMAILS.map(e => e.key)

export function systemEmailDef(key: string): SystemEmailDef | undefined {
  return SYSTEM_EMAILS.find(e => e.key === key)
}

/** Fill {{tokens}}, leaving any it doesn't know visible rather than blank. */
export function fillSystemEmail(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, k) =>
    Object.prototype.hasOwnProperty.call(values, k) ? values[k] : whole,
  )
}

