import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ dogFindFirst: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { dog: { findFirst: h.dogFindFirst } } }))

import { dogBelongsToClient, dogBelongsToAnyClient } from '@/lib/dog-access'

beforeEach(() => h.dogFindFirst.mockReset())

describe('dogBelongsToClient — cross-dog ownership guard', () => {
  it('true when the scoped lookup finds the dog', async () => {
    h.dogFindFirst.mockResolvedValue({ id: 'dog-1' })
    expect(await dogBelongsToClient('dog-1', 'client-1')).toBe(true)
    // The query must constrain by the client (primary or additional ownership).
    const where = h.dogFindFirst.mock.calls[0][0].where
    expect(where.id).toBe('dog-1')
    expect(where.OR).toEqual([
      { clientProfileId: 'client-1' },
      { primaryFor: { some: { id: 'client-1' } } },
    ])
  })

  it('false (no cross-dog access) when the scoped lookup finds nothing', async () => {
    h.dogFindFirst.mockResolvedValue(null)
    expect(await dogBelongsToClient('foreign-dog', 'client-1')).toBe(false)
  })

  it('dogBelongsToAnyClient is false for an empty profile set (never matches all)', async () => {
    expect(await dogBelongsToAnyClient('dog-1', [])).toBe(false)
    expect(h.dogFindFirst).not.toHaveBeenCalled()
  })

  it('dogBelongsToAnyClient scopes across every supplied profile id', async () => {
    h.dogFindFirst.mockResolvedValue({ id: 'dog-1' })
    expect(await dogBelongsToAnyClient('dog-1', ['a', 'b'])).toBe(true)
    const where = h.dogFindFirst.mock.calls[0][0].where
    expect(where.OR[0]).toEqual({ clientProfileId: { in: ['a', 'b'] } })
  })
})
