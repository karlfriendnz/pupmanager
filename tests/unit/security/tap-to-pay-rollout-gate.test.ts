import { describe, it, expect, vi, beforeEach } from 'vitest'

// TrainerProfile.tapToPayEnabled — the rollout gate.
//
// Tap to Pay was merged onto main so ONE customer could be switched on, and the
// only gate it arrived with was the `pos` add-on. Every existing Instant-sale
// customer already holds `pos`, so on its own that gate switches the feature on
// for all of them at once — for a tap that cannot physically work until a
// native build carrying Apple's entitlement is in the stores.
//
// Hence this column, and hence this file. Three properties are load-bearing and
// each has a specific way of going wrong:
//
//   1. OFF REFUSES EVERY ROUTE, add-on or no add-on. Five endpoints can move
//      real money on a connected account; a gate that only covers four is not a
//      gate, and the missing one is always the one nobody looked at.
//   2. THE FLAG IS NEVER TAKEN FROM A REQUEST. It authorises taking a stranger's
//      card, so a body field that flipped it would be the whole feature handed
//      to anyone who could guess the key.
//   3. IT IS READ FROM THE CALLER'S OWN TENANT. A trainer id in the body must
//      not be able to borrow a switched-on business's answer.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  hasAddon: vi.fn(),
  trainerFindUnique: vi.fn(),
  trainerUpdate: vi.fn(),
  invoiceFindFirst: vi.fn(),
  paymentFindFirst: vi.fn(),
  paymentFindUniqueOrThrow: vi.fn(),
  paymentUpdate: vi.fn(),
  createPaymentRecord: vi.fn(),
  connectionTokensCreate: vi.fn(),
  locationsCreate: vi.fn(),
  onboardingLinksCreate: vi.fn(),
  paymentIntentsCreate: vi.fn(),
  paymentIntentsRetrieve: vi.fn(),
  paymentIntentsCapture: vi.fn(),
}))

vi.mock('@/lib/membership', () => ({ guardPermission: h.guardPermission }))
vi.mock('@/lib/billing', () => ({ hasAddon: h.hasAddon }))
vi.mock('@/lib/csrf', () => ({ requireSameOrigin: () => null }))
vi.mock('@/lib/connect-checkout', () => ({ createPaymentRecord: h.createPaymentRecord }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    trainerProfile: { findUnique: h.trainerFindUnique, update: h.trainerUpdate },
    invoice: { findFirst: h.invoiceFindFirst },
    payment: {
      findFirst: h.paymentFindFirst,
      findUniqueOrThrow: h.paymentFindUniqueOrThrow,
      update: h.paymentUpdate,
    },
  },
}))
vi.mock('@/lib/stripe', () => ({
  isStripeConfigured: () => true,
  stripeFor: () => ({
    terminal: {
      connectionTokens: { create: h.connectionTokensCreate },
      locations: { create: h.locationsCreate },
      onboardingLinks: { create: h.onboardingLinksCreate },
    },
    paymentIntents: {
      create: h.paymentIntentsCreate,
      retrieve: h.paymentIntentsRetrieve,
      capture: h.paymentIntentsCapture,
    },
  }),
}))

import { POST as connectionToken } from '@/app/api/terminal/connection-token/route'
import { POST as onboardingLink } from '@/app/api/terminal/onboarding-link/route'
import { POST as paymentIntent } from '@/app/api/terminal/payment-intent/route'
import { POST as capture } from '@/app/api/terminal/capture/route'
import { POST as readerConnected } from '@/app/api/terminal/reader-connected/route'
import { GET as eligibility } from '@/app/api/terminal/eligibility/route'

const req = (path: string, body: unknown = {}) =>
  new Request(`https://app.pupmanager.com/api/terminal/${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

/** A business that is set up in every OTHER way — the point being the flag. */
const READY_TRAINER = {
  acceptPaymentsEnabled: true,
  connectChargesEnabled: true,
  connectAccountId: 'acct_trainer',
  terminalLocationId: 'tml_1',
  payoutCurrency: 'nzd',
  sandboxBilling: false,
  businessName: 'Paws & Thrive',
  addressCountry: 'New Zealand',
  signupCountry: 'NZ',
  tapToPayTermsLinkedAt: null,
  tapToPayTermsAcceptedAt: null,
}

const OFF = { ...READY_TRAINER, tapToPayEnabled: false }
const ON = { ...READY_TRAINER, tapToPayEnabled: true }

// Every endpoint that can act, with a body that would otherwise succeed. If a
// new terminal route is added and not listed here, that is the one to worry
// about — it is also why this is a table rather than five copied tests.
const ROUTES: [string, (r: Request) => Promise<Response>, unknown][] = [
  ['connection-token', connectionToken, {}],
  ['onboarding-link', onboardingLink, {}],
  ['payment-intent', paymentIntent, { lines: [{ description: 'Treat pouch', quantity: 1, unitAmountCents: 5000 }] }],
  ['capture', capture, { paymentId: 'pay_1' }],
  ['reader-connected', readerConnected, {}],
]

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  // The add-on is ON throughout this file. That is the whole point: `pos` is
  // what the trainer bought, and it is not the question this column answers.
  h.hasAddon.mockResolvedValue(true)
  h.trainerFindUnique.mockResolvedValue(OFF)
  h.connectionTokensCreate.mockResolvedValue({ secret: 'pst_test_123' })
  h.locationsCreate.mockResolvedValue({ id: 'tml_new' })
  h.onboardingLinksCreate.mockResolvedValue({ redirect_url: 'https://register.apple.com/x' })
  h.paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' })
  h.paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_1', amount: 5000, amount_capturable: 5000 })
  h.paymentIntentsCapture.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })
  h.createPaymentRecord.mockResolvedValue('pay_1')
  h.paymentFindFirst.mockResolvedValue({
    id: 'pay_1', stripePaymentIntentId: 'pi_ours', currency: 'nzd',
    status: 'PENDING', connectAccountId: 'acct_trainer',
  })
  h.paymentFindUniqueOrThrow.mockResolvedValue({ amountTotal: 5000, currency: 'nzd', applicationFeeAmount: 50 })
  h.paymentUpdate.mockResolvedValue({})
  h.trainerUpdate.mockResolvedValue({})
})

describe('a trainer who is not switched on is refused everywhere', () => {
  for (const [name, handler, body] of ROUTES) {
    it(`${name} refuses with NOT_ENABLED even though the pos add-on is on`, async () => {
      const res = await handler(req(name, body))
      expect(res.status).toBe(403)
      expect((await res.json()).error).toBe('NOT_ENABLED')
    })
  }

  it('reaches Stripe on none of them — no token, no intent, no capture, no link', async () => {
    for (const [name, handler, body] of ROUTES) await handler(req(name, body))
    expect(h.connectionTokensCreate).not.toHaveBeenCalled()
    expect(h.onboardingLinksCreate).not.toHaveBeenCalled()
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled()
    expect(h.paymentIntentsCapture).not.toHaveBeenCalled()
  })

  it('writes nothing — a refused trainer must not end up flagged as terms-accepted', async () => {
    for (const [name, handler, body] of ROUTES) await handler(req(name, body))
    expect(h.trainerUpdate).not.toHaveBeenCalled()
    expect(h.createPaymentRecord).not.toHaveBeenCalled()
  })

  it('is asked BEFORE the add-on, so nobody is sent to buy something that would not help', async () => {
    h.hasAddon.mockResolvedValue(false)
    const res = await connectionToken(req('connection-token'))
    expect((await res.json()).error).toBe('NOT_ENABLED')
    expect(h.hasAddon, 'the add-on question is never even asked').not.toHaveBeenCalled()
  })

  it('lets the same trainer straight through once the flag is on', async () => {
    // The mirror image of the table above: same session, same add-on, same
    // Stripe state, one column different. If this passes and the refusals pass,
    // the flag is the only thing doing the work.
    h.trainerFindUnique.mockResolvedValue(ON)
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(200)
    expect(h.connectionTokensCreate.mock.calls[0][1]?.stripeAccount).toBe('acct_trainer')
  })
})

describe('the flag cannot be set, spoofed or borrowed from a request', () => {
  it('ignores a body claiming the feature is enabled', async () => {
    const res = await connectionToken(req('connection-token', {
      tapToPayEnabled: true,
      enabled: true,
      trainer: { tapToPayEnabled: true },
    }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('NOT_ENABLED')
  })

  it('never writes the flag from a terminal route — these endpoints only read it', async () => {
    h.trainerFindUnique.mockResolvedValue(ON)
    for (const [name, handler] of ROUTES) {
      await handler(req(name, { tapToPayEnabled: true, ...(name === 'capture' ? { paymentId: 'pay_1' } : {}), ...(name === 'payment-intent' ? { lines: [{ description: 'x', quantity: 1, unitAmountCents: 100 }] } : {}) }))
    }
    for (const call of h.trainerUpdate.mock.calls) {
      expect(
        call[0].data,
        'only the Super Admin route may move this column',
      ).not.toHaveProperty('tapToPayEnabled')
    }
  })

  it('reads the flag off the CALLER\'s tenant, not a trainer id in the body', async () => {
    await connectionToken(req('connection-token', {
      trainerId: 'co_switched_on',
      companyId: 'co_switched_on',
      connectAccountId: 'acct_someone_else',
    }))
    const where = h.trainerFindUnique.mock.calls[0][0].where
    expect(where.id, 'the tenant comes from guardPermission, never the request').toBe('co_1')
    const select = h.trainerFindUnique.mock.calls[0][0].select
    expect(select.tapToPayEnabled, 'the gate has to be read to be checked').toBe(true)
  })

  it('refuses a staff member without billing permission before the flag matters', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    h.trainerFindUnique.mockResolvedValue(ON)
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(403)
    expect(h.trainerFindUnique).not.toHaveBeenCalled()
  })
})

describe('what the trainer is told, which is nothing', () => {
  it('eligibility answers NOT_ENABLED and outranks every other reason', async () => {
    // A business that is ALSO in an unsupported country and has no payments set
    // up. Our own switch is still the answer, because the others describe
    // things about their business and this one describes a decision of ours.
    h.trainerFindUnique.mockResolvedValue({
      ...OFF, addressCountry: 'South Africa', signupCountry: 'ZA',
      acceptPaymentsEnabled: false, connectChargesEnabled: false, connectAccountId: null,
    })
    h.hasAddon.mockResolvedValue(false)
    const body = await (await eligibility()).json()
    expect(body.eligible).toBe(false)
    expect(body.reason).toBe('NOT_ENABLED')
  })

  it('goes back to the ordinary reasons the moment the flag is on', async () => {
    h.trainerFindUnique.mockResolvedValue({
      ...ON, addressCountry: 'South Africa', signupCountry: 'ZA',
    })
    const body = await (await eligibility()).json()
    expect(body.reason).toBe('COUNTRY_UNSUPPORTED')
  })

  it('says yes for a switched-on, fully set-up New Zealand business', async () => {
    h.trainerFindUnique.mockResolvedValue(ON)
    const body = await (await eligibility()).json()
    expect(body.eligible).toBe(true)
    expect(body.reason).toBeNull()
  })
})
