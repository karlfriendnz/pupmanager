import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: h.findUnique, update: h.update } } }))

import { reactivateOnSignIn } from '@/lib/reactivate-account'

beforeEach(() => {
  h.findUnique.mockReset()
  h.update.mockReset()
  h.update.mockResolvedValue({})
})

describe('reactivateOnSignIn', () => {
  it('clears deactivatedAt and returns true for a deactivated account', async () => {
    h.findUnique.mockResolvedValue({ deactivatedAt: new Date('2026-06-01') })
    expect(await reactivateOnSignIn('user_1')).toBe(true)
    expect(h.update).toHaveBeenCalledWith({ where: { id: 'user_1' }, data: { deactivatedAt: null } })
  })

  it('does nothing and returns false for an already-active account', async () => {
    h.findUnique.mockResolvedValue({ deactivatedAt: null })
    expect(await reactivateOnSignIn('user_2')).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('returns false when the user does not exist', async () => {
    h.findUnique.mockResolvedValue(null)
    expect(await reactivateOnSignIn('nope')).toBe(false)
    expect(h.update).not.toHaveBeenCalled()
  })
})
