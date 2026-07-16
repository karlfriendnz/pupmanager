import { describe, it, expect, vi, beforeEach } from 'vitest'

// getActiveClientInvoices() — the data source behind the client's /my-invoices
// page. A dog owner can work with SEVERAL trainers (one ClientProfile per
// trainer), so the guard has two halves: the invoice must belong to THEIR
// profile, and to the trainer that profile belongs to. Neither id may come from
// the request. These tests pin both.
const h = vi.hoisted(() => ({
  env: { PLATFORM_FEE_BPS: 0, NEXT_PUBLIC_APP_URL: 'https://app.test' },
  getActiveClient: vi.fn(),
  profileFindUnique: vi.fn(),
  invoiceFindMany: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ env: h.env }))
vi.mock('@/lib/client-context', () => ({ getActiveClient: h.getActiveClient }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    clientProfile: { findUnique: h.profileFindUnique },
    invoice: { findMany: h.invoiceFindMany },
  },
}))

import { getActiveClientInvoices } from '@/lib/client-invoices'

const TRAINER_A = 'trainer-a'
const TRAINER_B = 'trainer-b'
const MY_PROFILE = 'client-profile-with-trainer-a'

function trainerFlags() {
  return {
    businessName: 'Happy Paws',
    acceptPaymentsEnabled: true,
    connectChargesEnabled: true,
    passProcessingFeeToClient: false,
    payoutCurrency: 'nzd',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.getActiveClient.mockResolvedValue({
    clientId: MY_PROFILE, userId: 'user-1', isPreview: false, actualUserId: 'user-1',
  })
  h.profileFindUnique.mockResolvedValue({ id: MY_PROFILE, trainerId: TRAINER_A, trainer: trainerFlags() })
  h.invoiceFindMany.mockResolvedValue([])
})

describe('client invoices — cross-tenant guard', () => {
  it('returns null (→ /login) when there is no active client', async () => {
    h.getActiveClient.mockResolvedValue(null)
    expect(await getActiveClientInvoices()).toBeNull()
    expect(h.invoiceFindMany).not.toHaveBeenCalled()
  })

  it('scopes the query by BOTH the client’s own profile id AND the active trainer', async () => {
    await getActiveClientInvoices()
    const where = h.invoiceFindMany.mock.calls[0][0].where
    expect(where).toEqual({ clientId: MY_PROFILE, trainerId: TRAINER_A })
  })

  it('takes the client id from the session, never from a caller-supplied id', async () => {
    // getActiveClient validates the active-trainer cookie against the signed-in
    // user's own profiles, so an attacker swapping the cookie to someone else's
    // profile id gets null back — and we must not query with it.
    await getActiveClientInvoices()
    expect(h.profileFindUnique.mock.calls[0][0].where).toEqual({ id: MY_PROFILE })
    // Whatever the DB was asked for, it was asked with the session's client id.
    expect(h.invoiceFindMany.mock.calls[0][0].where.clientId).toBe(MY_PROFILE)
    expect(h.invoiceFindMany.mock.calls[0][0].where.clientId).not.toBe('someone-elses-profile')
  })

  it('follows the ACTIVE trainer when the client switches trainers', async () => {
    // Same human, different ClientProfile (their relationship with trainer B).
    const otherProfile = 'client-profile-with-trainer-b'
    h.getActiveClient.mockResolvedValue({
      clientId: otherProfile, userId: 'user-1', isPreview: false, actualUserId: 'user-1',
    })
    h.profileFindUnique.mockResolvedValue({ id: otherProfile, trainerId: TRAINER_B, trainer: trainerFlags() })

    await getActiveClientInvoices()
    expect(h.invoiceFindMany.mock.calls[0][0].where).toEqual({ clientId: otherProfile, trainerId: TRAINER_B })
    // Trainer A's invoices are out of scope while B is the active trainer.
    expect(h.invoiceFindMany.mock.calls[0][0].where.trainerId).not.toBe(TRAINER_A)
  })

  it('returns null when the active profile no longer exists (deleted relationship)', async () => {
    h.profileFindUnique.mockResolvedValue(null)
    expect(await getActiveClientInvoices()).toBeNull()
    expect(h.invoiceFindMany).not.toHaveBeenCalled()
  })

  it('never offers a card CTA when the trainer can’t take cards', async () => {
    h.profileFindUnique.mockResolvedValue({
      id: MY_PROFILE, trainerId: TRAINER_A,
      trainer: { ...trainerFlags(), connectChargesEnabled: false },
    })
    h.invoiceFindMany.mockResolvedValue([{
      id: 'i1', description: 'Course', amountCents: 1000, amountPaidCents: 0, currency: 'nzd',
      status: 'UNPAID', sentAt: new Date(), paidAt: null, createdAt: new Date(), payToken: 'tok',
      lines: [],
    }])
    const data = await getActiveClientInvoices()
    expect(data!.summary.outstanding[0].canPayOnline).toBe(false)
    expect(data!.summary.outstanding[0].surchargeCents).toBe(0)
  })
})
