import { describe, it, expect } from 'vitest'
import { resolveClientFieldConfig, type ResolvedFieldConfig } from '@/lib/client-fields'
import {
  buildFieldRows,
  rowsToFieldConfig,
  isDefaultConfig,
  ONBOARDING_SUGGESTED,
} from '@/lib/onboarding/client-fields-setup'

// Pure logic behind the onboarding "Set up your client fields" wizard step.
// It maps the friendly three-toggle UI (Include / Quick add / Required) onto
// the shared two-flag config (required / quickAdd) with no ambiguity, and
// round-trips through it so choices land in the SAME config settings reads.

describe('isDefaultConfig', () => {
  it('is true for the library defaults', () => {
    expect(isDefaultConfig(resolveClientFieldConfig(null))).toBe(true)
  })
  it('is false once any field is customised', () => {
    const cfg = resolveClientFieldConfig({ email: { required: true } })
    expect(isDefaultConfig(cfg)).toBe(false)
  })
})

describe('buildFieldRows — fresh config seeds onboarding suggestions', () => {
  const rows = buildFieldRows(resolveClientFieldConfig(null))
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]))

  it('applies the curated suggestions, not the bare library defaults', () => {
    // dogName is NOT captured by the bare defaults but IS a suggested include.
    expect(byKey.dogName.include).toBe(true)
    expect(ONBOARDING_SUGGESTED.dogName.include).toBe(true)
    expect(byKey.dogBreed.include).toBe(true)
  })

  it('name is on + required + locked (structurally required)', () => {
    expect(byKey.name.include).toBe(true)
    expect(byKey.name.required).toBe(true)
    expect(byKey.name.locked).toBe(true)
  })

  it('phone and email are included + on quick-add, not required', () => {
    for (const k of ['phone', 'email'] as const) {
      expect(byKey[k].include).toBe(true)
      expect(byKey[k].quickAdd).toBe(true)
      expect(byKey[k].required).toBe(false)
    }
  })

  it('groups fields by owner vs dog scope', () => {
    expect(byKey.name.scope).toBe('OWNER')
    expect(byKey.dogName.scope).toBe('DOG')
  })
})

describe('buildFieldRows — customised config is reflected, not overwritten', () => {
  it('derives Include from required-or-quickAdd and keeps the real flags', () => {
    // A returning trainer who requires email and dropped phone from quick-add.
    const cfg: ResolvedFieldConfig = resolveClientFieldConfig({
      email: { required: true, quickAdd: false },
      phone: { required: false, quickAdd: false },
    })
    const byKey = Object.fromEntries(buildFieldRows(cfg).map(r => [r.key, r]))
    expect(byKey.email.include).toBe(true) // required ⇒ included
    expect(byKey.email.required).toBe(true)
    expect(byKey.phone.include).toBe(false) // neither ⇒ not captured
  })
})

describe('rowsToFieldConfig — faithful, lossless serialization', () => {
  it('collapses excluded fields to { required:false, quickAdd:false }', () => {
    const rows = buildFieldRows(resolveClientFieldConfig(null)).map(r =>
      r.key === 'dogNotes' ? { ...r, include: true, quickAdd: true, required: true } : r,
    )
    // dogNotes forced included+quick+required above.
    const included = rowsToFieldConfig(rows)
    expect(included.dogNotes).toEqual({ required: true, quickAdd: true })

    // Now exclude it — quick/required must not leak through.
    const excludedRows = rows.map(r => (r.key === 'dogNotes' ? { ...r, include: false } : r))
    expect(rowsToFieldConfig(excludedRows).dogNotes).toEqual({ required: false, quickAdd: false })
  })

  it('locked name always serializes required', () => {
    const rows = buildFieldRows(resolveClientFieldConfig(null))
    expect(rowsToFieldConfig(rows).name.required).toBe(true)
  })

  it('produces a config accepted back by resolveClientFieldConfig unchanged (round-trip)', () => {
    const cfg = resolveClientFieldConfig({ email: { required: true, quickAdd: true } })
    const out = rowsToFieldConfig(buildFieldRows(cfg))
    // Re-resolving the serialized config yields the same flags — no drift.
    expect(resolveClientFieldConfig(out)).toEqual(out)
  })
})
