import { it, expect, vi, beforeEach } from 'vitest'

// ensureClientXeroContact — loads a client, ensures their Xero Contact, and
// persists the id. Contract: no-op (null) when the client is gone or the trainer
// isn't connected; cached id short-circuits; otherwise create + persist.
const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  ensureXeroContact: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { clientProfile: { findUnique: h.findUnique, update: h.update } },
}))
vi.mock('@/lib/xero', () => ({ ensureXeroContact: h.ensureXeroContact }))

import { ensureClientXeroContact } from '@/lib/xero-sync'

const connection = { id: 'xc-1', tenantId: 't' }

beforeEach(() => vi.clearAllMocks())

it('returns null when the client does not exist', async () => {
  h.findUnique.mockResolvedValue(null)
  expect(await ensureClientXeroContact('missing')).toBeNull()
  expect(h.ensureXeroContact).not.toHaveBeenCalled()
})

it('returns the cached contact id without calling Xero', async () => {
  h.findUnique.mockResolvedValue({ id: 'cp-1', xeroContactId: 'C-CACHED', trainer: { xeroConnection: connection } })
  expect(await ensureClientXeroContact('cp-1')).toBe('C-CACHED')
  expect(h.ensureXeroContact).not.toHaveBeenCalled()
  expect(h.update).not.toHaveBeenCalled()
})

it('returns null when the trainer has not connected Xero', async () => {
  h.findUnique.mockResolvedValue({
    id: 'cp-1', xeroContactId: null, phone: null,
    user: { name: 'Jo', email: 'jo@x.com' }, trainer: { xeroConnection: null },
  })
  expect(await ensureClientXeroContact('cp-1')).toBeNull()
  expect(h.ensureXeroContact).not.toHaveBeenCalled()
})

it('creates the contact and persists the id on first sync', async () => {
  h.findUnique.mockResolvedValue({
    id: 'cp-1', xeroContactId: null, phone: '021 555',
    user: { name: 'Jo Owner', email: 'jo@x.com' }, trainer: { xeroConnection: connection },
  })
  h.ensureXeroContact.mockResolvedValue('C-NEW')

  const id = await ensureClientXeroContact('cp-1')
  expect(id).toBe('C-NEW')
  expect(h.ensureXeroContact).toHaveBeenCalledWith(connection, { name: 'Jo Owner', email: 'jo@x.com', phone: '021 555' })
  expect(h.update).toHaveBeenCalledWith({ where: { id: 'cp-1' }, data: { xeroContactId: 'C-NEW' } })
})

it('falls back to email as the contact name when the user has no name', async () => {
  h.findUnique.mockResolvedValue({
    id: 'cp-2', xeroContactId: null, phone: null,
    user: { name: null, email: 'nameless@x.com' }, trainer: { xeroConnection: connection },
  })
  h.ensureXeroContact.mockResolvedValue('C-2')
  await ensureClientXeroContact('cp-2')
  expect(h.ensureXeroContact).toHaveBeenCalledWith(connection, expect.objectContaining({ name: 'nameless@x.com' }))
})
