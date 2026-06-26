import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/clients/email-bulk — bulk email a trainer's selected clients.
// Security/behaviour focus: permission + role gating, tenant scoping (can't
// reach another trainer's clients), the verified-sending-domain gate, recipient
// exclusion (sample / no-email / opted-out), the trial daily cap, and batching.
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  guardPermission: vi.fn(),
  scopeForMember: vi.fn(),
  trainerFindUnique: vi.fn(),
  clientFindMany: vi.fn(),
  recipientCount: vi.fn(),
  recipientCreateMany: vi.fn(),
  broadcastCreate: vi.fn(),
  messageCreateMany: vi.fn(),
  $transaction: vi.fn(),
  sendEmailBatch: vi.fn(),
  htmlHasText: vi.fn(),
  hasAddon: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission, scopeForMember: h.scopeForMember }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique },
    clientProfile: { findMany: h.clientFindMany },
    emailBroadcast: { create: h.broadcastCreate },
    emailBroadcastRecipient: { count: h.recipientCount, createMany: h.recipientCreateMany },
    message: { createMany: h.messageCreateMany },
    $transaction: h.$transaction,
  },
}))
vi.mock('@/lib/email', () => ({
  sendEmailBatch: h.sendEmailBatch,
  fromTrainerDomain: (name: string, addr: string) => `${name} <${addr}>`,
  fromTrainer: (name: string) => `${name} via PupManager`,
}))
vi.mock('@/lib/email-html', () => ({ htmlHasText: h.htmlHasText }))
vi.mock('@/lib/client-email', () => ({
  buildClientEmail: ({ subject }: { subject: string }) => ({ subject, html: '<h>', bodyHtml: '<b>', text: 't' }),
}))
vi.mock('@/lib/unsubscribe-token', () => ({ unsubscribeUrl: (id: string) => `https://app/unsubscribe/${id}` }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))

import { NextResponse } from 'next/server'
import { POST, TRIAL_DAILY_RECIPIENT_LIMIT } from '@/app/api/clients/email-bulk/route'

function grant(companyId = 'company-A') {
  h.guardPermission.mockResolvedValue({ companyId, userId: 'u1', membershipId: 'mem1', role: 'OWNER', permissions: {} })
}
function deny(status: number) {
  h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'x' }, { status }))
}
function req(body: unknown) {
  return new Request('https://app.pupmanager.com/api/clients/email-bulk', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function client(id: string, over: Partial<{ isSample: boolean; marketingEmailOptOut: boolean; email: string | null }> = {}) {
  return {
    id,
    isSample: over.isSample ?? false,
    marketingEmailOptOut: over.marketingEmailOptOut ?? false,
    user: { name: `Name ${id}`, email: over.email === undefined ? `${id}@x.test` : over.email },
    dog: { name: 'Rex' },
  }
}

const VERIFIED_TRAINER = {
  businessName: 'A', logoUrl: null, emailAccentColor: null,
  sendingFromEmail: 'hello@mail.a.com', domainVerifiedAt: new Date('2026-01-01'),
  useTrialSendingDomain: false,
  subscriptionStatus: 'ACTIVE', user: { name: 'Owner', email: 'owner@a.test' },
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.auth.mockResolvedValue({ user: { role: 'TRAINER', id: 'u1', trainerId: 'company-A' } })
  h.scopeForMember.mockReturnValue({})
  h.htmlHasText.mockReturnValue(true)
  h.hasAddon.mockResolvedValue(true)
  h.trainerFindUnique.mockResolvedValue({ ...VERIFIED_TRAINER })
  h.recipientCount.mockResolvedValue(0)
  h.broadcastCreate.mockResolvedValue({ id: 'broadcast-1' })
  h.recipientCreateMany.mockResolvedValue({ count: 1 })
  h.messageCreateMany.mockResolvedValue({ count: 1 })
  h.$transaction.mockResolvedValue([])
  // Each batch returns one Resend id per message, in order.
  h.sendEmailBatch.mockImplementation(async (msgs: unknown[]) => ({
    data: { data: msgs.map((_, i) => ({ id: `re-${i}` })) },
    error: null,
  }))
})

describe('authorisation', () => {
  it('blocks a member lacking messages.send (403)', async () => {
    deny(403)
    const res = await POST(req({ clientIds: ['c1'], subject: 's', body: 'b' }))
    expect(res.status).toBe(403)
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })

  it('rejects a non-trainer session even if the guard passed (401)', async () => {
    grant()
    h.auth.mockResolvedValue({ user: { role: 'CLIENT', id: 'c1' } })
    const res = await POST(req({ clientIds: ['c1'], subject: 's', body: 'b' }))
    expect(res.status).toBe(401)
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })

  it('blocks sending without the Marketing add-on (403 ADDON_REQUIRED)', async () => {
    grant()
    h.hasAddon.mockResolvedValue(false)
    const res = await POST(req({ clientIds: ['c1'], subject: 's', body: 'b' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADDON_REQUIRED')
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })
})

describe('sending-domain gate', () => {
  it('refuses to send until the domain is verified (403 DOMAIN_NOT_VERIFIED)', async () => {
    grant()
    h.trainerFindUnique.mockResolvedValue({ ...VERIFIED_TRAINER, domainVerifiedAt: null, sendingFromEmail: null })
    const res = await POST(req({ clientIds: ['c1'], subject: 's', body: 'b' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('DOMAIN_NOT_VERIFIED')
    expect(h.broadcastCreate).not.toHaveBeenCalled()
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })

  it('allows sending on the PupManager trial domain without a verified own domain', async () => {
    grant()
    h.trainerFindUnique.mockResolvedValue({
      ...VERIFIED_TRAINER, domainVerifiedAt: null, sendingFromEmail: null, useTrialSendingDomain: true,
    })
    h.clientFindMany.mockResolvedValue([client('a')])
    const res = await POST(req({ clientIds: ['a'], subject: 's', body: 'b' }))
    expect(res.status).toBe(201)
    expect((await res.json()).sent).toBe(1)
    // Sent via the shared "via PupManager" sender, not an own-domain From.
    expect(h.sendEmailBatch.mock.calls[0][0][0].from).toBe('Owner via PupManager')
  })
})

describe('tenant scoping', () => {
  it('queries clients scoped to the guarded company id, never a body value', async () => {
    grant('company-A')
    h.clientFindMany.mockResolvedValue([client('c1')])
    await POST(req({ clientIds: ['c1'], subject: 's', body: 'b', trainerId: 'company-EVIL' }))
    const where = h.clientFindMany.mock.calls[0][0].where
    expect(where.trainerId).toBe('company-A')
    expect(where.id).toEqual({ in: ['c1'] })
  })

  it('marks ids that do not resolve in this tenant as skipped NOT_FOUND', async () => {
    grant('company-A')
    // Only c1 belongs to company-A; c2 (another tenant) is not returned.
    h.clientFindMany.mockResolvedValue([client('c1')])
    const res = await POST(req({ clientIds: ['c1', 'c2'], subject: 's', body: 'b' }))
    const json = await res.json()
    expect(json.sent).toBe(1)
    expect(json.skipped).toContainEqual({ clientId: 'c2', reason: 'NOT_FOUND' })
  })

  it('applies the member visibility scope to the recipient query', async () => {
    grant('company-A')
    h.scopeForMember.mockReturnValue({ assignedMembershipId: 'mem1' })
    h.clientFindMany.mockResolvedValue([client('c1')])
    await POST(req({ clientIds: ['c1'], subject: 's', body: 'b' }))
    expect(h.clientFindMany.mock.calls[0][0].where.assignedMembershipId).toBe('mem1')
  })
})

describe('recipient exclusion', () => {
  it('skips sample, no-email and opted-out clients', async () => {
    grant()
    h.clientFindMany.mockResolvedValue([
      client('good'),
      client('sample', { isSample: true }),
      client('noemail', { email: null }),
      client('synthetic', { email: 'x@no-email.pupmanager.app' }),
      client('optout', { marketingEmailOptOut: true }),
    ])
    const res = await POST(req({ clientIds: ['good', 'sample', 'noemail', 'synthetic', 'optout'], subject: 's', body: 'b' }))
    const json = await res.json()
    expect(json.sent).toBe(1)
    expect(json.skipped).toEqual(expect.arrayContaining([
      { clientId: 'sample', reason: 'SAMPLE' },
      { clientId: 'noemail', reason: 'NO_EMAIL' },
      { clientId: 'synthetic', reason: 'NO_EMAIL' },
      { clientId: 'optout', reason: 'OPTED_OUT' },
    ]))
  })

  it('returns 422 when no eligible recipients remain', async () => {
    grant()
    h.clientFindMany.mockResolvedValue([client('optout', { marketingEmailOptOut: true })])
    const res = await POST(req({ clientIds: ['optout'], subject: 's', body: 'b' }))
    expect(res.status).toBe(422)
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })
})

describe('trial daily cap', () => {
  it('blocks a trial trainer over the 5/day cap (429 TRIAL_LIMIT) without sending', async () => {
    grant()
    h.trainerFindUnique.mockResolvedValue({ ...VERIFIED_TRAINER, subscriptionStatus: 'TRIALING' })
    h.recipientCount.mockResolvedValue(3) // already 3 today; only 2 left
    h.clientFindMany.mockResolvedValue([client('a'), client('b'), client('c')]) // wants 3
    const res = await POST(req({ clientIds: ['a', 'b', 'c'], subject: 's', body: 'b' }))
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.code).toBe('TRIAL_LIMIT')
    expect(json.limit).toBe(TRIAL_DAILY_RECIPIENT_LIMIT)
    expect(json.remaining).toBe(2)
    expect(h.broadcastCreate).not.toHaveBeenCalled()
    expect(h.sendEmailBatch).not.toHaveBeenCalled()
  })

  it('allows a trial trainer within the cap', async () => {
    grant()
    h.trainerFindUnique.mockResolvedValue({ ...VERIFIED_TRAINER, subscriptionStatus: 'TRIALING' })
    h.recipientCount.mockResolvedValue(0)
    h.clientFindMany.mockResolvedValue([client('a'), client('b')])
    const res = await POST(req({ clientIds: ['a', 'b'], subject: 's', body: 'b' }))
    expect(res.status).toBe(201)
    expect((await res.json()).sent).toBe(2)
  })
})

describe('batching & success', () => {
  it('sends in chunks of 100 and reports the total', async () => {
    grant()
    const many = Array.from({ length: 250 }, (_, i) => client(`c${i}`))
    h.clientFindMany.mockResolvedValue(many)
    const res = await POST(req({ clientIds: many.map(c => c.id), subject: 's', body: 'b' }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.sent).toBe(250)
    expect(json.broadcastId).toBe('broadcast-1')
    // 250 → 100 + 100 + 50 = three batch calls.
    expect(h.sendEmailBatch).toHaveBeenCalledTimes(3)
    expect(h.sendEmailBatch.mock.calls[0][0]).toHaveLength(100)
    expect(h.sendEmailBatch.mock.calls[2][0]).toHaveLength(50)
  })

  it('records failed recipients when a batch errors but still 201s', async () => {
    grant()
    h.clientFindMany.mockResolvedValue([client('a'), client('b')])
    h.sendEmailBatch.mockResolvedValue({ data: null, error: { message: 'resend down' } })
    const res = await POST(req({ clientIds: ['a', 'b'], subject: 's', body: 'b' }))
    expect(res.status).toBe(201)
    expect((await res.json()).sent).toBe(0)
    // The recipient rows are still persisted (as FAILED) via the transaction.
    expect(h.$transaction).toHaveBeenCalled()
  })
})
