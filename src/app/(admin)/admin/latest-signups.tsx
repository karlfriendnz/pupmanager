import Link from 'next/link'

// Compact, mobile-first view of the most recent trainer signups for the
// dashboard. Renders as stacked cards (not a wide table) so it reads cleanly on
// a phone — see the "build interactive UI app-style" house rule.
type Signup = {
  id: string
  name: string | null
  email: string
  businessName: string | null
  subscriptionStatus: string | null
  signupCountry: string | null
  createdAt: string // ISO
}

// ISO 3166-1 alpha-2 → flag emoji (regional indicator pair). Null for anything
// that isn't a clean 2-letter code. (Mirrors the helper in trainer-actions.tsx.)
function flagEmoji(iso: string | null): string | null {
  if (!iso || iso.length !== 2 || !/^[A-Za-z]{2}$/.test(iso)) return null
  const cc = iso.toUpperCase()
  return String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
}

// "DD MMM, H:MM AM/PM" in NZT, e.g. "14 Jun, 4:37 PM".
function joinedLabel(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso))
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  const ap = get('dayPeriod').replace(/\./g, '').toUpperCase()
  return `${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} ${ap}`
}

function statusChip(status: string | null) {
  const cls =
    status === 'ACTIVE' ? 'bg-green-900 text-green-300' :
    status === 'TRIALING' ? 'bg-blue-900 text-blue-300' :
    'bg-slate-700 text-slate-400'
  const label =
    status === 'TRIALING' ? 'Trial' :
    status === 'ACTIVE' ? 'Active' :
    (status ?? 'No plan')
  return <span className={`text-[11px] px-1.5 py-0.5 rounded-full shrink-0 ${cls}`}>{label}</span>
}

export function LatestSignups({ trainers }: { trainers: Signup[] }) {
  if (trainers.length === 0) {
    return (
      <div className="bg-slate-800 rounded-2xl border border-slate-700 p-4 text-center text-sm text-slate-500">
        No signups yet
      </div>
    )
  }

  // Compact single-row-per-signup list — the whole row is the link, so no extra
  // "View trainer" line eating vertical space.
  return (
    <ul className="rounded-2xl border border-slate-700 bg-slate-800 divide-y divide-slate-700/60">
      {trainers.map(t => {
        const flag = flagEmoji(t.signupCountry)
        return (
          <li key={t.id}>
            <Link
              href={`/admin/trainers?q=${encodeURIComponent(t.email)}`}
              className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-slate-700/30"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{t.name ?? '—'}</p>
                <p className="text-xs text-slate-400 truncate">
                  {t.businessName ?? t.email} · <span className="tabular-nums">{joinedLabel(t.createdAt)}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {flag && <span aria-hidden className="text-sm leading-none" title={`Signed up in ${t.signupCountry}`}>{flag}</span>}
                {statusChip(t.subscriptionStatus)}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
