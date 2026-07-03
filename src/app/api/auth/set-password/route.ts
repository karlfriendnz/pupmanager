import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'

// POST /api/auth/set-password — the final step of the split signup. After the
// trainer verifies their OTP (which mints a single-use `pwsetup:<email>` token),
// this creates their credentials account so email + password login works. The
// setup token proves they just verified, so no session is required yet.
const schema = z.object({
  email: z.string().email(),
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

const setupIdentifier = (email: string) => `pwsetup:${email}`

export async function POST(req: Request) {
  const limited = await enforceRateLimit({ key: `setpw:${getClientIp(req)}`, limit: 10, windowMs: 60 * 60_000 })
  if (limited) return limited

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const message = parsed.error.flatten().fieldErrors.password?.[0] ?? 'Invalid request'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { email, token, password } = parsed.data

  // Validate the setup token: exists, was issued for this email, not expired.
  const record = await prisma.verificationToken.findUnique({ where: { token } })
  if (!record || record.identifier !== setupIdentifier(email) || record.expires < new Date()) {
    return NextResponse.json(
      { error: 'This setup link has expired. Please verify your email again to continue.' },
      { status: 400 },
    )
  }

  const user = await prisma.user.findUnique({
    where: { email, role: 'TRAINER' },
    include: { accounts: { where: { provider: 'credentials' } } },
  })
  if (!user) {
    return NextResponse.json(
      { error: 'This setup link has expired. Please verify your email again to continue.' },
      { status: 400 },
    )
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const credAccount = user.accounts[0]

  await prisma.$transaction(async (tx) => {
    if (credAccount) {
      // Shouldn't normally happen in this flow, but be idempotent: rotate hash.
      await tx.account.update({
        where: { id: credAccount.id },
        data: { providerAccountId: passwordHash },
      })
    } else {
      await tx.account.create({
        data: {
          userId: user.id,
          type: 'credentials',
          provider: 'credentials',
          providerAccountId: passwordHash,
        },
      })
    }

    // Setting a password proves email ownership; make sure they're verified so
    // the emailVerified login gate lets them straight in.
    if (!user.emailVerified) {
      await tx.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } })
    }

    // Burn the setup token so it can't be reused.
    await tx.verificationToken.delete({ where: { token } })
  })

  return NextResponse.json({ ok: true })
}
