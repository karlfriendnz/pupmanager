import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

// How long the post-verification password-setup token stays valid.
const SETUP_TOKEN_TTL_MS = 15 * 60 * 1000
// Namespaced identifier so these tokens can't collide with the 6-digit OTP
// rows (which use the bare email as their identifier).
const setupIdentifier = (email: string) => `pwsetup:${email}`

// POST /api/auth/verify-email — finalises a fresh trainer signup by stamping
// the User.emailVerified column. Both the manual code entry on the register
// form and the one-click button in the verification email resolve here.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const firstField = Object.entries(flat.fieldErrors)[0]
    const message = firstField?.[1]?.[0] ?? 'Invalid input'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const { email, code } = parsed.data

  const token = await prisma.verificationToken.findUnique({
    where: { identifier_token: { identifier: email, token: code } },
  })
  if (!token) {
    return NextResponse.json({ error: 'That code doesn\'t match — try again or request a new one.' }, { status: 400 })
  }
  if (token.expires < new Date()) {
    // Clean up while we're here so it doesn't loiter in the table forever.
    await prisma.verificationToken
      .delete({ where: { identifier_token: { identifier: email, token: code } } })
      .catch(() => {})
    return NextResponse.json({ error: 'That code has expired — request a new one to continue.' }, { status: 400 })
  }

  // Does this account already have a way to sign in? A web-register lead has
  // NO accounts yet and must set a password next; an Apple/OAuth signup already
  // has an account and skips that step.
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, _count: { select: { accounts: true } } },
  })
  const needsPassword = !!user && user._count.accounts === 0

  // Mark the user verified + drop the OTP so it can't be reused. When a
  // password is still needed, mint a single-use setup token (replacing any
  // prior one) that authorises /api/auth/set-password.
  const setupToken = needsPassword ? crypto.randomUUID() : null
  await prisma.$transaction([
    prisma.user.update({
      where: { email },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({
      where: { identifier_token: { identifier: email, token: code } },
    }),
    ...(setupToken
      ? [
          prisma.verificationToken.deleteMany({ where: { identifier: setupIdentifier(email) } }),
          prisma.verificationToken.create({
            data: {
              identifier: setupIdentifier(email),
              token: setupToken,
              expires: new Date(Date.now() + SETUP_TOKEN_TTL_MS),
            },
          }),
        ]
      : []),
  ])

  return NextResponse.json({ ok: true, needsPassword, setupToken })
}
