import { describe, it, expect } from 'vitest'
import {
  resolveClientFieldConfig,
  CLIENT_FIELDS,
  QUICK_ADD_FOLLOW_UP_STATUS,
  type ResolvedFieldConfig,
} from '@/lib/client-fields'

describe('resolveClientFieldConfig — defaults', () => {
  it('returns the out-of-the-box defaults when given nothing', () => {
    const cfg = resolveClientFieldConfig(null)
    // Name required + quick-add; phone quick-add but not required; everything
    // else off.
    expect(cfg.name).toEqual({ required: true, quickAdd: true })
    expect(cfg.phone).toEqual({ required: false, quickAdd: true })
    // Email is captured by default in quick-add (df79ba2 — name + phone + email).
    expect(cfg.email).toEqual({ required: false, quickAdd: true })
    expect(cfg.dogName).toEqual({ required: false, quickAdd: false })
  })

  it('produces a complete, well-typed config for every known field key', () => {
    const cfg = resolveClientFieldConfig(undefined)
    for (const f of CLIENT_FIELDS) {
      expect(cfg[f.key]).toBeDefined()
      expect(typeof cfg[f.key].required).toBe('boolean')
      expect(typeof cfg[f.key].quickAdd).toBe('boolean')
    }
    expect(Object.keys(cfg).sort()).toEqual(CLIENT_FIELDS.map(f => f.key).sort())
  })

  it('treats junk input (string / number / array) as empty config', () => {
    for (const junk of ['nope', 42, [], true]) {
      const cfg = resolveClientFieldConfig(junk as unknown)
      expect(cfg.name.required).toBe(true)   // falls back to defaults
      expect(cfg.email.quickAdd).toBe(true)  // …including email in quick-add
    }
  })
})

describe('resolveClientFieldConfig — overrides', () => {
  it('lets a stored config override per-field defaults', () => {
    const cfg = resolveClientFieldConfig({
      email: { required: true, quickAdd: true },
      phone: { required: true },
    })
    expect(cfg.email).toEqual({ required: true, quickAdd: true })
    // phone: required overridden to true, quickAdd keeps its default (true).
    expect(cfg.phone).toEqual({ required: true, quickAdd: true })
    // untouched field keeps defaults.
    expect(cfg.dogBreed).toEqual({ required: false, quickAdd: false })
  })

  it('merges partial per-field config — missing prop falls back to default', () => {
    const cfg = resolveClientFieldConfig({ email: { quickAdd: true } })
    expect(cfg.email).toEqual({ required: false, quickAdd: true })
  })

  it('ignores a non-boolean prop value and uses the default', () => {
    const cfg = resolveClientFieldConfig({ email: { required: 'yes', quickAdd: 1 } } as unknown)
    // Non-boolean → default applies (email: not required, but IS in quick-add).
    expect(cfg.email).toEqual({ required: false, quickAdd: true })
  })

  it('ignores unknown field keys entirely', () => {
    const cfg = resolveClientFieldConfig({
      bogus: { required: true, quickAdd: true },
      vaccination: { required: true },
    } as unknown)
    expect((cfg as Record<string, unknown>).bogus).toBeUndefined()
    expect((cfg as Record<string, unknown>).vaccination).toBeUndefined()
    // Real keys unaffected.
    expect(cfg.name.required).toBe(true)
  })
})

describe('resolveClientFieldConfig — always-required enforcement', () => {
  it('keeps name required even when a config tries to turn it off', () => {
    const cfg = resolveClientFieldConfig({ name: { required: false, quickAdd: false } })
    // name has alwaysRequired → required is forced true regardless of config.
    expect(cfg.name.required).toBe(true)
    // quickAdd is still freely configurable.
    expect(cfg.name.quickAdd).toBe(false)
  })

  it('only "name" is structurally always-required in the catalog', () => {
    const always = CLIENT_FIELDS.filter(f => f.alwaysRequired).map(f => f.key)
    expect(always).toEqual(['name'])
  })
})

describe('client-fields constants', () => {
  it('quick-added contacts land in the NEW follow-up bucket', () => {
    expect(QUICK_ADD_FOLLOW_UP_STATUS).toBe('NEW')
  })

  it('covers exactly the nine documented field keys with correct scopes', () => {
    const keys = CLIENT_FIELDS.map(f => f.key)
    expect(keys).toEqual([
      'name', 'email', 'phone', 'address',
      'dogName', 'dogBreed', 'dogWeight', 'dogDob', 'dogNotes',
    ])
    const ownerKeys = CLIENT_FIELDS.filter(f => f.scope === 'OWNER').map(f => f.key)
    expect(ownerKeys).toEqual(['name', 'email', 'phone', 'address'])
  })
})

// Mirror the server-side required check in src/app/api/clients/route.ts so the
// resolution helper is exercised exactly the way the route uses it.
function missingRequired(cfg: ResolvedFieldConfig, present: Record<string, boolean>, mode: 'full' | 'quick') {
  for (const f of CLIENT_FIELDS) {
    const need = mode === 'quick' ? cfg[f.key].quickAdd : cfg[f.key].required
    if (need && !present[f.key]) return f.key
  }
  return null
}

describe('resolved config drives required-field enforcement', () => {
  const allEmpty = Object.fromEntries(CLIENT_FIELDS.map(f => [f.key, false]))

  it('full mode with defaults requires only a name', () => {
    const cfg = resolveClientFieldConfig(null)
    expect(missingRequired(cfg, { ...allEmpty }, 'full')).toBe('name')
    expect(missingRequired(cfg, { ...allEmpty, name: true }, 'full')).toBeNull()
  })

  it('quick mode with defaults requires name + phone + email', () => {
    const cfg = resolveClientFieldConfig(null)
    // Quick-add captures email as well now, so all three are needed.
    expect(missingRequired(cfg, { ...allEmpty, name: true }, 'quick')).not.toBeNull()
    expect(missingRequired(cfg, { ...allEmpty, name: true, phone: true }, 'quick')).toBe('email')
    expect(missingRequired(cfg, { ...allEmpty, name: true, phone: true, email: true }, 'quick')).toBeNull()
  })

  it('a config making email required is enforced in full mode', () => {
    const cfg = resolveClientFieldConfig({ email: { required: true } })
    expect(missingRequired(cfg, { ...allEmpty, name: true }, 'full')).toBe('email')
    expect(missingRequired(cfg, { ...allEmpty, name: true, email: true }, 'full')).toBeNull()
  })
})
