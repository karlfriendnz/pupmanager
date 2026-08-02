import { describe, it, expect, vi, beforeEach } from 'vitest'

// Tap to Pay — the four endpoints that can move real money on a trainer's
// connected account from a phone in a car park.
//
// Three things are load-bearing here, and each has a specific way of going
// wrong:
//
//   1. EVERY Stripe call carries `stripeAccount`. Without it the call succeeds
//      against the PLATFORM account — a connection token that lets a trainer
//      take payments into PupManager's own balance, and a charge nobody can
//      find. It fails silently and correctly-looking, which is the worst kind.
//   2. The AMOUNT is never taken from the request body. This endpoint charges a
//      card that is physically present; a client-supplied total would be a
//      free-money bug.
//   3. Cross-tenant ids are unreachable. An invoiceId or paymentId from another
//      business must miss in the WHERE clause, not be fetched and then checked.
const h = vi.hoisted(() => ({
  guardPermission: vi.fn(),
  hasAddon: vi.fn(),
  trainerFindUnique: vi.fn(),
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
  trainerUpdate: vi.fn(),
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

const NZ_TRAINER = {
  // Switched on for the rollout. Off is the default in the database and has its
  // own file (tap-to-pay-rollout-gate.test.ts); everything here is about what
  // happens once a business is past that gate.
  tapToPayEnabled: true,
  acceptPaymentsEnabled: true,
  connectChargesEnabled: true,
  connectAccountId: 'acct_trainer',
  terminalLocationId: 'tml_1',
  payoutCurrency: 'nzd',
  sandboxBilling: false,
  businessName: 'Mersea Mutts',
  addressCountry: 'New Zealand',
  signupCountry: 'NZ',
  addressLine1: '1 Queen St',
  addressLine2: null,
  addressCity: 'Auckland',
  addressRegion: null,
  addressPostcode: '1010',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.guardPermission.mockResolvedValue({ companyId: 'co_1', role: 'OWNER', permissions: null })
  h.hasAddon.mockResolvedValue(true)
  h.trainerFindUnique.mockResolvedValue(NZ_TRAINER)
  h.connectionTokensCreate.mockResolvedValue({ secret: 'pst_test_123' })
  h.locationsCreate.mockResolvedValue({ id: 'tml_new' })
  h.onboardingLinksCreate.mockResolvedValue({ redirect_url: 'https://register.apple.com/x' })
  h.paymentIntentsCreate.mockResolvedValue({ id: 'pi_1', client_secret: 'pi_1_secret' })
  h.paymentIntentsRetrieve.mockResolvedValue({ id: 'pi_1', amount: 5000, amount_capturable: 5000 })
  h.paymentIntentsCapture.mockResolvedValue({ id: 'pi_1', status: 'succeeded' })
  h.createPaymentRecord.mockResolvedValue('pay_1')
  h.paymentFindUniqueOrThrow.mockResolvedValue({ amountTotal: 5180, currency: 'nzd', applicationFeeAmount: 52 })
  h.paymentUpdate.mockResolvedValue({})
  h.trainerUpdate.mockResolvedValue({})
})

describe('every Stripe call is scoped to the connected account', () => {
  it('mints the connection token on the trainer, not the platform', async () => {
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(200)

    const [, options] = h.connectionTokensCreate.mock.calls[0]
    expect(
      options?.stripeAccount,
      'without stripeAccount the SDK takes payments into the PLATFORM balance',
    ).toBe('acct_trainer')
  })

  it('creates the Apple terms link on the trainer, not the platform', async () => {
    await onboardingLink(req('onboarding-link'))
    const [, options] = h.onboardingLinksCreate.mock.calls[0]
    expect(options?.stripeAccount).toBe('acct_trainer')
  })

  it('creates the PaymentIntent on the trainer, not the platform', async () => {
    await paymentIntent(req('payment-intent', {
      lines: [{ description: 'Treat pouch', quantity: 1, unitAmountCents: 5000 }],
    }))
    const [, options] = h.paymentIntentsCreate.mock.calls[0]
    expect(options?.stripeAccount).toBe('acct_trainer')
  })

  it('creates a lazily-made Location on the trainer, not the platform', async () => {
    h.trainerFindUnique.mockResolvedValue({ ...NZ_TRAINER, terminalLocationId: null })
    await connectionToken(req('connection-token'))
    const [, options] = h.locationsCreate.mock.calls[0]
    expect(options?.stripeAccount).toBe('acct_trainer')
  })
})

describe('the PaymentIntent itself', () => {
  it('is card_present and manually captured, so a crashed sale expires instead of charging', async () => {
    await paymentIntent(req('payment-intent', {
      lines: [{ description: 'Treat pouch', quantity: 1, unitAmountCents: 5000 }],
    }))
    const [params] = h.paymentIntentsCreate.mock.calls[0]
    expect(params.payment_method_types).toEqual(['card_present'])
    expect(params.capture_method).toBe('manual')
  })

  it('carries metadata.paymentId, which is the ONLY thing the webhook fulfils on', async () => {
    await paymentIntent(req('payment-intent', {
      lines: [{ description: 'Treat pouch', quantity: 1, unitAmountCents: 5000 }],
    }))
    const [params] = h.paymentIntentsCreate.mock.calls[0]
    expect(
      params.metadata?.paymentId,
      'without this the client is charged and never receives what they bought',
    ).toBe('pay_1')
  })

  it('charges the Payment row total, never a client-supplied amount', async () => {
    // The record includes a card-fee surcharge the request body knows nothing
    // about, so a route that echoed the body would undercharge by exactly the
    // surcharge on every single tap.
    await paymentIntent(req('payment-intent', {
      lines: [{ description: 'Treat pouch', quantity: 1, unitAmountCents: 5000 }],
    }))
    const [params] = h.paymentIntentsCreate.mock.calls[0]
    expect(params.amount).toBe(5180)
  })

  it('sends the fee the Payment row already recorded, not a second calculation', async () => {
    // The ledger number and the Stripe number have to be the same number. The
    // mock deliberately returns a fee that does NOT match a fresh 1% of the
    // total, so a route that recomputed instead of reading would show up here —
    // this repo has twice charged a real customer wrong by having two places
    // work out one figure.
    h.paymentFindUniqueOrThrow.mockResolvedValue({
      amountTotal: 5180, currency: 'nzd', applicationFeeAmount: 41,
    })
    await paymentIntent(req('payment-intent', {
      lines: [{ description: 'Treat pouch', quantity: 1, unitAmountCents: 5000 }],
    }))
    const [params] = h.paymentIntentsCreate.mock.calls[0]
    expect(params.application_fee_amount).toBe(41)
  })

  it('rejects both invoiceId and lines together', async () => {
    const res = await paymentIntent(req('payment-intent', {
      invoiceId: 'inv_1',
      lines: [{ description: 'x', quantity: 1, unitAmountCents: 100 }],
    }))
    expect(res.status).toBe(400)
  })
})

describe('cross-tenant reach', () => {
  it("cannot charge against another business's invoice", async () => {
    h.invoiceFindFirst.mockResolvedValue(null) // scoped WHERE misses
    const res = await paymentIntent(req('payment-intent', { invoiceId: 'inv_other' }))
    expect(res.status).toBe(404)
    expect(h.paymentIntentsCreate).not.toHaveBeenCalled()

    const where = h.invoiceFindFirst.mock.calls[0][0].where
    expect(where.trainerId, 'the tenant must be in the WHERE, not checked after').toBe('co_1')
  })

  it("cannot capture another business's payment", async () => {
    h.paymentFindFirst.mockResolvedValue(null)
    const res = await capture(req('capture', { paymentId: 'pay_other' }))
    expect(res.status).toBe(404)
    expect(h.paymentIntentsCapture).not.toHaveBeenCalled()

    const where = h.paymentFindFirst.mock.calls[0][0].where
    expect(where.trainerId).toBe('co_1')
  })

  it('captures the intent stored on OUR row, never one named by the caller', async () => {
    h.paymentFindFirst.mockResolvedValue({
      id: 'pay_1', stripePaymentIntentId: 'pi_ours', currency: 'nzd',
      status: 'PENDING', connectAccountId: 'acct_trainer',
    })
    await capture(req('capture', { paymentId: 'pay_1', paymentIntentId: 'pi_someone_elses' }))
    expect(h.paymentIntentsRetrieve.mock.calls[0][0]).toBe('pi_ours')
  })
})

describe('a trainer can only ever get a token for their OWN account', () => {
  // THE one that matters. A connection token is authority to take money on a
  // connected account from any phone holding it, so if any of these ever pass a
  // caller-supplied id through, one trainer can take payments into another
  // trainer's Stripe balance — or, with the platform account, into ours.

  it('looks the account up by the SESSION\'s company, never the body', async () => {
    await connectionToken(req('connection-token', {
      trainerId: 'co_someone_else',
      connectAccountId: 'acct_someone_else',
      companyId: 'co_someone_else',
    }))
    const where = h.trainerFindUnique.mock.calls[0][0].where
    expect(where.id, 'the tenant comes from guardPermission, not the request').toBe('co_1')
    expect(h.connectionTokensCreate.mock.calls[0][1]?.stripeAccount).toBe('acct_trainer')
  })

  it('mints Apple\'s terms link against the caller\'s own account only', async () => {
    await onboardingLink(req('onboarding-link', { connectAccountId: 'acct_someone_else' }))
    expect(h.trainerFindUnique.mock.calls[0][0].where.id).toBe('co_1')
    expect(h.onboardingLinksCreate.mock.calls[0][1]?.stripeAccount).toBe('acct_trainer')
  })

  it('records terms acceptance against the caller, not a named trainer', async () => {
    const res = await readerConnected(req('reader-connected', { trainerId: 'co_someone_else' }))
    expect(res.status).toBe(200)
    expect(h.trainerUpdate.mock.calls[0][0].where.id).toBe('co_1')
  })

  it('will not record acceptance for a business that cannot take payments at all', async () => {
    // Otherwise a South African trainer ends up flagged as Tap-to-Pay-ready in
    // their own settings for a feature they can never use.
    h.trainerFindUnique.mockResolvedValue({ ...NZ_TRAINER, addressCountry: 'South Africa', signupCountry: 'ZA' })
    const res = await readerConnected(req('reader-connected'))
    expect(res.status).toBe(409)
    expect(h.trainerUpdate).not.toHaveBeenCalled()
  })
})

describe('Apple\'s terms, which are the trainer\'s paperwork and not ours', () => {
  it('records that a link was minted, so settings can stop nagging mid-flow', async () => {
    await onboardingLink(req('onboarding-link'))
    const data = h.trainerUpdate.mock.calls[0][0].data
    expect(data.tapToPayTermsLinkedAt).toBeInstanceOf(Date)
    expect(
      data.tapToPayTermsAcceptedAt,
      'minting a link is not proof anybody accepted anything',
    ).toBeUndefined()
  })

  it('only a device that actually connected marks the terms accepted', async () => {
    await readerConnected(req('reader-connected'))
    const data = h.trainerUpdate.mock.calls[0][0].data
    expect(data.tapToPayTermsAcceptedAt).toBeInstanceOf(Date)
  })

  it('eligibility reports the terms separately from the reasons to hide the feature', async () => {
    h.trainerFindUnique.mockResolvedValue({
      ...NZ_TRAINER, tapToPayTermsLinkedAt: new Date(), tapToPayTermsAcceptedAt: null,
    })
    const body = await (await eligibility()).json()
    // Still eligible: outstanding terms are a step to show, not a reason to hide.
    expect(body.eligible).toBe(true)
    expect(body.terms).toEqual({ accepted: false, linked: true })
    expect(body.merchantName, 'the cardholder reads the TRAINER\'s name off the phone').toBe('Mersea Mutts')
  })
})

describe('the gate', () => {
  it('refuses a South African trainer — Stripe has no Terminal there at all', async () => {
    h.trainerFindUnique.mockResolvedValue({ ...NZ_TRAINER, addressCountry: 'South Africa', signupCountry: 'ZA' })
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('COUNTRY_UNSUPPORTED')
    expect(h.connectionTokensCreate).not.toHaveBeenCalled()
  })

  it('refuses without the pos add-on', async () => {
    h.hasAddon.mockResolvedValue(false)
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(403)
  })

  it('refuses before Stripe onboarding is finished', async () => {
    h.trainerFindUnique.mockResolvedValue({ ...NZ_TRAINER, connectChargesEnabled: false })
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('PAYMENTS_REQUIRED')
  })

  it('refuses a staff member without billing permission', async () => {
    const { NextResponse } = await import('next/server')
    h.guardPermission.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await connectionToken(req('connection-token'))
    expect(res.status).toBe(403)
  })
})

describe('eligibility, which renders a screen rather than refusing one', () => {
  it('reports the country problem ahead of the fixable ones', async () => {
    h.trainerFindUnique.mockResolvedValue({
      tapToPayEnabled: true,
      acceptPaymentsEnabled: false, connectChargesEnabled: false, connectAccountId: null,
      addressCountry: 'South Africa', signupCountry: 'ZA',
    })
    h.hasAddon.mockResolvedValue(false)
    const body = await (await eligibility()).json()
    expect(body.eligible).toBe(false)
    expect(
      body.reason,
      'telling a ZA trainer to finish Stripe setup sends them down a road that dead-ends',
    ).toBe('COUNTRY_UNSUPPORTED')
  })

  it('says yes for a fully set-up New Zealand trainer', async () => {
    const body = await (await eligibility()).json()
    expect(body.eligible).toBe(true)
    expect(body.platforms).toEqual({ ios: true, android: true })
  })
})
