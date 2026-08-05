import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { consentText } from '@/lib/demo-consent'

// GET /api/admin/leads/export — the marketing database, as a CSV.
//
// Admin-only, guarded by session role like every other /api/admin route. The
// filters mirror the screen exactly (search + marketing-opt-ins-only), because
// the export people actually want is "the ones who said yes" — handing over the
// whole table and trusting a spreadsheet filter is how somebody mails a person
// who declined.
//
// The consent columns carry the WORDS, not just the version id. A CSV that
// lands in a lawyer's inbox two years from now has to stand on its own.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * CSV-escape a value. Prefixing a leading =, +, - or @ with an apostrophe is
 * not decoration: those characters make Excel treat a cell as a formula, and a
 * business name typed by a stranger at a trade show is untrusted input.
 */
function csv(value: unknown): string {
  if (value === null || value === undefined) return ''
  let s = String(value)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

function iso(d: Date | null | undefined): string {
  return d ? d.toISOString() : ''
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session || session.user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const optedOnly = url.searchParams.get('opted') === '1'

  const leads = await prisma.demoLead.findMany({
    where: {
      ...(optedOnly ? { marketingOptIn: true, marketingRevokedAt: null } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              { companyName: { contains: q, mode: 'insensitive' as const } },
              { email: { contains: q, mode: 'insensitive' as const } },
              { campaign: { contains: q, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    select: {
      name: true, companyName: true, email: true, persona: true,
      termsVersion: true, termsAcceptedAt: true,
      marketingOptIn: true, marketingVersion: true, marketingOptInAt: true, marketingRevokedAt: true,
      source: true, campaign: true, createdAt: true,
      startedSignupAt: true, signupCompletedAt: true,
      sessions: { select: { status: true, startedAt: true, wantsFollowUp: true } },
    },
  })

  const header = [
    'name', 'business', 'email', 'trade',
    'marketing_opt_in', 'marketing_opt_in_at', 'marketing_withdrawn_at',
    'terms_version', 'terms_accepted_at', 'terms_text',
    'marketing_version', 'marketing_text',
    'source', 'campaign', 'captured_at',
    'demos_started', 'wants_follow_up',
    // The two columns the `ev` campaign tag exists to be joined against: which
    // show produced people who decided, and which produced accounts.
    'tapped_start_at', 'signed_up_at',
  ]

  const rows = leads.map(l => {
    const termsBlock = consentText(l.termsVersion)
    const marketingBlock = l.marketingVersion ? consentText(l.marketingVersion) : null
    return [
      l.name, l.companyName, l.email, l.persona,
      l.marketingOptIn && !l.marketingRevokedAt ? 'yes' : 'no',
      iso(l.marketingOptInAt), iso(l.marketingRevokedAt),
      l.termsVersion, iso(l.termsAcceptedAt), termsBlock?.text ?? '',
      l.marketingVersion ?? '', marketingBlock?.text ?? '',
      l.source, l.campaign ?? '', iso(l.createdAt),
      l.sessions.length, l.sessions.some(s => s.wantsFollowUp) ? 'yes' : 'no',
      iso(l.startedSignupAt), iso(l.signupCompletedAt),
    ].map(csv).join(',')
  })

  const body = [header.join(','), ...rows].join('\r\n')
  const stamp = new Date().toISOString().slice(0, 10)

  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pupmanager-try-it-leads-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
