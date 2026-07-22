import { describe, it, expect, vi, beforeEach } from 'vitest'

// Stripe fires customer.subscription.updated repeatedly and retries webhooks,
// so the team must be told exactly ONCE per business — never a stream of
// duplicate "they converted!" emails.
const { mockUpdateMany, mockFindUnique, mockSendEmail } = vi.hoisted(() => ({
  mockUpdateMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockSendEmail: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { trainerProfile: { updateMany: mockUpdateMany, findUnique: mockFindUnique } },
}))
vi.mock('@/lib/email', () => ({ sendEmail: mockSendEmail }))

import { notifyConversion } from '@/lib/conversion-alert'

const PROFILE = {
  businessName: 'Journey Dog Training',
  payoutCurrency: 'nzd',
  seatCount: 3,
  signupCountry: 'NZ',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  subscriptionPlan: { name: 'Core software', priceMonthly: 43 },
  user: { name: 'Sarah Endres', email: 'sarah@journey.co.nz' },
  _count: { clients: 380 },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdateMany.mockResolvedValue({ count: 1 })
  mockFindUnique.mockResolvedValue(PROFILE)
  mockSendEmail.mockResolvedValue({ error: null })
})

describe('notifyConversion', () => {
  it('emails both internal addresses', async () => {
    await notifyConversion('tr_1')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    const arg = mockSendEmail.mock.calls[0][0]
    expect(arg.to).toEqual(['info@pupmanager.com', 'brooke@pupmanager.com'])
    expect(arg.subject).toContain('Journey Dog Training')
    expect(arg.subject).toContain('NZD')
  })

  it('includes the details worth knowing', async () => {
    await notifyConversion('tr_1')
    const html = mockSendEmail.mock.calls[0][0].html
    expect(html).toContain('Journey Dog Training')
    expect(html).toContain('sarah@journey.co.nz')
    expect(html).toContain('380')       // client count
    expect(html).toContain('days to convert')
  })

  // The guard: the claim is a conditional write, so a second caller loses.
  it('claims the conversion with convertedAt: null in the WHERE', async () => {
    await notifyConversion('tr_1')
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { id: 'tr_1', convertedAt: null },
      data: { convertedAt: expect.any(Date) },
    })
  })

  it('sends nothing when the conversion was already announced', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })
    await notifyConversion('tr_1')
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  // A flaky Resend must not make us 500 at Stripe — that just triggers more
  // retries of the very webhook we're handling.
  it('swallows a send failure instead of throwing', async () => {
    mockSendEmail.mockRejectedValue(new Error('Resend down'))
    await expect(notifyConversion('tr_1')).resolves.toBeUndefined()
  })

  it('survives the profile vanishing between claim and read', async () => {
    mockFindUnique.mockResolvedValue(null)
    await expect(notifyConversion('tr_1')).resolves.toBeUndefined()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
