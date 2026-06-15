import { NextResponse } from 'next/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/session-cookie'
import { sendVerificationEmail, isPrivateRelayEmail } from '@/lib/auth-emails'

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
  // A real email the user typed when Apple gave us a private-relay address (or
  // no email at all). The client re-posts with this after we ask for it.
  email: z.string().email().optional(),
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

  // `email` here is whatever Apple gave us — a real address, a private relay
  // address (Hide My Email), or null. We require a REAL, deliverable email on
  // every Apple account, so a relay/missing address triggers the client to
  // collect one and re-post it as `email`.
  const appleEmail = email
  const provided = parsed.data.email?.trim().toLowerCase()

  // A typed email must itself be real — never accept another relay address.
  if (provided && isPrivateRelayEmail(provided)) {
    return NextResponse.json({ error: 'Please enter a real email address, not a private Apple relay address.' }, { status: 400 })
  }

  // 2. Find the existing trainer. Returning users are keyed by the email Apple
  // gives us (stable per app — including the relay address); also match a typed
  // real email so a relay user who is converting isn't duplicated.
  let user = appleEmail ? await prisma.user.findUnique({ where: { email: appleEmail } }) : null
  if (!user && provided) user = await prisma.user.findUnique({ where: { email: provided } })

  if (user && user.role !== 'TRAINER') {
    return NextResponse.json({ error: 'That account isn\'t a trainer account.' }, { status: 403 })
  }

  // The deliverable email to put on the account: a freshly typed real one wins,
  // else an existing real email, else the Apple address if it happens to be real.
  const realEmail =
    (provided && !isPrivateRelayEmail(provided)) ? provided :
    (user?.email && !isPrivateRelayEmail(user.email)) ? user.email :
    (appleEmail && !isPrivateRelayEmail(appleEmail)) ? appleEmail :
    null

  // No real email yet (Apple hid it / gave a relay address and the user hasn't
  // typed one). Ask the client to collect a real email, then re-post — we don't
  // create or modify anything until we have a deliverable address.
  if (!realEmail) {
    return NextResponse.json({ requiresEmail: true, appleEmail: appleEmail ?? null }, { status: 200 })
  }

  // A typed email already belonging to a *different* account is a conflict.
  if (provided) {
    const clash = await prisma.user.findUnique({ where: { email: provided }, select: { id: true } })
    if (clash && (!user || clash.id !== user.id)) {
      return NextResponse.json({ error: 'That email is already in use. Try signing in with it instead.' }, { status: 409 })
    }
  }

  // Every Apple sign-up must confirm a 6-digit code emailed to them before they
  // can use the app — even though Apple already verifies the address — so we
  // hold a deliverable email on file for billing/onboarding/drip mail. Once an
  // account is verified we never ask again. Apple's own email_verified claim is
  // intentionally NOT used to skip this step.
  let needsVerification = false

  if (!user) {
    const name = parsed.data.fullName?.trim() || null
    user = await prisma.user.create({
      data: {
        email: realEmail,
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
        // Country of signup from Vercel's IP geo header (ISO alpha-2).
        signupCountry: req.headers.get('x-vercel-ip-country')?.toUpperCase() || null,
      },
      update: {},
    })
    await prisma.trainerMembership.upsert({
      where: { companyId_userId: { companyId: profile.id, userId: user.id } },
      create: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
      update: {},
    })
  } else {
    // Returning user — swap a relay/placeholder address for the real one they
    // just gave us, and verify it before they're let in again.
    if (user.email !== realEmail) {
      user = await prisma.user.update({ where: { id: user.id }, data: { email: realEmail, emailVerified: null } })
    }
    if (parsed.data.fullName && !user.name) {
      // Backfill the name on an existing nameless account from Apple's first send.
      user = await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.fullName.trim() } })
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
    await prisma.verificationToken.deleteMany({ where: { identifier: realEmail } })
    await prisma.verificationToken.create({ data: { identifier: realEmail, token: code, expires } })
    const tp = await prisma.trainerProfile.findUnique({
      where: { userId: user.id },
      select: { businessName: true },
    })
    await sendVerificationEmail({
      to: realEmail,
      name: user.name ?? realEmail,
      businessName: tp?.businessName || 'your business',
      code,
    }).catch(err => console.error('[apple-native] verification email failed:', err))
  }

  // 3. Mint the session — the jwt callback backfills trainerId on next request.
  // We still mint it even when verification is pending: Apple users have no
  // password to sign back in with, so they stay authenticated while the
  // trainer layout holds them on the verify screen until the code is entered.
  const res = NextResponse.json({ ok: true, requiresVerification: needsVerification, email: realEmail })
  await setSessionCookie(res, {
    id: user.id,
    sub: user.id,
    role: 'TRAINER',
    name: user.name,
    email: user.email,
  })
  return res
}
