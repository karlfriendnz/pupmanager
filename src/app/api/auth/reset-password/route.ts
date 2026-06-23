import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'

const schema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export async function POST(req: Request) {
  const limited = await enforceRateLimit({ key: `reset:${getClientIp(req)}`, limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.flatten().fieldErrors.password?.[0] ?? 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { email, token, password } = parsed.data

  // The token is globally unique. Validate it exists, matches the email it was
  // issued for, and hasn't expired. A generic message avoids leaking which of
  // those failed.
  const record = await prisma.verificationToken.findUnique({ where: { token } })
  if (!record || record.identifier !== email || record.expires < new Date()) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { email, role: 'TRAINER' },
    include: { accounts: { where: { provider: 'credentials' } } },
  })
  if (!user) {
    return NextResponse.json({ error: 'This reset link is invalid or has expired. Please request a new one.' }, { status: 400 })
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const credAccount = user.accounts[0]

  await prisma.$transaction(async (tx) => {
    if (credAccount) {
      // Existing password user — rotate the hash.
      await tx.account.update({
        where: { id: credAccount.id },
        data: { providerAccountId: passwordHash },
      })
    } else {
      // No credentials account yet (e.g. an Apple-native signup that never had
      // a password). Create one so email + password login works from now on.
      await tx.account.create({
        data: {
          userId: user.id,
          type: 'credentials',
          provider: 'credentials',
          providerAccountId: passwordHash,
        },
      })
    }

    // Completing a reset proves email ownership. If the account was never
    // verified, verify it now so the emailVerified login gate doesn't leave
    // them with a password they still can't log in with.
    if (!user.emailVerified) {
      await tx.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } })
    }

    // Burn the token so the link can't be reused.
    await tx.verificationToken.delete({ where: { token } })
  })

  return NextResponse.json({ ok: true })
}
