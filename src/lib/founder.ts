// Founders Circle — the first FOUNDER_SEATS trainers to subscribe get a
// Stripe coupon that holds the founder rate for 12 months, then their
// subscription auto-reverts to standard pricing (the coupon's
// `duration_in_months` does the revert; there is no scheduled job).
//
// Two caps, deliberately:
//   1. This DB count gates whether checkout *offers* the founder price
//      and drives the "N of 10 left" copy. It counts only *completed*
//      founders (stamped by the Stripe webhook), so an abandoned
//      checkout never burns a seat.
//   2. The Stripe coupon's own `max_redemptions` is the hard ceiling.
//      Under the rare race where several people reach checkout with one
//      seat left, every session gets the coupon but only the first to
//      complete redeems it; the rest fail coupon-exhausted at Stripe.
//      Acceptable at founder volume (warm intros, low concurrency).
import { prisma } from './prisma'
import { env } from './env'

export const FOUNDER_SEATS = 10

/** True only when Karl has wired the founder coupon in Stripe + env. */
export function isFounderCouponConfigured(): boolean {
  return !!env.STRIPE_FOUNDER_COUPON_ID
}

/** Trainers who have actually claimed a founder seat (webhook-stamped). */
export function founderSeatsClaimed(): Promise<number> {
  return prisma.trainerProfile.count({ where: { isFounder: true } })
}

export async function founderSeatsRemaining(): Promise<number> {
  const claimed = await founderSeatsClaimed()
  return Math.max(0, FOUNDER_SEATS - claimed)
}

/**
 * Whether this trainer should be offered founder pricing at checkout.
 * Server-authoritative — never trust a `founder` flag from the client.
 * A trainer who already claimed a seat stays a founder (their existing
 * subscription keeps the coupon) but doesn't consume a second seat.
 */
export async function isFounderEligible(trainerIsFounder: boolean): Promise<boolean> {
  if (!isFounderCouponConfigured()) return false
  if (trainerIsFounder) return false
  return (await founderSeatsRemaining()) > 0
}
