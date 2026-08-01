import { describe, it, expect } from 'vitest'

import { parseSelection, type EmailTarget } from '@/app/(trainer)/clients/clients-list'

// The clients-list selection lives in sessionStorage and is read back through
// useSyncExternalStore, so what survives THIS function is what the trainer sees
// selected. A dropped entry has no error and no UI — the row simply springs
// back unticked.

const store = (targets: Partial<EmailTarget>[]) => JSON.stringify(targets)

describe('who survives a round-trip through storage', () => {
  it('keeps a client who has no email address', () => {
    // The bug this pins: the filter demanded `typeof email === 'string'` while
    // the type said `string | null`. A client registered without an email —
    // a supported case — was written to storage and then silently discarded on
    // read-back, so ticking them did nothing at all.
    const got = parseSelection(store([{ id: 'c1', name: 'No Email Nick', email: null, dogName: 'Bo' }]))

    expect(got.size).toBe(1)
    expect(got.get('c1')).toMatchObject({ id: 'c1', name: 'No Email Nick', email: null })
  })

  it('keeps a client who has one', () => {
    const got = parseSelection(store([{ id: 'c2', name: 'Sam', email: 'sam@example.com', dogName: null }]))
    expect(got.get('c2')?.email).toBe('sam@example.com')
  })

  it('keeps both together, in one selection', () => {
    const got = parseSelection(store([
      { id: 'c1', name: 'No Email Nick', email: null, dogName: null },
      { id: 'c2', name: 'Sam', email: 'sam@example.com', dogName: null },
    ]))
    expect([...got.keys()]).toEqual(['c1', 'c2'])
  })

  it('still refuses an entry with no id — there is nothing to act on', () => {
    expect(parseSelection(store([{ name: 'Nobody', email: 'x@y.z' }])).size).toBe(0)
  })

  it('treats corrupt storage as an empty selection rather than breaking the page', () => {
    expect(parseSelection('not json').size).toBe(0)
    expect(parseSelection('{"not":"an array"}').size).toBe(0)
    expect(parseSelection('').size).toBe(0)
  })

  it('normalises missing optional fields to null instead of undefined', () => {
    const got = parseSelection(store([{ id: 'c3', email: 'a@b.c' }]))
    expect(got.get('c3')).toMatchObject({ name: null, dogName: null })
  })
})
