import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/auth-emails'
import { notifyNewTrainerSignup } from '@/lib/notify-new-trainer'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { validatePromoCode } from '@/lib/promo'
import crypto from 'crypto'

// Registration collects only what we need to follow up on a lead: name,
// business name, phone and email. No password here — the trainer sets one
// AFTER verifying the OTP (see /api/auth/set-password), and the rest of the
// business profile (logo, public email, colours) is gathered later in the
// onboarding wizard. That means a User + TrainerProfile exists (a contactable
// lead) even if they never finish setting a password.
const schema = z.object({
  name: z.string().min(2),
  businessName: z.string().min(2),
  // Required: every trainer must have a phone on file (admin + ops need it).
  phone: z.string().trim().min(6).max(30),
  // The person's own login email (private).
  email: z.string().email(),
  // Deferred to onboarding, but still accepted if a caller sends them.
  showPhoneToClients: z.boolean().optional().default(false),
  publicEmail: z.union([z.string().email(), z.literal('')]).optional(),
  // Optional promo code — when valid it sets the total trial length.
  promoCode: z.string().max(40).optional(),
})

const TRIAL_DAYS = 10

function generateCode(): string {
  // Cryptographically random 6-digit code. Padded so leading-zero codes still
  // come out as 6 chars (otherwise "000123" would render as "123").
  const n = crypto.randomInt(0, 1_000_000)
  return n.toString().padStart(6, '0')
}

export async function POST(req: Request) {
  const limited = await enforceRateLimit({ key: `register:${getClientIp(req)}`, limit: 5, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json()
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors)[0]
    const message = firstField?.[1]?.[0] ?? flat.formErrors[0] ?? 'Invalid input'
    return NextResponse.json({ error: message, details: flat }, { status: 400 })
  }

  const { name, businessName, phone, showPhoneToClients, email, publicEmail, promoCode } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  // A valid promo code overrides the default trial length and shifts the end
  // date to fit. An invalid one blocks signup with a specific message so the
  // trainer can fix or clear it rather than silently getting the default.
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

  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email,
        role: 'TRAINER',
        // Null until they enter the 6-digit code we email them. Login is
        // blocked while this is null (see lib/auth.ts authorize).
        emailVerified: null,
      },
    })

    // No credentials account yet — the trainer sets their password after
    // verifying the OTP (POST /api/auth/set-password). Until then this is a
    // passwordless lead that can't log in but is fully contactable.

    const profile = await tx.trainerProfile.create({
      data: {
        userId: user.id,
        businessName,
        phone,
        showPhoneToClients,
        // Optional company email shown to clients; null when left blank.
        publicEmail: publicEmail || null,
        // subscriptionStatus defaults to TRIALING; stamp the end date.
        trialEndsAt,
        promoCodeId,
        // Country of signup from Vercel's IP geo header (ISO alpha-2), for the
        // admin flag. Null in local dev / when the header is absent.
        signupCountry: req.headers.get('x-vercel-ip-country')?.toUpperCase() || null,
      },
    })

    // The founding account is also an OWNER member of its own business, so
    // sessions/clients can be assigned to it uniformly and the auth layer
    // resolves everyone (owner + invited members) through TrainerMembership.
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

  // Generate + persist a 6-digit verification code. 10-minute expiry.
  const code = generateCode()
  const expires = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.verificationToken.create({
    data: { identifier: email, token: code, expires },
  })

  await sendVerificationEmail({
    to: email,
    name,
    businessName,
    code,
  }).catch(err => {
    console.error('[register] verification email failed:', err)
  })

  // Heads-up to the founders about the new trainer (never blocks signup).
  await notifyNewTrainerSignup({ name, businessName, email, source: 'register form' })
    .catch(err => console.error('[register] founder notify failed:', err))

  return NextResponse.json({ ok: true, email, trialDays }, { status: 201 })
}
