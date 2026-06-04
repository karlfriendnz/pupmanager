import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail } from '@/lib/auth-emails'
import { notifyNewTrainerSignup } from '@/lib/notify-new-trainer'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { validatePromoCode } from '@/lib/promo'
import crypto from 'crypto'

const schema = z.object({
  name: z.string().min(2),
  businessName: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  // Optional promo code — when valid it sets the total trial length.
  promoCode: z.string().max(40).optional(),
})

const TRIAL_DAYS = 14

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

  const { name, businessName, email, password, promoCode } = parsed.data

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

  const passwordHash = await bcrypt.hash(password, 12)
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
        // subscriptionStatus defaults to TRIALING; stamp the end date.
        trialEndsAt,
        promoCodeId,
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
