import { NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { sendVerificationEmail, isPrivateRelayEmail } from '@/lib/auth-emails'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'

const schema = z.object({ email: z.string().email() })

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

// POST /api/auth/set-email — for a signed-in trainer whose email is a private
// Apple relay address (or who otherwise needs to swap it): set a real,
// deliverable email, reset verification, and send a fresh 6-digit code there.
// Auth-gated to the current session so one user can't change another's email.
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Not signed in' }, { status: 401 })

  const limited = await enforceRateLimit({ key: `set-email:${getClientIp(req)}`, limit: 8, windowMs: 60 * 60_000 })
  if (limited) return limited

  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })

  const email = parsed.data.email.trim().toLowerCase()

  // The whole point of this endpoint: reject Apple relay addresses.
  if (isPrivateRelayEmail(email)) {
    return NextResponse.json({ error: 'Please use a real email address, not a private Apple relay address.' }, { status: 400 })
  }

  // Don't collide with another account.
  const clash = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (clash && clash.id !== session.user.id) {
    return NextResponse.json({ error: 'That email is already in use.' }, { status: 409 })
  }

  // Swap the email and reset verification — the code below re-confirms it.
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: { email, emailVerified: null },
    include: { trainerProfile: { select: { businessName: true } } },
  })

  const code = generateCode()
  const expires = new Date(Date.now() + 10 * 60 * 1000)
  await prisma.verificationToken.deleteMany({ where: { identifier: email } })
  await prisma.verificationToken.create({ data: { identifier: email, token: code, expires } })

  await sendVerificationEmail({
    to: email,
    name: user.name ?? email,
    businessName: user.trainerProfile?.businessName || 'your business',
    code,
  }).catch(err => console.error('[set-email] verification email failed:', err))

  return NextResponse.json({ ok: true, email })
}
