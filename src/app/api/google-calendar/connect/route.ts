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
export async function GET() {
  const ctx = await getTrainerContext()
  const settings = `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=googlecalendar`
  if (!ctx) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`)
  }
  // The (free) Google Calendar add-on must be enabled for the business.
  if (!(await hasAddon(ctx.companyId, 'googlecalendar'))) {
    return NextResponse.redirect(settings)
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.redirect(`${settings}&googlecalendar=unconfigured`)
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
  await prisma.verificationToken.create({
    data: {
      identifier: `gcal-oauth:${membershipId}`,
      token: stateToken,
      expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  })

  return NextResponse.redirect(googleCalendarAuthorizeUrl(stateToken))
}
