import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { guardPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { countryCodeFor } from '@/lib/connect'
import { tapToPaySupported, tapToPayCountrySupported } from '@/lib/terminal'

// "Should the Tap to Pay row appear, and if not, what do I tell them?"
//
// Read-only and deliberately NOT built on guardTapToPay: that guard's job is to
// refuse, and a refusal is a bad way to render a screen. The sale composer needs
// to know the reason before the trainer taps anything, so it can show the right
// one sentence — "not available in South Africa" and "finish your Stripe setup"
// are very different problems and only one of them is fixable by the trainer
// today.
//
// The UI must ALSO check it is running natively (Capacitor) and that the plugin
// reports a capable device. This endpoint can't know either — it only speaks for
// the business, not the phone in the trainer's hand.

export async function GET() {
  const ctx = await guardPermission('billing.view')
  if (ctx instanceof NextResponse) return ctx

  const [addon, trainer] = await Promise.all([
    hasAddon(ctx.companyId, 'pos'),
    prisma.trainerProfile.findUnique({
      where: { id: ctx.companyId },
      select: {
        acceptPaymentsEnabled: true,
        connectChargesEnabled: true,
        connectAccountId: true,
        addressCountry: true,
        signupCountry: true,
      },
    }),
  ])

  const country = countryCodeFor(trainer?.addressCountry, trainer?.signupCountry)
  const paymentsReady = !!(
    trainer?.acceptPaymentsEnabled && trainer.connectChargesEnabled && trainer.connectAccountId
  )

  // First failing condition wins, ordered by what the trainer can act on: a
  // South African trainer should not be told to finish a Stripe setup that
  // would still leave the feature unavailable.
  const reason = !tapToPayCountrySupported(country)
    ? 'COUNTRY_UNSUPPORTED'
    : !addon
      ? 'ADDON_REQUIRED'
      : !paymentsReady
        ? 'PAYMENTS_REQUIRED'
        : null

  return NextResponse.json({
    eligible: reason === null,
    reason,
    country,
    platforms: {
      ios: tapToPaySupported(country, 'ios'),
      android: tapToPaySupported(country, 'android'),
    },
  })
}
