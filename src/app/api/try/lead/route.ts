import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceRateLimit, getClientIp } from '@/lib/rate-limit'
import {
  TRY_LEAD_COOKIE,
  TRY_LEAD_COOKIE_MAX_AGE,
  TRY_LEAD_PER_IP,
  TRY_LEAD_WINDOW_MS,
  consentVersionsAreCurrent,
  hashIp,
  normaliseCampaign,
  normaliseSource,
  tryLeadSchema,
} from '@/lib/demo-lead'
import { TRY_MARKETING } from '@/lib/demo-consent'

// POST /api/try/lead — step 1 of the trade-show "Try It" flow.
//
// Records who this is and what they agreed to. Public and unauthenticated by
// design: it is behind a QR code on a poster.
//
// It creates NO tenant and seeds NO data — that is step 2 (/api/try/launch),
// deliberately split so the expensive half is behind a tighter limit and so a
// visitor who fills in the form and walks away still leaves us the lead.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const ip = getClientIp(req)
  const limited = await enforceRateLimit({
    key: `try-lead:${ip}`,
    limit: TRY_LEAD_PER_IP,
    windowMs: TRY_LEAD_WINDOW_MS,
  })
  if (limited) return limited

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }

  const parsed = tryLeadSchema.safeParse(body)
  if (!parsed.success) {
    // `acceptTerms` failing is the interesting case: the screen will not let you
    // press the button without it, and the route refuses independently. Whatever
    // the form refuses, the route must refuse (AGENTS.md #3).
    const first = parsed.error.issues[0]
    return NextResponse.json(
      { error: first?.message ?? 'Please check the form and try again.', field: first?.path?.[0] ?? null },
      { status: 400 },
    )
  }

  if (!consentVersionsAreCurrent(parsed.data)) {
    return NextResponse.json(
      { error: 'This page is out of date. Please reload and try again.' },
      { status: 409 },
    )
  }

  const now = new Date()
  const optedIn = parsed.data.marketingOptIn === true

  const lead = await prisma.demoLead.create({
    data: {
      name: parsed.data.name,
      companyName: parsed.data.companyName,
      email: parsed.data.email,
      // Placeholder until they pick on the next screen. Overwritten by
      // /api/try/launch, and left as-is if they never get that far — which is
      // itself worth knowing.
      persona: 'unknown',
      termsVersion: parsed.data.termsVersion,
      termsAcceptedAt: now,
      marketingOptIn: optedIn,
      // Recorded whether or not they ticked: "was offered this wording and said
      // no" is the half of the record that protects us.
      marketingVersion: TRY_MARKETING.id,
      marketingOptInAt: optedIn ? now : null,
      source: normaliseSource(parsed.data.source),
      campaign: normaliseCampaign(parsed.data.campaign),
      ipHash: hashIp(ip),
      userAgent: req.headers.get('user-agent')?.slice(0, 500) ?? null,
    },
    select: { id: true },
  })

  const res = NextResponse.json({ ok: true })
  // httpOnly: the persona step must not be able to name somebody else's lead.
  res.cookies.set(TRY_LEAD_COOKIE, lead.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TRY_LEAD_COOKIE_MAX_AGE,
  })
  return res
}
