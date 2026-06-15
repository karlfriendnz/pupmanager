import { NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { sendVerificationEmail, isPrivateRelayEmail } from '@/lib/auth-emails'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'

const schema = z.object({ email: z.string().email() })

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

// POST /api/auth/resend-verification — issues a fresh code for an unverified
// trainer who lost the original email or let the 10-minute expiry lapse.
// Always returns 200 to avoid email enumeration: telling someone "this email
// is verified" or "this email isn't registered" leaks user existence.
export async function POST(req: Request) {
  const limited = await enforceRateLimit({ key: `resend-verify:${getClientIp(req)}`, limit: 5, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ ok: true })

  const { email } = parsed.data

  const user = await prisma.user.findUnique({
    where: { email },
    include: { trainerProfile: true },
  })

  // Never resend to an Apple private-relay address — it won't deliver. The
  // trainer layout routes such users to the "replace email" step instead.
  if (user && user.role === 'TRAINER' && !user.emailVerified && !isPrivateRelayEmail(user.email)) {
    const code = generateCode()
    const expires = new Date(Date.now() + 10 * 60 * 1000)

    // Tokens are uniquely keyed on (identifier, token); clear any prior
    // active tokens for this email so the latest one is the only valid one.
    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({
      data: { identifier: email, token: code, expires },
    })

    await sendVerificationEmail({
      to: email,
      name: user.name ?? email,
      businessName: user.trainerProfile?.businessName ?? 'your business',
      code,
    }).catch(err => {
      console.error('[resend-verification] email failed:', err)
    })
  }

  return NextResponse.json({ ok: true })
}
