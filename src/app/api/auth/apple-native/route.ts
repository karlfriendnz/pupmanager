import { NextResponse } from 'next/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/session-cookie'
import { sendVerificationEmail } from '@/lib/auth-emails'

function generateCode(): string {
  // Cryptographically random 6-digit code, zero-padded (mirrors /register).
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

// Native "Sign in with Apple" (iOS ASAuthorization sheet, via
// @capacitor-community/apple-sign-in). The app does the in-app Apple flow and
// posts us the identity token; we verify it against Apple's public keys, then
// find-or-create the trainer and mint their session cookie directly (the same
// helper the admin impersonation flow uses). This avoids the web OAuth
// redirect that opened the system browser (App Store Guideline 4 rejection),
// and offering Sign in with Apple satisfies Guideline 4.8.

const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'))

// The identity token's `aud` for the native iOS flow is the app bundle ID.
// (The web/Services-ID audience is accepted too, in case the Android web
// fallback is ever used.)
function allowedAudiences(): string[] {
  return [
    process.env.APPLE_NATIVE_BUNDLE_ID || 'com.pupmanager.app',
    process.env.APPLE_CLIENT_ID || '',
  ].filter(Boolean)
}

const schema = z.object({
  identityToken: z.string().min(10),
  // Apple only returns the name on the *first* authorization, so the client
  // forwards it when present.
  fullName: z.string().optional(),
})

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Missing identity token' }, { status: 400 })
  }

  // 1. Verify the token is a genuine, unexpired Apple token for our app.
  // We deliberately ignore Apple's own email_verified claim: every Apple
  // sign-up is put through our own 6-digit email verification below.
  let email: string | null = null
  try {
    const { payload } = await jwtVerify(parsed.data.identityToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: allowedAudiences(),
    })
    email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
  } catch {
    return NextResponse.json({ error: 'Could not verify your Apple sign-in. Please try again.' }, { status: 401 })
  }

  if (!email) {
    // Happens if the user previously hid their email and Apple didn't resend
    // it; without an email we can't match or create a trainer account.
    return NextResponse.json({ error: 'Apple did not share an email address. Please sign in with email instead.' }, { status: 400 })
  }

  // 2. Find or create the trainer.
  const existing = await prisma.user.findUnique({ where: { email } })

  if (existing && existing.role !== 'TRAINER') {
    return NextResponse.json({ error: 'That account isn\'t a trainer account.' }, { status: 403 })
  }

  // Every Apple sign-up must confirm a 6-digit code emailed to them before they
  // can use the app — even though Apple already verifies the address — so we
  // hold a deliverable email on file for billing/onboarding/drip mail. Once an
  // account is verified we never ask again. Apple's own email_verified claim is
  // intentionally NOT used to skip this step.
  let needsVerification = false

  let user = existing
  if (!user) {
    const name = parsed.data.fullName?.trim() || null
    user = await prisma.user.create({
      data: {
        email,
        name,
        role: 'TRAINER',
        // Always start unverified — the code we email below is the gate.
        emailVerified: null,
      },
    })
    needsVerification = true
    // Mirror the OAuth createUser flow: give the new trainer a business shell
    // they own, so the dashboard renders instead of looping. businessName
    // starts empty — onboarding step 1 prompts them to fill it in. Stamp a
    // 10-day trial like the /signup, /register and web-OAuth flows — without
    // it the trial banner reads the null end date as "Trial finished" on day
    // one (the bug that left Apple-native sign-ups with no trial window).
    const TRIAL_DAYS = 10
    const profile = await prisma.trainerProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        businessName: '',
        trialEndsAt: new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000),
      },
      update: {},
    })
    await prisma.trainerMembership.upsert({
      where: { companyId_userId: { companyId: profile.id, userId: user.id } },
      create: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
      update: {},
    })
  } else {
    if (parsed.data.fullName && !user.name) {
      // Backfill the name on an existing nameless account from Apple's first send.
      await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.fullName.trim() } })
    }
    // An existing Apple account that never finished verifying (e.g. signed up
    // before this gate, or bailed last time) is asked again on this sign-in.
    if (!user.emailVerified) needsVerification = true
  }

  // Issue + email a fresh 6-digit code for any account still needing
  // verification. Clear prior codes so the latest is the only valid one. Email
  // failure never blocks sign-in — they can hit "Resend" on the verify screen.
  if (needsVerification) {
    const code = generateCode()
    const expires = new Date(Date.now() + 10 * 60 * 1000)
    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({ data: { identifier: email, token: code, expires } })
    const tp = await prisma.trainerProfile.findUnique({
      where: { userId: user.id },
      select: { businessName: true },
    })
    await sendVerificationEmail({
      to: email,
      name: user.name ?? email,
      businessName: tp?.businessName || 'your business',
      code,
    }).catch(err => console.error('[apple-native] verification email failed:', err))
  }

  // 3. Mint the session — the jwt callback backfills trainerId on next request.
  // We still mint it even when verification is pending: Apple users have no
  // password to sign back in with, so they stay authenticated while the
  // trainer layout holds them on the verify screen until the code is entered.
  const res = NextResponse.json({ ok: true, requiresVerification: needsVerification, email })
  await setSessionCookie(res, {
    id: user.id,
    sub: user.id,
    role: 'TRAINER',
    name: user.name,
    email: user.email,
  })
  return res
}
