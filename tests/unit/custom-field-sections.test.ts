import { describe, it, expect } from 'vitest'
import { buildSections } from '@/app/(trainer)/settings/custom-fields-manager'

const field = (over: Partial<Parameters<typeof buildSections>[0][number]> = {}) => ({
  id: 'f1',
  label: 'Breed',
  type: 'TEXT' as const,
  required: false,
  options: [],
  category: null as string | null,
  appliesTo: 'OWNER' as const,
  order: 0,
  ...over,
})

describe('buildSections', () => {
  it('hides the orphan bucket when every field belongs to a section', () => {
    const sections = buildSections(
      [field({ id: 'a', category: 'About you' })],
      [{ name: 'About you', description: null }]
    )
    expect(sections.map(s => s.id)).toEqual(['About you'])
  })

  it('surfaces an orphan bucket for fields with no section', () => {
    const sections = buildSections(
      [field({ id: 'a', category: null }), field({ id: 'b', category: 'About you' })],
      [{ name: 'About you', description: null }]
    )
    expect(sections[0].isOrphan).toBe(true)
    expect(sections[0].fields.map(f => f.id)).toEqual(['a'])
  })

  it('treats a field whose section was deleted as an orphan', () => {
    const sections = buildSections([field({ id: 'a', category: 'Gone' })], [])
    expect(sections[0].isOrphan).toBe(true)
    expect(sections[0].fields.map(f => f.id)).toEqual(['a'])
  })

  // The "Add field" affordance outside any section: the bucket has to stay on
  // screen with zero fields in it so the inline editor has somewhere to render.
  it('keeps an empty orphan bucket when forceOrphan is set', () => {
    const sections = buildSections([], [{ name: 'About you', description: null }], true)
    expect(sections[0].isOrphan).toBe(true)
    expect(sections[0].fields).toEqual([])
    expect(sections[1].id).toBe('About you')
  })

  it('shows an orphan bucket even with no sections at all when forceOrphan is set', () => {
    expect(buildSections([], [], false)).toEqual([])
    expect(buildSections([], [], true).map(s => s.isOrphan)).toEqual([true])
  })

  it('sorts fields within a section by order', () => {
    const sections = buildSections(
      [
        field({ id: 'b', category: 'About you', order: 2 }),
        field({ id: 'a', category: 'About you', order: 1 }),
      ],
      [{ name: 'About you', description: null }]
    )
    expect(sections[0].fields.map(f => f.id)).toEqual(['a', 'b'])
  })
})
