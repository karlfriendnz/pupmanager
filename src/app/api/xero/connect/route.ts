import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { isXeroConfigured, xeroAuthorizeUrl } from '@/lib/xero'

// Start the Xero OAuth2 consent flow. Owner-only (mirrors Billing / Stripe
// Connect — connecting the business's accounting is an account-owner action).
// A short-lived CSRF state token, tied to the company, is the OAuth integrity
// guard; the callback verifies it before trusting the returned code.
export async function GET() {
  const ctx = await getTrainerContext()
  const settings = `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=xero`
  if (!ctx) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`)
  }
  // Connecting the business's Xero org is settings.edit-gated (owner/manager),
  // matching the Settings → Xero tab. Staff must not wire company accounting.
  if (!can('settings.edit', ctx.role, ctx.permissions)) {
    return NextResponse.redirect(settings)
  }
  // The Xero add-on must be enabled to connect (the settings tab is gated the
  // same way; this guards the OAuth entry point directly).
  if (!(await hasAddon(ctx.companyId, 'xero'))) {
    return NextResponse.redirect(settings)
  }
  if (!isXeroConfigured()) {
    return NextResponse.redirect(`${settings}&xero=unconfigured`)
  }

  const stateToken = crypto.randomBytes(32).toString('hex')
  await prisma.verificationToken.create({
    data: {
      identifier: `xero-oauth:${ctx.companyId}`,
      token: stateToken,
      expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  })

  return NextResponse.redirect(xeroAuthorizeUrl(stateToken))
}
