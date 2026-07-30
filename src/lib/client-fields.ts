// Single source of truth for the BUILT-IN client/dog fields used when creating
// a client — the full create form, the quick-add contact form, the per-company
// config UI, and the server-side required validation all read from here.
//
// Custom fields are configured separately (CustomField.required / .inQuickAdd);
// this file only covers the fixed fields that back real columns on
// User / ClientProfile / Dog.

export type ClientFieldKey =
  | 'name' | 'email' | 'phone' | 'address'
  | 'dogName' | 'dogBreed' | 'dogWeight' | 'dogDob' | 'dogNotes'

export type FieldMode = {
  /** Required in the full "create client" form (and intake). */
  required: boolean
  /** Shown in — and required for — the quick-add contact form. */
  quickAdd: boolean
}

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

// Sensible out-of-the-box behaviour before a trainer customises anything:
// full form requires only a name; quick-add captures name + phone + email (the
// three you almost always want when you meet someone). All toggleable in
// Settings → Fields & forms.
const DEFAULTS: Record<ClientFieldKey, FieldMode> = {
  name:      { required: true,  quickAdd: true },
  phone:     { required: false, quickAdd: true },
  email:     { required: false, quickAdd: true },
  address:   { required: false, quickAdd: false },
  dogName:   { required: false, quickAdd: false },
  dogBreed:  { required: false, quickAdd: false },
  dogWeight: { required: false, quickAdd: false },
  dogDob:    { required: false, quickAdd: false },
  dogNotes:  { required: false, quickAdd: false },
}

export type ResolvedFieldConfig = Record<ClientFieldKey, FieldMode>

// Merge a trainer's stored clientFieldConfig JSON over the defaults so callers
// always get a complete, well-typed config (missing keys filled in).
export function resolveClientFieldConfig(raw: unknown): ResolvedFieldConfig {
  const cfg = (raw && typeof raw === 'object') ? raw as Record<string, Partial<FieldMode>> : {}
  const out = {} as ResolvedFieldConfig
  for (const f of CLIENT_FIELDS) {
    const d = DEFAULTS[f.key]
    const o = cfg[f.key] ?? {}
    out[f.key] = {
      required: f.alwaysRequired ? true : (typeof o.required === 'boolean' ? o.required : d.required),
      quickAdd: typeof o.quickAdd === 'boolean' ? o.quickAdd : d.quickAdd,
    }
  }
  return out
}

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
