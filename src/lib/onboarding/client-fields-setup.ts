// Pure logic backing the onboarding "Set up your client fields" wizard step.
// Kept free of React so it can be unit-tested directly.
//
// The persisted per-company config (src/lib/client-fields.ts) has exactly two
// axes per built-in field: `required` and `quickAdd`. The onboarding step
// presents a friendlier three-toggle model — Include / Quick add / Required —
// where "Include" is the master: a field that is neither required nor on the
// quick-add form is treated as "not actively captured" (Include off). This
// maps losslessly onto the two-flag config, so the step writes through the
// SAME config the quick-add form, create-client form and Settings → Forms all
// read — no parallel store.

import {
  CLIENT_FIELDS,
  resolveClientFieldConfig,
  type ClientFieldKey,
  type ResolvedFieldConfig,
} from '@/lib/client-fields'

export type FieldRow = {
  key: ClientFieldKey
  label: string
  scope: 'OWNER' | 'DOG'
  /** Master: is this field part of what the trainer actively captures? */
  include: boolean
  /** Show on (and require for) the fast quick-add form. */
  quickAdd: boolean
  /** Mandatory on the full create-client form. */
  required: boolean
  /** Structurally locked on (a client always needs a name) — can't toggle off. */
  locked: boolean
}

// Curated first-run suggestions tuned for a dog-training business. Applied only
// when the trainer hasn't customised their config yet (it still equals the
// library defaults) so a returning trainer's real choices are never clobbered.
// Deliberately NO vaccination / compliance fields — explicitly out of scope for
// PupManager.
export const ONBOARDING_SUGGESTED: Record<
  ClientFieldKey,
  { include: boolean; quickAdd: boolean; required: boolean }
> = {
  name:      { include: true,  quickAdd: true,  required: true },
  phone:     { include: true,  quickAdd: true,  required: false },
  email:     { include: true,  quickAdd: true,  required: false },
  address:   { include: false, quickAdd: false, required: false },
  dogName:   { include: true,  quickAdd: false, required: false },
  dogBreed:  { include: true,  quickAdd: false, required: false },
  dogWeight: { include: false, quickAdd: false, required: false },
  dogDob:    { include: false, quickAdd: false, required: false },
  dogNotes:  { include: false, quickAdd: false, required: false },
}

// True when the resolved config is still at the library defaults — i.e. the
// trainer has never touched their field config, so it's safe to seed the
// friendlier onboarding suggestions instead of the bare defaults.
export function isDefaultConfig(config: ResolvedFieldConfig): boolean {
  const def = resolveClientFieldConfig(null)
  return CLIENT_FIELDS.every(
    f =>
      config[f.key].required === def[f.key].required &&
      config[f.key].quickAdd === def[f.key].quickAdd,
  )
}

// Build the editable rows for the step from a resolved config. A fresh (never
// customised) config gets the curated suggestions; an already-customised one is
// reflected faithfully, deriving Include from "required or on quick-add".
export function buildFieldRows(config: ResolvedFieldConfig): FieldRow[] {
  const fresh = isDefaultConfig(config)
  return CLIENT_FIELDS.map(f => {
    const locked = !!f.alwaysRequired
    if (fresh) {
      const s = ONBOARDING_SUGGESTED[f.key]
      return {
        key: f.key,
        label: f.label,
        scope: f.scope,
        include: locked ? true : s.include,
        quickAdd: s.quickAdd,
        required: locked ? true : s.required,
        locked,
      }
    }
    const c = config[f.key]
    return {
      key: f.key,
      label: f.label,
      scope: f.scope,
      include: locked ? true : c.required || c.quickAdd,
      quickAdd: c.quickAdd,
      required: locked ? true : c.required,
      locked,
    }
  })
}

// Serialize the rows back to the shared two-flag config for the PATCH. Excluded
// fields collapse to { required:false, quickAdd:false }; quick-add / required
// only count when the field is included. Locked fields stay required.
export function rowsToFieldConfig(rows: FieldRow[]): ResolvedFieldConfig {
  const out = {} as ResolvedFieldConfig
  for (const r of rows) {
    out[r.key] = {
      required: r.locked ? true : r.include && r.required,
      quickAdd: r.include && r.quickAdd,
    }
  }
  return out
}
