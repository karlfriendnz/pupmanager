import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { exchangeCodeForTokens, fetchPrimaryTenant } from '@/lib/xero'

// OAuth2 redirect target. Verifies the CSRF state, exchanges the code for
// tokens, resolves the trainer's Xero organisation, and upserts the connection.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateToken = searchParams.get('state')
  const settings = `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=integration`
  const fail = `${settings}&xero=error`

  if (!code || !stateToken) return NextResponse.redirect(fail)

  // Verify + consume the one-time state token, recovering the company id.
  const stateRecord = await prisma.verificationToken.findFirst({
    where: {
      token: stateToken,
      identifier: { startsWith: 'xero-oauth:' },
      expires: { gt: new Date() },
    },
  })
  if (!stateRecord) return NextResponse.redirect(fail)
  await prisma.verificationToken.delete({
    where: { identifier_token: { identifier: stateRecord.identifier, token: stateToken } },
  })
  const trainerId = stateRecord.identifier.replace('xero-oauth:', '')

  try {
    const tokens = await exchangeCodeForTokens(code)
    const tenant = await fetchPrimaryTenant(tokens.access_token)
    if (!tenant) return NextResponse.redirect(fail)

    const data = {
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000 - 60 * 1000),
      tenantId: tenant.tenantId,
      tenantName: tenant.tenantName,
    }
    await prisma.xeroConnection.upsert({
      where: { trainerId },
      create: { trainerId, ...data },
      update: data,
    })
  } catch (err) {
    console.error('[xero] callback failed', err)
    return NextResponse.redirect(fail)
  }

  return NextResponse.redirect(`${settings}&xero=connected`)
}
