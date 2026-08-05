import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { NotADemoTenantError, purgeDemoTenant } from '@/lib/demo-tenant'
import {
  TRY_LEAD_COOKIE,
  TRY_PREFILL_COOKIE,
  TRY_PREFILL_MAX_AGE,
} from '@/lib/demo-lead'

// POST /api/try/convert — "Start my own account", tapped from inside the demo.
//
// The sandbox is NEVER converted or kept. This route is a way OUT, not a
// promotion: it ends the demo, destroys the tenant exactly as the exit button
// does, and leaves the browser holding nothing but a pointer to the lead so the
// real sign-up form can fill itself in. The account they create afterwards is an
// ordinary trial with none of the demo markers on it — see the register route,
// which never writes them (enforced by the drift test in
// tests/unit/security/demo-tenant-marker).
//
// THE TRAP THIS EXISTS TO AVOID
// -----------------------------
// They are signed in as a demo trainer when they tap. Sending them to /register
// while still holding that session either bounces them (the proxy routes a
// signed-in trainer away from the auth pages) or, worse, leaves a half-state
// where the new account is created in the shadow of a tenant that is about to be
// deleted. So the order is fixed and the server does the irreversible part
// first: end the visit, destroy the tenant, hand back a prefill pointer — and
// only THEN does the browser sign out and navigate.
//
// ABANDONMENT IS THE NORMAL CASE. Most people who tap this will wander off
// mid-form. The tenant is already gone by then, because it is destroyed here
// rather than on the far side of a sign-up nobody may finish.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const session = await auth()
  if (!session?.user?.trainerId) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }
  if (!session.user.isDemo) {
    return NextResponse.json({ error: 'Not a demo session' }, { status: 403 })
  }

  const trainerId = session.user.trainerId

  const demoSession = await prisma.demoSession.findUnique({
    where: { trainerId },
    select: { id: true, leadId: true },
  })

  // Record the intent BEFORE anything destructive. If the purge then falls over,
  // we have still learned the thing worth knowing — that this stand produced
  // somebody who wanted an account.
  let leadId: string | null = null
  if (demoSession) {
    leadId = demoSession.leadId
    // First tap wins: `startedSignupAt: null` in the filter means re-tapping
    // does not move the timestamp, so it genuinely reads "when they decided"
    // rather than "when they last fiddled".
    await prisma.demoLead.updateMany({
      where: { id: demoSession.leadId, startedSignupAt: null },
      data: { startedSignupAt: new Date() },
    })
    // Flagged for sales whether or not they finish the form — someone who got
    // this far is worth a follow-up even if the sign-up drops out.
    await prisma.demoSession.updateMany({
      where: { id: demoSession.id, status: 'ACTIVE' },
      data: { status: 'ENDED', endedAt: new Date(), wantsFollowUp: true },
    })
  }

  // Destroy the sandbox. Marked ENDED above first, so a failure here still
  // leaves the sweep something to collect (see /api/cron/purge-demo).
  let purged = true
  try {
    await purgeDemoTenant(prisma, trainerId)
  } catch (err) {
    purged = false
    if (err instanceof NotADemoTenantError) {
      // The session says demo and the tenant says otherwise. Refuse — this is
      // exactly the disagreement the purge exists to stop, and it must not be
      // waved through just because the visitor is on their way to buying.
      console.error('[try/convert] refused', err.message)
      return NextResponse.json({ error: 'Not a demo session' }, { status: 403 })
    }
    console.error('[try/convert] purge failed, leaving it to the sweep', err)
  }

  const res = NextResponse.json({ ok: true, purged })

  // The only thing that crosses to the sign-up form: a pointer to a row we
  // look up ourselves. httpOnly and short-lived — phones get handed around at a
  // stand, and a stale prefill would put one visitor's email in front of the
  // next one.
  if (leadId) {
    res.cookies.set(TRY_PREFILL_COOKIE, leadId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: TRY_PREFILL_MAX_AGE,
    })
  }
  // The demo is over, so the cookie that lets somebody start another one goes
  // with it. Otherwise a half-finished sign-up leaves a live "launch another
  // sandbox" token sitting in the browser.
  res.cookies.set(TRY_LEAD_COOKIE, '', { path: '/', maxAge: 0 })

  return res
}
