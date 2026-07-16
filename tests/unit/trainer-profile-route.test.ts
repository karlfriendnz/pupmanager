import { describe, it, expect, vi, beforeEach } from 'vitest'

// The trainer-profile PATCH route now carries a SINGLE brand colour
// (emailAccentColor) — the old appGradientStart / appGradientEnd fields are
// gone. These tests pin that: the brand colour is still accepted (and empty
// string clears it to null), and any leftover gradient fields in a request body
// are ignored rather than written to the DB.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  profileUpdate: vi.fn(),
  profileFindUnique: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { update: h.profileUpdate, findUnique: h.profileFindUnique },
  },
}))

import { PATCH } from '@/app/api/trainer/profile/route'

const req = (body: unknown) =>
  new Request('https://app.pupmanager.com/api/trainer/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.guardPermission.mockResolvedValue({ companyId: 'company-1' })
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 't1', trainerId: 'company-1' } })
  h.profileUpdate.mockResolvedValue({ id: 'company-1' })
})

describe('PATCH trainer/profile — brand colour', () => {
  it('accepts a hex brand colour and writes it to the owned profile', async () => {
    const res = await PATCH(req({ emailAccentColor: '#2a9da9' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { emailAccentColor: '#2a9da9' },
    })
  })

  it('clears the brand colour to null when passed an empty string', async () => {
    const res = await PATCH(req({ emailAccentColor: '' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { emailAccentColor: null },
    })
  })

  it('rejects a non-hex brand colour with 400 (no write)', async () => {
    const res = await PATCH(req({ emailAccentColor: 'teal' }))
    expect(res.status).toBe(400)
    expect(h.profileUpdate).not.toHaveBeenCalled()
  })

  it('accepts a square brand iconUrl alongside the logo', async () => {
    const res = await PATCH(req({ iconUrl: 'https://blob.example.com/icon.png' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { iconUrl: 'https://blob.example.com/icon.png' },
    })
  })

  it('clears the icon when passed an empty string', async () => {
    const res = await PATCH(req({ iconUrl: '' }))
    expect(res.status).toBe(200)
    expect(h.profileUpdate).toHaveBeenCalledWith({
      where: { id: 'company-1' },
      data: { iconUrl: '' },
    })
  })

  it('ignores the retired appGradientStart / appGradientEnd fields', async () => {
    const res = await PATCH(req({
      emailAccentColor: '#123456',
      appGradientStart: '#000000',
      appGradientEnd: '#ffffff',
    }))
    expect(res.status).toBe(200)
    const data = h.profileUpdate.mock.calls[0][0].data
    expect(data).toEqual({ emailAccentColor: '#123456' })
    expect(data).not.toHaveProperty('appGradientStart')
    expect(data).not.toHaveProperty('appGradientEnd')
  })
})
