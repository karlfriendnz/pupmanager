// The BUILT-IN client/dog details — the fixed ones that back real columns on
// User / ClientProfile / Dog.
//
// These used to carry a per-company config: which were required on the create
// screen, and which appeared on quick-add. That config is gone (Karl,
// 2026-07-30: "the system fields are just a result of the forms"). A form now
// says what a client is asked for, and its questions carry their own `required` —
// so requiredness belongs to whoever is filling that form in, not to a global
// setting that also policed the trainer's own typing.
//
// What's left here is the catalogue: what each detail is called, whose record it
// belongs to, and what kind of input it wants.

export type ClientFieldKey =
  | 'name' | 'email' | 'phone' | 'address'
  | 'dogName' | 'dogBreed' | 'dogWeight' | 'dogDob' | 'dogNotes'

export interface ClientFieldDef {
  key: ClientFieldKey
  label: string
  scope: 'OWNER' | 'DOG'
  input: 'text' | 'email' | 'tel' | 'number' | 'date' | 'address' | 'textarea'
  /** Structurally required — the trainer can't toggle it off (a client needs a name). */
  alwaysRequired?: boolean
}

export const CLIENT_FIELDS: ClientFieldDef[] = [
  { key: 'name',      label: 'Client name',   scope: 'OWNER', input: 'text', alwaysRequired: true },
  { key: 'email',     label: 'Email',         scope: 'OWNER', input: 'email' },
  { key: 'phone',     label: 'Phone',         scope: 'OWNER', input: 'tel' },
  { key: 'address',   label: 'Address',       scope: 'OWNER', input: 'address' },
  { key: 'dogName',   label: "Dog's name",    scope: 'DOG',   input: 'text' },
  { key: 'dogBreed',  label: 'Breed',         scope: 'DOG',   input: 'text' },
  { key: 'dogWeight', label: 'Weight (kg)',   scope: 'DOG',   input: 'number' },
  { key: 'dogDob',    label: 'Date of birth', scope: 'DOG',   input: 'date' },
  { key: 'dogNotes',  label: 'Notes',         scope: 'DOG',   input: 'textarea' },
]

/**
 * The three a trainer wants when they meet someone and jot them down.
 *
 * Fixed rather than configurable: quick-add exists to capture a walk-in in ten
 * seconds, and the version of it that let you add fields was the version where a
 * trainer couldn't save someone whose email they didn't have. Ask for anything
 * more on a form.
 */
export const QUICK_ADD_KEYS: ClientFieldKey[] = ['name', 'phone', 'email']

// Quick-added contacts land in the existing "New" bucket (the /clients "New"
// tab) so they surface as needing follow-up without a parallel status/tab.
export const QUICK_ADD_FOLLOW_UP_STATUS = 'NEW'

/**
 * What to call a built-in detail on a form.
 *
 * Used by the question builder, which asks for these as questions now rather than
 * reading a separate configuration screen. An unknown key returns itself rather
 * than throwing: a form authored against a key we later rename should still render
 * something a trainer can recognise and remove.
 */
export function clientFieldLabel(key: string): string {
  return CLIENT_FIELDS.find(f => f.key === key)?.label ?? key
}

/** Is this detail about the dog rather than the owner? */
export function clientFieldIsDogDetail(key: string): boolean {
  return CLIENT_FIELDS.find(f => f.key === key)?.scope === 'DOG'
}

/**
 * The input a built-in detail should render as, in the vocabulary the form runner
 * uses for its own question types.
 *
 * An email gets an email box, a birthday a date picker, weight a number — the
 * shape belongs to the detail, so a trainer never picks it and can't pick wrong.
 */
export function clientFieldInputType(key: string): string {
  const input = CLIENT_FIELDS.find(f => f.key === key)?.input
  switch (input) {
    case 'textarea': return 'LONG_TEXT'
    case 'number': return 'NUMBER'
    case 'date': return 'DATE'
    case 'email': return 'EMAIL'
    case 'tel': return 'TEL'
    // An address is a single line here; the full lookup lives on the client form
    // rather than in a generic runner.
    default: return 'SHORT_TEXT'
  }
}

/**
 * Every built-in key, as a tuple, for validating what a form may ask for.
 *
 * Derived from CLIENT_FIELDS so the two can't disagree — adding a detail there
 * makes it askable, with nothing else to remember.
 */
export const CLIENT_FIELD_KEYS = CLIENT_FIELDS.map(f => f.key) as [ClientFieldKey, ...ClientFieldKey[]]
