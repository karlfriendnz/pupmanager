import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exchangeCodeForTokens } from '@/lib/google-calendar'
import { refreshBusyForMembership } from '@/lib/google-calendar-sync'

// OAuth2 redirect target. Verifies the CSRF state, exchanges the code for
// tokens, and upserts the member's GoogleCalendarConnection (keyed by membership).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateToken = searchParams.get('state')
  const settings = `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=googlecalendar`
  const fail = `${settings}&googlecalendar=error`

  if (!code || !stateToken) return NextResponse.redirect(fail)

  // Verify + consume the one-time state token, recovering the membership id.
  const stateRecord = await prisma.verificationToken.findFirst({
    where: {
      token: stateToken,
      identifier: { startsWith: 'gcal-oauth:' },
      expires: { gt: new Date() },
    },
  })
  if (!stateRecord) return NextResponse.redirect(fail)
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: stateRecord.identifier, token: stateToken } },
  })
  const membershipId = stateRecord.identifier.replace('gcal-oauth:', '')

  // Resolve the company from the membership (also validates the id is still real).
  const membership = await prisma.trainerMembership.findUnique({
    where: { id: membershipId },
    select: { companyId: true },
  })
  if (!membership) return NextResponse.redirect(fail)

  try {
    const tokens = await exchangeCodeForTokens(code)
    // Without a refresh token we can't keep the connection alive — treat as a
    // failed connect (usually means prompt=consent wasn't honoured).
    if (!tokens.refresh_token) return NextResponse.redirect(fail)

    const data = {
      companyId: membership.companyId,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000 - 60 * 1000),
    }
    await prisma.googleCalendarConnection.upsert({
      where: { membershipId },
      create: { membershipId, ...data },
      update: data,
    })
  } catch (err) {
    console.error('[google-calendar] callback failed', err)
    return NextResponse.redirect(fail)
  }

  // Immediately pull the member's busy window so overlap warnings work right away.
  // Best-effort — a failure here doesn't undo the successful connect.
  try {
    await refreshBusyForMembership(membershipId)
  } catch (err) {
    console.error('[google-calendar] initial busy refresh failed', err)
  }

  return NextResponse.redirect(`${settings}&googlecalendar=connected`)
}
