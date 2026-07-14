// Where a given field actually shows up. There is ONE field library — the
// built-in client/dog details (CLIENT_FIELDS) plus the trainer's custom fields
// — and three client-facing surfaces that draw from it:
//
//   Intake      the form a new client fills in once they're accepted
//   New client  the trainer's full "create client" form
//   Quick add   the cut-down quick-add contact form
//
// The rules used to be spread across three settings screens (Custom fields,
// Client capture fields, and a read-only capture matrix), which is why nobody
// could work out how to get a field onto a form. They live here now, and the
// field list renders them on each row.

export type FieldKind =
  // name / email / phone — the core contact fields the intake form collects.
  | 'CORE'
  // address + the dog details: captured when creating a client, not on intake.
  | 'DETAIL'
  // A trainer-defined custom field: always on intake and the new-client form.
  | 'CUSTOM'

export interface FieldFlags {
  kind: FieldKind
  /** Required on intake + the new-client form. */
  required: boolean
  /** Also shown on (and required by) the quick-add contact form. */
  quickAdd: boolean
}

export interface FieldUsage {
  intake: boolean
  newClient: boolean
  quickAdd: boolean
}

/** Which forms a field appears on. */
export function fieldUsage(f: FieldFlags): FieldUsage {
  return {
    // The intake form collects the core contact fields and every custom field;
    // address/dog details are only asked for at client-creation time.
    intake: f.kind === 'CORE' || f.kind === 'CUSTOM',
    // Every field in the library is available on the full create-client form.
    newClient: true,
    quickAdd: f.quickAdd,
  }
}

/** "Intake · New client · Quick add" — the row's plain-English summary. */
export function usedOnLabel(f: FieldFlags): string {
  const u = fieldUsage(f)
  const on: string[] = []
  if (u.intake) on.push('Intake')
  if (u.newClient) on.push('New client')
  if (u.quickAdd) on.push('Quick add')
  return on.join(' · ')
}
