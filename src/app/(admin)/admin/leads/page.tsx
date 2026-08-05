import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { consentText } from '@/lib/demo-consent'
import { PERSONAS } from '@/lib/onboarding-recommendations'
import { LeadsToolbar } from './leads-toolbar'

export const metadata: Metadata = { title: 'Admin · Try It leads' }

// Everyone who scanned the QR at a stand — the marketing database the trade-show
// "Try It" flow exists to build.
//
// These rows OUTLIVE the sandboxes they came from, on purpose: the tenant is
// destroyed within hours, this is not. A row showing no live sandbox is the
// normal, healthy state, not a missing record.

const PERSONA_LABEL = new Map(PERSONAS.map(p => [p.id, p.label]))

function fmt(d: Date | null | undefined): string {
  if (!d) return '—'
  return new Intl.DateTimeFormat('en-NZ', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: 'Pacific/Auckland',
  }).format(d)
}

export default async function AdminLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; opted?: string }>
}) {
  const params = await searchParams
  const q = params.q?.trim() ?? ''
  const optedOnly = params.opted === '1'

  const where = {
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
  }

  const [leads, total, optedIn, liveSandboxes] = await Promise.all([
    prisma.demoLead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 250,
      select: {
        id: true, name: true, companyName: true, email: true, persona: true,
        termsVersion: true, termsAcceptedAt: true,
        marketingOptIn: true, marketingVersion: true, marketingOptInAt: true, marketingRevokedAt: true,
        source: true, campaign: true, createdAt: true,
        sessions: {
          orderBy: { startedAt: 'desc' },
          select: { id: true, status: true, startedAt: true, purgedAt: true, wantsFollowUp: true },
        },
      },
    }),
    prisma.demoLead.count(),
    prisma.demoLead.count({ where: { marketingOptIn: true, marketingRevokedAt: null } }),
    prisma.demoSession.count({ where: { status: 'ACTIVE' } }),
  ])

  const stats = [
    { label: 'Leads captured', value: total },
    { label: 'Marketing opt-ins', value: optedIn },
    { label: 'Live sandboxes', value: liveSandboxes },
  ]

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Try It leads</h1>
        <p className="mt-1 text-sm text-slate-400">
          People who scanned the QR code (or followed the link) and started a demo. The demo workspace is
          deleted within hours; these rows are not.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-3 gap-3">
        {stats.map(s => (
          <div key={s.label} className="rounded-xl border border-slate-700 bg-slate-800 p-3">
            <p className="text-2xl font-bold tabular-nums">{s.value}</p>
            <p className="mt-1 text-[11px] text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      <LeadsToolbar q={q} optedOnly={optedOnly} />

      {leads.length === 0 ? (
        <p className="rounded-xl border border-slate-700 bg-slate-800 p-6 text-sm text-slate-400">
          {total === 0 ? 'Nobody has tried the demo yet.' : 'No leads match that search.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full min-w-[62rem] text-sm">
            <thead className="bg-slate-800 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Business</th>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Trade</th>
                <th className="px-3 py-2 font-medium">Marketing</th>
                <th className="px-3 py-2 font-medium">Consent recorded</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Demos</th>
                <th className="px-3 py-2 font-medium">Captured</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900/40">
              {leads.map(l => {
                const terms = consentText(l.termsVersion)
                return (
                  <tr key={l.id} className="align-top">
                    <td className="px-3 py-2">{l.name}</td>
                    <td className="px-3 py-2">{l.companyName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{l.email}</td>
                    <td className="px-3 py-2">{PERSONA_LABEL.get(l.persona) ?? l.persona}</td>
                    <td className="px-3 py-2">
                      {l.marketingRevokedAt ? (
                        <span className="text-amber-400">Withdrawn</span>
                      ) : l.marketingOptIn ? (
                        <span className="text-emerald-400">Yes</span>
                      ) : (
                        <span className="text-slate-500">No</span>
                      )}
                    </td>
                    {/* The consent record, spelled out: what they agreed to and
                        when. A version id nobody can resolve back to words is
                        not a record, so the wording is shown on hover. */}
                    <td className="px-3 py-2 text-xs text-slate-400" title={terms?.text ?? 'Unknown consent version'}>
                      <span className="font-mono">{l.termsVersion}</span>
                      <br />
                      {fmt(l.termsAcceptedAt)}
                      {l.marketingOptInAt && (
                        <>
                          <br />
                          <span className="font-mono">{l.marketingVersion}</span> · {fmt(l.marketingOptInAt)}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {l.source}
                      {l.campaign ? <><br />{l.campaign}</> : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">
                      {l.sessions.length === 0 ? (
                        <span className="text-slate-500">never started</span>
                      ) : (
                        l.sessions.map(s => (
                          <div key={s.id}>
                            {s.status.toLowerCase()} · {fmt(s.startedAt)}
                            {s.wantsFollowUp && <span className="ml-1 text-emerald-400">· follow up</span>}
                          </div>
                        ))
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-400">{fmt(l.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Showing the {leads.length} most recent{total > leads.length ? ` of ${total}` : ''}. Use Export for the full list.
      </p>
    </div>
  )
}
