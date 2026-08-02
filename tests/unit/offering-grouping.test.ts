import { describe, it, expect } from 'vitest'
import {
  groupOfferingsByTag,
  canGroupByTag,
  UNTAGGED_KEY,
  UNTAGGED_LABEL,
  type TagRef,
} from '@/lib/offering-grouping'

// Grouping an offering list by tag. The rule that matters most: a tag is a
// LABEL, not a folder, so a row carrying two tags belongs under both headings.
type Row = { id: string; tags?: TagRef[] }

const PUPPY = { id: 't_puppy', name: 'Puppy' }
const RECALL = { id: 't_recall', name: 'Recall' }
const REACTIVE = { id: 't_reactive', name: 'Reactive' }

const tagsOf = (r: Row) => r.tags
const group = (rows: Row[], order: string[] = []) => groupOfferingsByTag(rows, tagsOf, order)

describe('groupOfferingsByTag — where a row lands', () => {
  it('puts a row under every tag it carries, not just the first', () => {
    // The whole point. Filing "Puppy Foundations" under Puppy alone hides it
    // from a trainer who went looking under Recall — with the word written on
    // the offering itself.
    const rows: Row[] = [{ id: 'a', tags: [PUPPY, RECALL] }]
    const groups = group(rows, [PUPPY.id, RECALL.id])
    expect(groups.map(g => g.label)).toEqual(['Puppy', 'Recall'])
    expect(groups[0].items).toEqual(rows)
    expect(groups[1].items).toEqual(rows)
  })

  it('collects untagged rows into one run, last', () => {
    const groups = group(
      [{ id: 'a', tags: [PUPPY] }, { id: 'b' }, { id: 'c', tags: [] }],
      [PUPPY.id],
    )
    expect(groups.map(g => g.key)).toEqual([PUPPY.id, UNTAGGED_KEY])
    expect(groups[1].label).toBe(UNTAGGED_LABEL)
    expect(groups[1].items.map(r => r.id)).toEqual(['b', 'c'])
  })

  it('omits the untagged heading entirely when everything is tagged', () => {
    // A tidy list should not grow a "No tag" heading with nothing under it.
    const groups = group([{ id: 'a', tags: [PUPPY] }], [PUPPY.id])
    expect(groups).toHaveLength(1)
    expect(groups.some(g => g.key === UNTAGGED_KEY)).toBe(false)
  })

  it('returns nothing at all for an empty list', () => {
    expect(group([])).toEqual([])
  })
})

describe('groupOfferingsByTag — order', () => {
  it('follows the trainer’s own tag arrangement, so headings match their tag screen', () => {
    const rows: Row[] = [
      { id: 'a', tags: [RECALL] },
      { id: 'b', tags: [PUPPY] },
      { id: 'c', tags: [REACTIVE] },
    ]
    const groups = group(rows, [REACTIVE.id, PUPPY.id, RECALL.id])
    expect(groups.map(g => g.label)).toEqual(['Reactive', 'Puppy', 'Recall'])
  })

  it('sorts a tag missing from the arrangement after the ranked ones, by name', () => {
    // A tag made in another tab is not in the order this page was rendered
    // with. It still has to appear somewhere predictable.
    const rows: Row[] = [
      { id: 'a', tags: [{ id: 't_zzz', name: 'Zoomies' }] },
      { id: 'b', tags: [{ id: 't_aaa', name: 'Agility' }] },
      { id: 'c', tags: [PUPPY] },
    ]
    const groups = group(rows, [PUPPY.id])
    expect(groups.map(g => g.label)).toEqual(['Puppy', 'Agility', 'Zoomies'])
  })

  it('keeps the trainer’s arranged row order WITHIN a group', () => {
    // That order is what clients see in the booking flow, so grouping must
    // read it back, never re-sort it.
    const rows: Row[] = [
      { id: 'third', tags: [PUPPY] },
      { id: 'first', tags: [PUPPY] },
      { id: 'second', tags: [PUPPY] },
    ]
    expect(group(rows, [PUPPY.id])[0].items.map(r => r.id)).toEqual(['third', 'first', 'second'])
  })

  it('untagged stays last even when tags are unranked', () => {
    const groups = group([{ id: 'a' }, { id: 'b', tags: [PUPPY] }], [])
    expect(groups[groups.length - 1].key).toBe(UNTAGGED_KEY)
  })
})

describe('groupOfferingsByTag — the label shown', () => {
  it('uses the tag’s own name, capitals and all', () => {
    const groups = group([{ id: 'a', tags: [{ id: 't', name: 'Puppy School' }] }])
    expect(groups[0].label).toBe('Puppy School')
  })

  it('groups on the id, so two tags that merely read alike stay apart', () => {
    const rows: Row[] = [
      { id: 'a', tags: [{ id: 't_1', name: 'Puppy' }] },
      { id: 'b', tags: [{ id: 't_2', name: 'Puppy' }] },
    ]
    expect(group(rows)).toHaveLength(2)
  })
})

describe('canGroupByTag — whether to offer the control at all', () => {
  it('is false when nothing on the page carries a tag', () => {
    // The switch could only ever produce one heading reading "No tag". A
    // trainer who has never made a tag should not have to learn what it does.
    expect(canGroupByTag([{ id: 'a' }, { id: 'b', tags: [] }], tagsOf)).toBe(false)
  })

  it('is false for an empty list', () => {
    expect(canGroupByTag([] as Row[], tagsOf)).toBe(false)
  })

  it('is true as soon as one row carries one tag', () => {
    expect(canGroupByTag([{ id: 'a' }, { id: 'b', tags: [PUPPY] }], tagsOf)).toBe(true)
  })
})
