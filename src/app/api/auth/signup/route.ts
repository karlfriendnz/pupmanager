import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/auth-emails'
import { notifyNewTrainerSignup } from '@/lib/notify-new-trainer'
import { validatePromoCode } from '@/lib/promo'

const TRIAL_DAYS = 10

// /api/auth/signup — handles the marketing-driven signup flow:
// formal info capture + seat-count slider + Stripe handoff. The legacy
// /api/auth/register is still wired up for the older /register form
// (no slider, no Stripe step) and unaffected.
//
// Flow:
//   1. Validate input + ensure email is unused
//   2. Provision User + TrainerProfile in TRIALING with the requested
//      seat count and a 10-day trialEndsAt
//   3. Email a 6-digit verification code (login still requires it)
//   4. If Stripe is configured AND the chosen plan has a stripePriceId,
//      create a Customer + Checkout Session in subscription mode with
//      `quantity: seats` and `trial_period_days: 10`. Return its url.
//   5. If not, return ok with no checkoutUrl — the form falls back to
//      sending the trainer to /verify-account and they can pay later
//      from /billing/plans once Stripe is wired up.
// Slimmed since the seat-count slider + Stripe handoff moved to
// /billing/setup inside the platform. /signup now creates a TRIALING
// account and routes to email verification — billing comes later.
const schema = z.object({
  name: z.string().min(2),
  businessName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  // Optional promo code — when valid it sets the total trial length.
  promoCode: z.string().max(40).optional(),
})

function generateCode(): string {
  // Cryptographically random 6-digit code, padded so leading zeros survive.
  const n = crypto.randomInt(0, 1_000_000)
  return n.toString().padStart(6, '0')
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors)[0]
    const message = firstField?.[1]?.[0] ?? flat.formErrors[0] ?? 'Invalid input'
    return NextResponse.json({ error: message, details: flat }, { status: 400 })
  }

  const { name, businessName, email, password, promoCode } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  // A valid promo code overrides the default trial length. An invalid one
  // blocks signup with a specific message so the trainer can fix or clear it
  // (rather than silently getting the standard 10 days and being confused).
  let trialDays = TRIAL_DAYS
  let promoCodeId: string | null = null
  if (promoCode && promoCode.trim()) {
    const result = await validatePromoCode(promoCode)
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400 })
    }
    trialDays = result.promo.trialDays
    promoCodeId = result.promo.id
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)

  // Build the user + trainer atomically so we never leave a half-account
  // around if the second insert fails.
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        role: 'TRAINER',
        // Login is blocked until they enter the 6-digit code we email
        // below (see lib/auth.ts authorize). Stripe payment success
        // does NOT auto-verify — the trainer still confirms via email.
        emailVerified: null,
      },
    })

    await tx.account.create({
      data: {
        userId: user.id,
        type: 'credentials',
        provider: 'credentials',
        providerAccountId: passwordHash,
      },
    })

    const profile = await tx.trainerProfile.create({
      data: {
        userId: user.id,
        businessName,
        // subscriptionStatus defaults to TRIALING; trialEndsAt drives
        // the "X days left" banner. Address + seats + Stripe customer
        // get added on /billing/setup once they're past verification.
        trialEndsAt,
        promoCodeId,
        // Country of signup from Vercel's IP geo header (ISO alpha-2), for the
        // admin flag. Null in local dev / when the header is absent.
        signupCountry: req.headers.get('x-vercel-ip-country')?.toUpperCase() || null,
      },
    })

    // Founding account = OWNER member of its own business (see register route).
    await tx.trainerMembership.create({
      data: {
        companyId: profile.id,
        userId: user.id,
        role: 'OWNER',
        acceptedAt: new Date(),
      },
    })

    // Count the redemption only once the account is committed.
    if (promoCodeId) {
      await tx.promoCode.update({
        where: { id: promoCodeId },
        data: { redeemedCount: { increment: 1 } },
      })
    }
  })

  // Verification email — fire-and-log; a transient Resend failure shouldn't
  // block the signup since the trainer can resend from /verify-account.
  const code = generateCode()
  const expires = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.verificationToken.create({
    data: { identifier: email, token: code, expires },
  })
  sendVerificationEmail({ to: email, name, businessName, code }).catch(err => {
    console.error('[signup] verification email failed:', err)
  })

  // Heads-up to the founders about the new trainer (never blocks signup).
  await notifyNewTrainerSignup({ name, businessName, email, source: 'signup flow' })
    .catch(err => console.error('[signup] founder notify failed:', err))

  return NextResponse.json({ ok: true, email }, { status: 201 })
}
