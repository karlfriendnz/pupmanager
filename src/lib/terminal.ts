import type Stripe from 'stripe'
import { prisma } from './prisma'
import { stripeFor } from './stripe'
import { countryCodeFor, platformFeeAmount } from './connect'

// Stripe Terminal — Tap to Pay. The trainer holds their own phone out, the
// client taps a card or watch against it, done. No reader, no QR, no second
// device.
//
// This sits ON TOP of the Connect direct-charge model we already use for every
// other payment (see connect-checkout.ts): the trainer's connected account is
// the merchant, they bear Stripe's processing fee, and our 1% rides along as
// `application_fee_amount`. Everything here is therefore called with the
// `stripeAccount` option — a Terminal object created on the PLATFORM account is
// invisible to the trainer and cannot take their money.
//
// The one genuinely new idea is the LOCATION. Stripe requires in-person
// payments to be attached to a Terminal Location so it knows where the tap
// physically happened, and the location's `display_name` is what the cardholder
// reads on the tap screen. It belongs to the connected account for the same
// reason the charge does.
//
// What is deliberately NOT here: fulfilment. A Tap to Pay payment is an ordinary
// PaymentIntent carrying `metadata.paymentId`, so the existing Connect webhook
// (`payment_intent.succeeded`) marks the Payment paid and delivers the goods
// exactly as it does for a hosted-checkout payment. Adding a second fulfilment
// path here would be how the two drift apart.

/**
 * Countries where Stripe's Tap to Pay is generally available AND we sell.
 *
 * Cross-referenced against Stripe's own GA lists (docs.stripe.com/terminal/
 * payments/setup-reader/tap-to-pay, both platform variants, Aug 2026) and
 * narrowed to PupManager's six currencies. Stripe lists more countries than
 * this; the point of the intersection is that we only claim what we sell into.
 *
 * The odd one out is ZA. South Africa is not a Stripe Terminal country at all —
 * not "Tap to Pay isn't ready there", but "Stripe does not do in-person
 * payments there" — so a South African trainer can never be offered this and
 * the UI has to say so rather than fail at the tap.
 *
 * Stripe's public-preview countries are deliberately excluded: a preview country
 * can be withdrawn, and a trainer discovering that mid-sale in front of a paying
 * customer is worse than the button never appearing.
 */
export const TAP_TO_PAY_IOS_COUNTRIES: ReadonlySet<string> = new Set(['NZ', 'AU', 'GB', 'CA', 'US'])

/**
 * Android's GA list. Currently identical to iOS across our markets, but Stripe
 * maintains them as two separate lists and they have diverged before (ES and CZ
 * are GA on iOS and preview on Android today), so they stay two constants.
 */
export const TAP_TO_PAY_ANDROID_COUNTRIES: ReadonlySet<string> = new Set(['NZ', 'AU', 'GB', 'CA', 'US'])

export type TapToPayPlatform = 'ios' | 'android'

/** Is Tap to Pay available to a merchant in this country, on this platform? */
export function tapToPaySupported(country: string | null | undefined, platform: TapToPayPlatform): boolean {
  if (!country) return false
  const code = countryCodeFor(country)
  const set = platform === 'ios' ? TAP_TO_PAY_IOS_COUNTRIES : TAP_TO_PAY_ANDROID_COUNTRIES
  return set.has(code)
}

/** Available on EITHER platform — used for "should we show this at all" copy. */
export function tapToPayCountrySupported(country: string | null | undefined): boolean {
  return tapToPaySupported(country, 'ios') || tapToPaySupported(country, 'android')
}

/**
 * A short-lived token the Terminal SDK swaps for a session. The SDK asks for
 * this itself, repeatedly, and manages its own lifecycle — never cache one.
 *
 * The `stripeAccount` option is what makes the resulting reader session belong
 * to the trainer rather than to us. Without it the SDK would happily connect and
 * then take payments onto the PupManager platform account, which is both wrong
 * and very hard to notice.
 */
export async function createConnectionToken(input: {
  sandbox: boolean
  connectAccountId: string
  locationId: string
}): Promise<string> {
  const stripe = stripeFor(input.sandbox)
  const token = await stripe.terminal.connectionTokens.create(
    { location: input.locationId },
    { stripeAccount: input.connectAccountId },
  )
  return token.secret
}

/**
 * The merchant name the cardholder sees on the tap screen, and on the Location.
 * Stripe rejects an empty display_name, and "PupManager" would be a lie — the
 * client is paying the trainer, not us — so fall back to something neutral only
 * if a business somehow has no name.
 */
export function terminalDisplayName(businessName: string | null | undefined): string {
  const name = businessName?.trim()
  return name && name.length > 0 ? name.slice(0, 60) : 'Dog training'
}

/**
 * Find or create the trainer's Terminal Location, returning its id.
 *
 * Lazy on purpose: most trainers will never tap a card, and creating a Location
 * for all of them at onboarding would be thousands of Stripe objects nobody
 * uses. The id is cached on TrainerProfile so this is one API call ever.
 *
 * Stripe wants a real postal address. We use the business address the trainer
 * already gave us at billing setup; `country` falls back to signupCountry
 * because addressCountry is free text off the Google autocomplete field and is
 * frequently a display name ("United Kingdom ") rather than a code — the same
 * trap that stopped Mersea Mutts turning payments on at all.
 */
export async function ensureTerminalLocation(trainerId: string): Promise<string> {
  const trainer = await prisma.trainerProfile.findUnique({
    where: { id: trainerId },
    select: {
      terminalLocationId: true,
      connectAccountId: true,
      sandboxBilling: true,
      businessName: true,
      addressLine1: true,
      addressLine2: true,
      addressCity: true,
      addressRegion: true,
      addressPostcode: true,
      addressCountry: true,
      signupCountry: true,
    },
  })
  if (!trainer) throw new Error('Trainer not found')
  if (trainer.terminalLocationId) return trainer.terminalLocationId
  if (!trainer.connectAccountId) throw new Error('NOT_CONNECTED')

  const country = countryCodeFor(trainer.addressCountry, trainer.signupCountry)
  const stripe = stripeFor(trainer.sandboxBilling)

  const location = await stripe.terminal.locations.create(
    {
      display_name: terminalDisplayName(trainer.businessName),
      address: {
        // Stripe requires line1 + country. The rest is best-effort — a trainer
        // who never filled in their address still gets a working location
        // rather than a 400 in the middle of a sale.
        line1: trainer.addressLine1?.trim() || trainer.addressCity?.trim() || 'Not supplied',
        ...(trainer.addressLine2 ? { line2: trainer.addressLine2 } : {}),
        ...(trainer.addressCity ? { city: trainer.addressCity } : {}),
        ...(trainer.addressRegion ? { state: trainer.addressRegion } : {}),
        ...(trainer.addressPostcode ? { postal_code: trainer.addressPostcode } : {}),
        country,
      },
      metadata: { trainerId },
    },
    { stripeAccount: trainer.connectAccountId },
  )

  await prisma.trainerProfile.update({
    where: { id: trainerId },
    data: { terminalLocationId: location.id },
  })
  return location.id
}

/**
 * A one-time web link the trainer opens to accept APPLE's Tap to Pay terms.
 *
 * This is a genuine extra hop that has no equivalent anywhere else in our
 * payments: Apple — not Stripe, not us — requires every merchant to accept its
 * terms with a real Apple ID before their first tap. With Connect direct charges
 * that acceptance is per CONNECTED ACCOUNT, so our accepting it as a platform
 * does nothing for the trainer.
 *
 * Doing it on the web, ahead of time, is much kinder than the alternative, which
 * is Apple's terms sheet appearing over the top of a trainer who is mid-sale
 * with a customer waiting. Once accepted it never asks again, on any device.
 */
export async function createTapToPayOnboardingLink(input: {
  sandbox: boolean
  connectAccountId: string
  businessName: string | null | undefined
  /** Lets a trainer re-link if they change the Apple ID representing the business. */
  allowRelinking?: boolean
}): Promise<string> {
  const stripe = stripeFor(input.sandbox)
  const link = await stripe.terminal.onboardingLinks.create(
    {
      link_type: 'apple_terms_and_conditions',
      link_options: {
        apple_terms_and_conditions: {
          merchant_display_name: terminalDisplayName(input.businessName),
          ...(input.allowRelinking ? { allow_relinking: true } : {}),
        },
      },
    },
    { stripeAccount: input.connectAccountId },
  )
  return link.redirect_url
}

export interface CardPresentIntentInput {
  sandbox: boolean
  connectAccountId: string
  /** Minor units. */
  amount: number
  /** ISO 4217 lower-case. */
  currency: string
  /** Our Payment row id — the ONLY thing the webhook needs to fulfil. */
  paymentId: string
  /**
   * Our cut, in minor units, as already computed and STORED on the Payment row.
   *
   * Passed in rather than recomputed here on purpose. The number the trainer's
   * earnings list shows and the number Stripe transfers to us have to be the
   * same number, and the only way to guarantee that is for there to be one of
   * them. This repo has twice charged a real customer wrong by having two places
   * work out the same figure.
   */
  applicationFeeAmount: number
  description?: string | null
  metadata?: Record<string, string>
}

/**
 * The PaymentIntent the SDK collects against.
 *
 * Three choices worth defending:
 *
 * 1. `capture_method: 'manual'`. The tap authorises; we capture from the server
 *    once we've written the result down. If the app dies between tap and
 *    capture, the client is left with an authorisation that expires on its own
 *    in ~2 days rather than a charge for something they never got.
 * 2. Created SERVER-side, not with the SDK's `createPaymentIntent`. The client
 *    must not choose the amount or the application fee, and only the server can
 *    stamp `metadata.paymentId` against a Payment row it just wrote.
 * 3. `application_fee_amount` set here AND re-asserted at capture. Stripe's own
 *    Terminal guidance is to check the fee before capturing, because the
 *    captured amount can legitimately differ from the authorised one.
 *
 * Verified against a real Express connected account in the Stripe sandbox
 * (2026-08-02): a `card_present` intent created as a DIRECT charge on an Express
 * account, carrying `application_fee_amount`, is accepted. Express is not
 * restricted, which was the one open question that could have killed this.
 */
export async function createCardPresentPaymentIntent(
  input: CardPresentIntentInput,
): Promise<Stripe.PaymentIntent> {
  const stripe = stripeFor(input.sandbox)
  const fee = input.applicationFeeAmount
  return stripe.paymentIntents.create(
    {
      amount: input.amount,
      currency: input.currency,
      payment_method_types: ['card_present'],
      capture_method: 'manual',
      ...(input.description ? { description: input.description } : {}),
      // 0 is rejected by Stripe — omit the key when we take nothing.
      ...(fee > 0 ? { application_fee_amount: fee } : {}),
      metadata: { ...input.metadata, paymentId: input.paymentId },
    },
    { stripeAccount: input.connectAccountId },
  )
}

/**
 * Capture an authorised tap.
 *
 * The fee is recomputed from the amount Stripe actually authorised rather than
 * trusted from creation. A partial authorisation would otherwise leave us taking
 * 1% of a number the client never paid — small, but it is the client's money and
 * the trainer's reconciliation.
 */
export async function captureCardPresentPaymentIntent(input: {
  sandbox: boolean
  connectAccountId: string
  paymentIntentId: string
  currency: string
}): Promise<Stripe.PaymentIntent> {
  const stripe = stripeFor(input.sandbox)
  const intent = await stripe.paymentIntents.retrieve(
    input.paymentIntentId,
    {},
    { stripeAccount: input.connectAccountId },
  )
  const authorised = intent.amount_capturable || intent.amount
  const fee = platformFeeAmount(authorised, input.currency)
  return stripe.paymentIntents.capture(
    input.paymentIntentId,
    fee > 0 ? { application_fee_amount: fee } : {},
    { stripeAccount: input.connectAccountId },
  )
}
