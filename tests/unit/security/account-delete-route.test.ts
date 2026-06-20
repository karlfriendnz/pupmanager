import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// Shared mock handles (vi.mock is hoisted, so build them via vi.hoisted).
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ env: { NEXT_PUBLIC_APP_URL: 'https://app.pupmanager.com' } }))
vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: h.findUnique, update: h.update, delete: h.del } } }))
vi.mock('@/lib/rate-limit', () => ({ enforceRateLimit: vi.fn(async () => null) }))
vi.mock('@/lib/audit', () => ({ recordAudit: vi.fn(async () => {}), auditRequestMeta: () => ({ ip: '1.1.1.1', userAgent: 'test' }) }))

import { DELETE } from '@/app/api/user/delete/route'

const PASSWORD = 'correct-horse'
const HASH = bcrypt.hashSync(PASSWORD, 4)

function req(body: unknown, origin = 'https://app.pupmanager.com'): Request {
  return new Request('https://app.pupmanager.com/api/user/delete', {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  h.auth.mockReset(); h.findUnique.mockReset(); h.update.mockReset(); h.del.mockReset()
  h.update.mockResolvedValue({})
})

describe('DELETE /api/user/delete — secure account deletion', () => {
  it('blocks a cross-site request (CSRF) before touching anything', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    const res = await DELETE(req({ password: PASSWORD }, 'https://evil.com'))
    expect(res.status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const res = await DELETE(req({ password: PASSWORD }))
    expect(res.status).toBe(401)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('rejects a wrong password (no deletion happens)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.findUnique.mockResolvedValue({ id: 'u1', deactivatedAt: null, accounts: [{ provider: 'credentials', providerAccountId: HASH }] })
    const res = await DELETE(req({ password: 'wrong' }))
    expect(res.status).toBe(403)
    expect(h.update).not.toHaveBeenCalled()
  })

  it('SOFT-deletes on correct password (sets deactivatedAt, never hard-deletes)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', trainerId: 'co1' } })
    h.findUnique.mockResolvedValue({ id: 'u1', deactivatedAt: null, accounts: [{ provider: 'credentials', providerAccountId: HASH }] })
    const res = await DELETE(req({ password: PASSWORD }))
    expect(res.status).toBe(200)
    // Soft delete: an update setting deactivatedAt — NOT a destructive delete.
    expect(h.update).toHaveBeenCalledTimes(1)
    expect(h.update.mock.calls[0][0].data.deactivatedAt).toBeInstanceOf(Date)
    expect(h.del).not.toHaveBeenCalled()
  })

  it('OAuth-only account requires typing DELETE (password path N/A)', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1' } })
    h.findUnique.mockResolvedValue({ id: 'u1', deactivatedAt: null, accounts: [{ provider: 'google', providerAccountId: 'x' }] })
    expect((await DELETE(req({ confirm: 'nope' }))).status).toBe(403)
    h.update.mockResolvedValue({})
    expect((await DELETE(req({ confirm: 'DELETE' }))).status).toBe(200)
  })
})
