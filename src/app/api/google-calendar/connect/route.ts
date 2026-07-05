import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { getTrainerContext } from '@/lib/membership'
import { isGoogleCalendarConfigured, googleCalendarAuthorizeUrl } from '@/lib/google-calendar'

// Start the Google Calendar OAuth2 consent flow. Per staff member — ANY trainer
// in a business with the add-on on connects their OWN Google account (not just
// the owner). A short-lived CSRF state token, tied to the member's membership id,
// is the OAuth integrity guard; the callback verifies it before trusting the code.
export async function GET(req: Request) {
  const ctx = await getTrainerContext()
  // Google Calendar has no settings page — the add-on popup is its home.
  const addons = `${process.env.NEXT_PUBLIC_APP_URL}/add-ons`

  // Where to land after a successful connect. Only same-origin relative paths are
  // honoured — no open redirects.
  const rt = new URL(req.url).searchParams.get('returnTo')
  const returnTo = rt && rt.startsWith('/') && !rt.startsWith('//') ? rt : null
  if (!ctx) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`)
  }
  // The (free) Google Calendar add-on must be enabled for the business.
  if (!(await hasAddon(ctx.companyId, 'googlecalendar'))) {
    return NextResponse.redirect(addons)
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(`${addons}?googlecalendar=unconfigured`)
  }

  // We key the connection on the individual's membership. Legacy owners without a
  // backfilled membership row get one here (auth.ts normally creates it on login).
  let membershipId = ctx.membershipId
  if (!membershipId) {
    const membership = await prisma.trainerMembership.upsert({
      where: { companyId_userId: { companyId: ctx.companyId, userId: ctx.userId } },
      create: { companyId: ctx.companyId, userId: ctx.userId, role: 'OWNER', acceptedAt: new Date() },
      update: {},
      select: { id: true },
    })
    membershipId = membership.id
  }

  const stateToken = crypto.randomBytes(32).toString('hex')
  // Stash the return path alongside the membership id in the state identifier
  // (base64url so it can't introduce a ':' that breaks parsing in the callback).
  const identifier = returnTo
    ? `gcal-oauth:${membershipId}:${Buffer.from(returnTo).toString('base64url')}`
    : `gcal-oauth:${membershipId}`
  await prisma.verificationToken.create({
    data: {
      identifier,
      token: stateToken,
      expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  })

  return NextResponse.redirect(googleCalendarAuthorizeUrl(stateToken))
}
