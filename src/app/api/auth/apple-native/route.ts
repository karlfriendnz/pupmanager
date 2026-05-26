import { NextResponse } from 'next/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { setSessionCookie } from '@/lib/session-cookie'

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
  let email: string | null = null
  let emailVerified = false
  try {
    const { payload } = await jwtVerify(parsed.data.identityToken, APPLE_JWKS, {
      issuer: 'https://appleid.apple.com',
      audience: allowedAudiences(),
    })
    email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null
    // Apple sends email_verified as a boolean or the string "true".
    emailVerified = payload.email_verified === true || payload.email_verified === 'true'
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

  let user = existing
  if (!user) {
    const name = parsed.data.fullName?.trim() || null
    user = await prisma.user.create({
      data: {
        email,
        name,
        role: 'TRAINER',
        emailVerified: emailVerified ? new Date() : null,
      },
    })
    // Mirror the OAuth createUser flow: give the new trainer a business shell
    // they own, so the dashboard renders instead of looping. businessName
    // starts empty — onboarding step 1 prompts them to fill it in.
    const profile = await prisma.trainerProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, businessName: '' },
      update: {},
    })
    await prisma.trainerMembership.upsert({
      where: { companyId_userId: { companyId: profile.id, userId: user.id } },
      create: { companyId: profile.id, userId: user.id, role: 'OWNER', acceptedAt: new Date() },
      update: {},
    })
  } else if (parsed.data.fullName && !user.name) {
    // Backfill the name on an existing nameless account from Apple's first send.
    await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.fullName.trim() } })
  }

  // 3. Mint the session — the jwt callback backfills trainerId on next request.
  const res = NextResponse.json({ ok: true })
  await setSessionCookie(res, {
    id: user.id,
    sub: user.id,
    role: 'TRAINER',
    name: user.name,
    email: user.email,
  })
  return res
}
