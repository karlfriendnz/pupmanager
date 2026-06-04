import { prisma } from '@/lib/prisma'

export type PromoResult =
  | { ok: true; promo: { id: string; trialDays: number } }
  | { ok: false; reason: string }

// Looks up a promo code (case-insensitive) and checks it's redeemable right
// now: exists, active, not expired, and under its redemption cap. Returns the
// trial length to apply, or a human-readable reason it can't be used.
export async function validatePromoCode(raw: string): Promise<PromoResult> {
  const code = raw.trim().toUpperCase()
  if (!code) return { ok: false, reason: 'Enter a promo code.' }

  const promo = await prisma.promoCode.findUnique({ where: { code } })
  if (!promo || !promo.isActive) return { ok: false, reason: "That promo code isn't valid." }
  if (promo.expiresAt && promo.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'That promo code has expired.' }
  }
  if (promo.maxRedemptions != null && promo.redeemedCount >= promo.maxRedemptions) {
    return { ok: false, reason: 'That promo code has been fully redeemed.' }
  }
  return { ok: true, promo: { id: promo.id, trialDays: promo.trialDays } }
}
