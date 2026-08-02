import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ACTIVE_TRAINER_COOKIE } from '@/lib/client-context'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import { sendClientVerificationEmail } from '@/lib/auth-emails'
import {
  ContinuationError,
  completeContinuation,
  resolveContinuation,
} from '@/lib/form-continuation'
import crypto from 'crypto'

// POST /api/form/<formId>/continue — the account step of the continuous run.
//
// This is a PUBLIC, UNAUTHENTICATED endpoint that creates accounts, so every
// decision it makes is a security decision. In order:
//
// ENUMERATION. There is no email field. The address is read off the enquiry the
//   token resolves to (lib/form-continuation), so the endpoint cannot be asked
//   "does bob@example.com have an account?" — there is nowhere to put the
//   question. Probing one address means first submitting an enquiry naming it,
//   which is separately rate limited and lands in a trainer's inbox.
//
// TAKEOVER. An email that already has a User is NEVER given a password here.
//   Every client a trainer added by hand has a User row and no credentials;
//   letting anyone who knew the address set one would hand them the account.
//   They are asked to sign in instead, and the run resumes on the far side
//   where a real session proves who they are. The check is repeated inside
//   completeContinuation's transaction so a signup racing this one loses.
//
// TENANT. `trainerId` comes off the enquiry, which took it off the form when
//   the enquiry was written. Nothing posted here can change which business the
//   new client lands in.
//
// RATE LIMIT. Per IP, and again per run, below.
//
// VERIFICATION. Deliberately not a gate — see the note where the email is sent.

const schema = z.object({
  token: z.string().min(16).max(200),
  // Absent when a person who already had an account has just signed in and is
  // resuming; the session is their proof, and there is no password to set.
  password: z.string().min(8, 'Use at least 8 characters').max(200).optional(),
})

function generateCode(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

export async function POST(req: Request, { params }: { params: Promise<{ formId: string }> }) {
  // Unauthenticated and account-creating: the same protection the login screen
  // has (lib/rate-limit), keyed by IP.
  const limited = await enforceRateLimit({
    key: `form-continue:${getClientIp(req)}`,
    limit: 10,
    windowMs: 10 * 60_000,
  })
  if (limited) return limited

  const { formId } = await params
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    const flat = parsed.error.flatten()
    const first = Object.entries(flat.fieldErrors)[0]?.[1]?.[0] ?? 'Check the details and try again.'
    return NextResponse.json({ error: first }, { status: 400 })
  }

  const resolved = await resolveContinuation(formId, parsed.data.token)
  if (!resolved.ok) {
    return NextResponse.json(
      {
        error:
          resolved.problem === 'EXPIRED'
            ? 'This link has expired. Fill the form in again and we will send you a fresh one.'
            : resolved.problem === 'USED'
              ? 'This link has already been used. Sign in to pick up where you left off.'
              : 'We could not find this sign-up. Fill the form in again to start over.',
        problem: resolved.problem,
      },
      { status: 410 },
    )
  }
  const run = resolved.run

  // A second limiter on the RUN itself, so one resolved link cannot be hammered
  // from a botnet the per-IP limit never sees as the same caller.
  const perRun = await enforceRateLimit({
    key: `form-continue-run:${run.enquiryId}`,
    limit: 12,
    windowMs: 60 * 60_000,
  })
  if (perRun) return perRun

  const session = await auth()
  const sessionEmail = session?.user?.email?.trim().toLowerCase() ?? null
  const runEmail = run.email.trim().toLowerCase()

  let identity: { userId: string } | { password: string }

  if (sessionEmail && sessionEmail === runEmail && session?.user?.id) {
    // They already had an account, went and signed in, and came back. The
    // session is the proof; no password is set and none is asked for.
    identity = { userId: session.user.id }
  } else if (sessionEmail && sessionEmail !== runEmail) {
    // Signed in as somebody else. Joining here would attach this run to the
    // wrong person's account, so it stops — with the way out named.
    return NextResponse.json(
      {
        status: 'wrong_account',
        error: `You're signed in as ${sessionEmail}, but this sign-up is for ${run.email}. Sign out and try the link again.`,
      },
      { status: 409 },
    )
  } else {
    const existing = await prisma.user.findUnique({
      where: { email: runEmail },
      select: { id: true },
    })
    if (existing) {
      // The one genuinely dangerous case. No password is written, no session is
      // issued, and the run stays unspent so signing in resumes it.
      return NextResponse.json({ status: 'signin', email: run.email }, { status: 200 })
    }
    if (!parsed.data.password) {
      return NextResponse.json({ error: 'Choose a password to continue.' }, { status: 400 })
    }
    identity = { password: parsed.data.password }
  }

  let done
  try {
    done = await completeContinuation(run, identity)
  } catch (err) {
    if (err instanceof ContinuationError) {
      return NextResponse.json(
        {
          status: err.code === 'ACCOUNT_EXISTS' ? 'signin' : 'used',
          error: err.message,
        },
        { status: err.code === 'ACCOUNT_EXISTS' ? 200 : 410 },
      )
    }
    throw err
  }

  // ── Confirm-your-email, sent but not enforced ─────────────────────────────
  //
  // Requiring a click here would put back the exact break this feature removes:
  // leave the app, go to an inbox, come back. So the address is confirmed
  // AFTER, not before — the same posture as /api/auth/signup-client, and as
  // every client a trainer ever added by hand (lib/auth.ts gates only
  // unverified TRAINERs). The honest cost: an account can be created on an
  // address its owner does not read. What limits it is that such an account can
  // only ever see its own empty diary, and the real owner takes the address
  // back through the sign-in link or a password reset, both of which land in
  // the inbox the impostor does not have.
  if ('password' in identity) {
    const code = generateCode()
    prisma.verificationToken
      .create({
        data: { identifier: runEmail, token: code, expires: new Date(Date.now() + 10 * 60_000) },
      })
      .then(() =>
        sendClientVerificationEmail({
          to: runEmail,
          name: run.name,
          trainer: {
            businessName: run.trainer.businessName,
            logoUrl: run.trainer.logoUrl,
            emailAccentColor: run.trainer.emailAccentColor,
          },
          code,
        }),
      )
      .catch(err => console.error('[form-continue] verification email failed:', err))
  }

  const res = NextResponse.json({
    status: 'ready',
    // The browser signs in with this, so it never has to be typed twice.
    email: run.email,
    clientProfileId: done.clientProfileId,
    hasIntake: done.hasIntake,
  })
  // Pin THIS trainer as the active relationship. Someone who is already another
  // trainer's client would otherwise land on that trainer's home screen and
  // never see the business whose form they just filled in. getActiveClient
  // re-checks the profile belongs to the signed-in user, so a pin is a
  // preference, never an authorisation.
  res.cookies.set(ACTIVE_TRAINER_COOKIE, done.clientProfileId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}
