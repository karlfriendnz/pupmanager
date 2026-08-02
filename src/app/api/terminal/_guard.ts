import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { isConnectConfigured, countryCodeFor } from '@/lib/connect'
import { tapToPayCountrySupported } from '@/lib/terminal'

// One gate, four routes. Every Tap to Pay endpoint has to answer the same
// question — "is this staff member, in this business, in this country, allowed
// to take a card right now?" — and a copy of that per route is how one of them
// ends up missing the country check and 500s in front of a paying customer.
//
// Deliberately the SAME permission and add-on as the guest sale
// (`billing.view` + `pos`): Tap to Pay is a way of taking an in-person payment,
// not a new product. A trainer who can already take a payment by QR should not
// have to buy anything else to take the same payment by tap.
//
// On top of that sits one gate the add-on cannot express:
// TrainerProfile.tapToPayEnabled, our rollout switch. Every Instant-sale
// customer already holds `pos`, so without this column merging the feature
// would have switched it on for all of them at once. It is checked FIRST,
// before the add-on and before the country, because it is the only "no" that is
// ours rather than theirs — there is nothing for a trainer to fix and nothing
// worth telling them.

export interface TapToPayTrainer {
  trainerId: string
  connectAccountId: string
  sandbox: boolean
  currency: string
  businessName: string | null
  country: string
  terminalLocationId: string | null
}

/**
 * Returns the trainer's payment context, or a ready-to-return error response.
 *
 * The failure codes are machine-readable on purpose: the composer has to tell a
 * trainer WHICH thing is missing ("finish Stripe setup" vs "not available in
 * South Africa" vs "turn payments on"), and those are very different sentences.
 */
export async function guardTapToPay(): Promise<TapToPayTrainer | NextResponse> {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  // The tenant is `ctx.companyId` — the caller's own session — and never a
  // trainer id from the request. Every route below reads its switch off THIS
  // row, so there is no body a caller could send to be someone who is switched
  // on.
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: {
      tapToPayEnabled: true,
      acceptPaymentsEnabled: true,
      connectChargesEnabled: true,
      connectAccountId: true,
      terminalLocationId: true,
      payoutCurrency: true,
      sandboxBilling: true,
      businessName: true,
      addressCountry: true,
      signupCountry: true,
    },
  })
  if (!trainer) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Not switched on for this business. Answered before the add-on so a trainer
  // we have not rolled out to is never told to go and buy something that would
  // still leave them here.
  if (!trainer.tapToPayEnabled) {
    return NextResponse.json({ error: 'NOT_ENABLED' }, { status: 403 })
  }

  if (!(await hasAddon(ctx.companyId, 'pos'))) {
    return NextResponse.json({ error: 'ADDON_REQUIRED' }, { status: 403 })
  }

  if (!trainer.acceptPaymentsEnabled || !trainer.connectChargesEnabled || !trainer.connectAccountId) {
    return NextResponse.json({ error: 'PAYMENTS_REQUIRED' }, { status: 409 })
  }

  // Country is checked server-side even though the UI hides the button, because
  // the UI runs on the trainer's phone and the money does not.
  const country = countryCodeFor(trainer.addressCountry, trainer.signupCountry)
  if (!tapToPayCountrySupported(country)) {
    return NextResponse.json({ error: 'COUNTRY_UNSUPPORTED', country }, { status: 409 })
  }

  if (!isConnectConfigured(trainer.sandboxBilling)) {
    return NextResponse.json({ error: 'Payments are not configured yet' }, { status: 503 })
  }

  return {
    trainerId: ctx.companyId,
    connectAccountId: trainer.connectAccountId,
    sandbox: trainer.sandboxBilling,
    currency: trainer.payoutCurrency ?? 'nzd',
    businessName: trainer.businessName,
    country,
    terminalLocationId: trainer.terminalLocationId,
  }
}
