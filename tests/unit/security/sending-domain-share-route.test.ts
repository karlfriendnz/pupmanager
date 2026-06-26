import { describe, it, expect, vi, beforeEach } from 'vitest'

// POST /api/trainer/sending-domain/share — email the DNS records to a developer.
// Focus: permission gating, validation, requires a domain + records, and that
// the send targets the given address with the trainer as Reply-To.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  trainerFindUnique: vi.fn(),
  domainsGet: vi.fn(),
  sendEmail: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/prisma', () => ({ prisma: { trainerProfile: { findUnique: h.trainerFindUnique } } }))
vi.mock('@/lib/email', () => ({
  resendClient: () => ({ domains: { get: h.domainsGet } }),
  sendEmail: h.sendEmail,
  fromTrainer: (n: string) => `${n} via PupManager`,
}))
vi.mock('@/lib/enquiries', () => ({ escapeHtml: (s: string) => s }))

import { NextResponse } from 'next/server'
import { POST } from '@/app/api/trainer/sending-domain/share/route'

function grant(companyId = 'company-A') {
  h.guardPermission.mockResolvedValue({ companyId, userId: 'u1', membershipId: 'm1', role: 'OWNER', permissions: {} })
}
function req(body: unknown) {
  return new Request('https://app.pupmanager.com/api/trainer/sending-domain/share', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

const TRAINER = {
  businessName: 'Paws', sendingDomain: 'mail.paws.com', resendDomainId: 'dom_1',
  user: { name: 'Jess', email: 'jess@paws.com' },
}

beforeEach(() => {
  Object.values(h).forEach(fn => fn.mockReset())
  h.trainerFindUnique.mockResolvedValue({ ...TRAINER })
  h.domainsGet.mockResolvedValue({ data: { records: [{ type: 'TXT', name: 'mail._dk', value: 'p=abc' }] } })
  h.sendEmail.mockResolvedValue({ data: { id: 'e1' }, error: null })
})

it('blocks a member without settings.edit', async () => {
  h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 403 }))
  const res = await POST(req({ email: 'dev@x.test' }))
  expect(res.status).toBe(403)
  expect(h.sendEmail).not.toHaveBeenCalled()
})

it('rejects an invalid email', async () => {
  grant()
  const res = await POST(req({ email: 'not-an-email' }))
  expect(res.status).toBe(400)
  expect(h.sendEmail).not.toHaveBeenCalled()
})

it('400s when no sending domain is set up', async () => {
  grant()
  h.trainerFindUnique.mockResolvedValue({ ...TRAINER, resendDomainId: null, sendingDomain: null })
  const res = await POST(req({ email: 'dev@x.test' }))
  expect(res.status).toBe(400)
  expect((await res.json()).code).toBe('NO_DOMAIN')
})

it('422s when Resend returns no records', async () => {
  grant()
  h.domainsGet.mockResolvedValue({ data: { records: [] } })
  const res = await POST(req({ email: 'dev@x.test' }))
  expect(res.status).toBe(422)
  expect(h.sendEmail).not.toHaveBeenCalled()
})

it('emails the records to the developer with the trainer as reply-to', async () => {
  grant()
  const res = await POST(req({ email: 'dev@agency.test' }))
  expect(res.status).toBe(200)
  expect(h.sendEmail).toHaveBeenCalledTimes(1)
  const arg = h.sendEmail.mock.calls[0][0]
  expect(arg.to).toBe('dev@agency.test')
  expect(arg.replyTo).toBe('jess@paws.com')
  expect(arg.html).toContain('mail._dk') // record name present
  expect(arg.subject).toMatch(/Paws/)
})
