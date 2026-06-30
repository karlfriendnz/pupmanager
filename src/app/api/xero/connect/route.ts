import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isXeroConfigured, xeroAuthorizeUrl } from '@/lib/xero'

// Start the Xero OAuth2 consent flow. Owner-only (mirrors Billing / Stripe
// Connect — connecting the business's accounting is an account-owner action).
// A short-lived CSRF state token, tied to the company, is the OAuth integrity
// guard; the callback verifies it before trusting the returned code.
export async function GET() {
  const session = await auth()
  const settings = `${process.env.NEXT_PUBLIC_APP_URL}/settings?tab=integration`
  if (!session || session.user.role !== 'TRAINER' || !session.user.trainerId) {
    return NextResponse.redirect(`${process.env.NEXT_PUBLIC_APP_URL}/login`)
  }
  if (!isXeroConfigured()) {
    return NextResponse.redirect(`${settings}&xero=unconfigured`)
  }

  const stateToken = crypto.randomBytes(32).toString('hex')
  await prisma.verificationToken.create({
    data: {
      identifier: `xero-oauth:${session.user.trainerId}`,
      token: stateToken,
      expires: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  })

  return NextResponse.redirect(xeroAuthorizeUrl(stateToken))
}
