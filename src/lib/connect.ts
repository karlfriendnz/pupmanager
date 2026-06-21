import type Stripe from 'stripe'
import { env } from './env'
import { stripeFor, isStripeConfigured } from './stripe'

// Flow B — client→trainer payments via Stripe Connect *Express*.
//
// This module owns the Connect-account lifecycle (create, hosted onboarding
// link, dashboard login link), the country→currency defaulting, and the
// platform-fee math. It deliberately reuses Flow A's dual-mode Stripe client
// (`stripeFor(sandbox)`): a trainer's `sandboxBilling` flag routes them to the
// same test/live key pair their subscription uses, so a demo trainer can run
// the whole payments flow in Stripe test mode.
//
// Charges themselves are *destination charges* on the platform account
// (transfer_data.destination = trainer's connected account, application_fee_amount
// = our cut). Stripe performs the split + payout; we only record the result.
// The Checkout builder + webhook fulfilment land in later phases — this is the
// Phase-0 foundation.

const APP_URL = env.NEXT_PUBLIC_APP_URL

// ISO 3166-1 alpha-2 → default payout currency (ISO 4217 lower-case, Stripe's
// convention). Covers PupManager's launch markets; anything else falls back to
// NZD (home market). A trainer can be re-pointed later, but their historical
// payments keep the currency stamped on each Payment row.
const COUNTRY_CURRENCY: Record<string, string> = {
  NZ: 'nzd',
  AU: 'aud',
  GB: 'gbp',
  CA: 'cad',
  US: 'usd',
  ZA: 'zar',
  IE: 'eur',
}

/** Default payout currency for a signup country (falls back to NZD). */
export function currencyForCountry(country?: string | null): string {
  if (!country) return 'nzd'
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? 'nzd'
}

/** Platform fee in basis points (env-configured; 500 = 5%). */
export function platformFeeBps(): number {
  return env.PLATFORM_FEE_BPS
}

/**
 * Platform fee (minor units) for a gross amount (minor units). This is the
 * `application_fee_amount` we hand Stripe on the destination charge — Stripe
 * deducts it and pays the trainer the remainder.
 */
export function platformFeeAmount(amountTotal: number): number {
  return Math.round((amountTotal * platformFeeBps()) / 10_000)
}

/** Is client→trainer payment configured for this mode? Same keys as Flow A. */
export function isConnectConfigured(sandbox = false): boolean {
  return isStripeConfigured(sandbox)
}

/**
 * Rollout gate: may this trainer onboard a LIVE Connect account / take LIVE
 * charges? Sandbox (test-mode) trainers like the demo are always allowed — they
 * can't move real money. Live trainers must be on the CONNECT_LIVE_ALLOWLIST.
 * Empty allowlist ⇒ only sandbox works, so production starts locked to the demo.
 */
export function isLivePaymentsAllowed(trainerId: string, sandbox: boolean): boolean {
  if (sandbox) return true
  const allow = (env.CONNECT_LIVE_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean)
  return allow.includes(trainerId)
}

// Estimated card processing fee, by payout currency, used to surcharge the
// client when a trainer opts to pass the fee on rather than absorb it. These
// mirror the platform processing-fee pricing set in the Stripe Dashboard
// (domestic-card assumption — a foreign card may differ slightly, in which case
// the trainer over/under-recovers by a few cents). { bps, fixed (minor units) }.
const SURCHARGE_RATES: Record<string, { bps: number; fixed: number }> = {
  nzd: { bps: 350, fixed: 30 },
  aud: { bps: 270, fixed: 30 },
  gbp: { bps: 250, fixed: 20 },
  eur: { bps: 250, fixed: 20 },
  usd: { bps: 390, fixed: 30 },
  cad: { bps: 390, fixed: 30 },
}
const SURCHARGE_DEFAULT = { bps: 390, fixed: 50 }

/**
 * Surcharge (minor units) to add on top of `amount` so that, after Stripe takes
 * its fee on the grossed-up total, the trainer nets the original `amount`.
 * Solves surcharge = (amount·r + fixed) / (1 − r) for the per-currency rate.
 */
export function estimateProcessingSurcharge(amount: number, currency: string): number {
  if (amount <= 0) return 0
  const { bps, fixed } = SURCHARGE_RATES[currency.toLowerCase()] ?? SURCHARGE_DEFAULT
  const r = bps / 10_000
  if (r >= 1) return 0
  return Math.round((amount * r + fixed) / (1 - r))
}

export interface CreateExpressAccountInput {
  sandbox: boolean
  trainerId: string
  email?: string | null
  /** ISO 3166-1 alpha-2; defaults to NZ. Fixes the account's home country. */
  country?: string | null
  businessType?: 'individual' | 'company'
}

/**
 * Create an Express connected account for a trainer. Requests the card_payments
 * + transfers capabilities (needed for destination charges). The account must
 * be created in the SAME Stripe mode the trainer transacts in — pass the
 * trainer's `sandboxBilling` as `sandbox`.
 */
export async function createExpressAccount(input: CreateExpressAccountInput): Promise<Stripe.Account> {
  const stripe = stripeFor(input.sandbox)
  return stripe.accounts.create({
    type: 'express',
    country: (input.country ?? 'NZ').toUpperCase(),
    email: input.email ?? undefined,
    business_type: input.businessType ?? 'individual',
    capabilities: {
      card_payments: { requested: true },
      transfers: { requested: true },
    },
    metadata: { trainerId: input.trainerId },
  })
}

/**
 * Hosted onboarding Account Link (Stripe-hosted KYC). Account Links are
 * single-use and short-lived; `refresh_url` re-mints a fresh one if the trainer
 * bounces, and `return_url` lands them back in Settings → Payments.
 */
export async function createOnboardingLink(accountId: string, sandbox: boolean): Promise<string> {
  const stripe = stripeFor(sandbox)
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${APP_URL}/api/connect/account/refresh`,
    return_url: `${APP_URL}/settings?tab=payments&onboarded=1`,
  })
  return link.url
}

/** Express dashboard login link (the trainer's payout/KYC self-service portal). */
export async function createLoginLink(accountId: string, sandbox: boolean): Promise<string> {
  const stripe = stripeFor(sandbox)
  const link = await stripe.accounts.createLoginLink(accountId)
  return link.url
}

/**
 * The enablement flags we mirror onto TrainerProfile from an Account object
 * (driven by the `account.updated` Connect webhook). `connectOnboardedAt` is
 * stamped by the caller the first time both charges + payouts flip true.
 */
export function readAccountFlags(account: Stripe.Account): {
  connectChargesEnabled: boolean
  connectPayoutsEnabled: boolean
  connectDetailsSubmitted: boolean
} {
  return {
    connectChargesEnabled: !!account.charges_enabled,
    connectPayoutsEnabled: !!account.payouts_enabled,
    connectDetailsSubmitted: !!account.details_submitted,
  }
}
