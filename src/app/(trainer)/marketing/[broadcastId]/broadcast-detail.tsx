'use client'

import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { ClientAvatar } from '@/components/shared/client-avatar'
import { MousePointerClick, MailOpen, Mail, AlertTriangle, Search } from 'lucide-react'

export interface RecipientRow {
  id: string
  email: string
  name: string | null
  dogPhotoUrl: string | null
  status: string // SENT | DELIVERED | OPENED | CLICKED | BOUNCED | COMPLAINED | FAILED
  openedAt: string | null
  clickedAt: string | null
}

// Engagement ordering — most-engaged first so the trainer sees who's reading.
const RANK: Record<string, number> = { CLICKED: 0, OPENED: 1, DELIVERED: 2, SENT: 3, BOUNCED: 4, COMPLAINED: 5, FAILED: 6 }

type FilterKey = 'all' | 'opened' | 'clicked' | 'notOpened' | 'problem'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'opened', label: 'Opened' },
  { key: 'clicked', label: 'Clicked' },
  { key: 'notOpened', label: 'Not opened' },
  { key: 'problem', label: 'Bounced' },
]

function isOpened(s: string) { return s === 'OPENED' || s === 'CLICKED' }
function isProblem(s: string) { return s === 'BOUNCED' || s === 'COMPLAINED' || s === 'FAILED' }

export function BroadcastDetail({ recipientCount, recipients }: { recipientCount: number; recipients: RecipientRow[] }) {
  const [filter, setFilter] = useState<FilterKey>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    let opened = 0, clicked = 0, problem = 0
    for (const r of recipients) {
      if (r.status === 'CLICKED') clicked++
      if (isOpened(r.status)) opened++
      if (isProblem(r.status)) problem++
    }
    return { opened, clicked, problem }
  }, [recipients])

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('en-NZ')
    const list = recipients.filter(r => {
      if (q && !`${r.name ?? ''} ${r.email}`.toLocaleLowerCase('en-NZ').includes(q)) return false
      if (filter === 'opened') return isOpened(r.status)
      if (filter === 'clicked') return r.status === 'CLICKED'
      if (filter === 'notOpened') return !isOpened(r.status) && !isProblem(r.status)
      if (filter === 'problem') return isProblem(r.status)
      return true
    })
    return [...list].sort((a, b) =>
      (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) ||
      (a.name ?? a.email).localeCompare(b.name ?? b.email),
    )
  }, [recipients, filter, query])

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <Stat label="Sent" value={recipientCount} />
        <Stat label="Opened" value={counts.opened} sub={recipientCount ? `${Math.round((counts.opened / recipientCount) * 100)}%` : undefined} accent="blue" />
        <Stat label="Clicked" value={counts.clicked} sub={recipientCount ? `${Math.round((counts.clicked / recipientCount) * 100)}%` : undefined} accent="emerald" />
        <Stat label="Bounced" value={counts.problem} accent={counts.problem ? 'rose' : undefined} />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search recipients by name or email"
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-4 overflow-x-auto">
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`flex-1 whitespace-nowrap py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              filter === f.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Recipient list */}
      {visible.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-10">No recipients in this view.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map(r => (
            <Card key={r.id} className="px-4 py-3 flex items-center gap-3">
              <ClientAvatar size="md" name={r.name ?? r.email} dogPhotoUrl={r.dogPhotoUrl} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{r.name ?? r.email}</p>
                {r.name && <p className="truncate text-xs text-slate-400">{r.email}</p>}
              </div>
              <StatusBadge status={r.status} openedAt={r.openedAt} clickedAt={r.clickedAt} />
            </Card>
          ))}
        </div>
      )}
    </>
  )
}

function Stat({ label, value, sub, accent }: { label: string; value: number; sub?: string; accent?: 'blue' | 'emerald' | 'rose' }) {
  const color = accent === 'blue' ? 'text-blue-600' : accent === 'emerald' ? 'text-emerald-600' : accent === 'rose' ? 'text-rose-600' : 'text-slate-900'
  return (
    <Card className="px-4 py-3">
      <p className={`text-xl font-bold tabular-nums ${color}`}>{value}{sub && <span className="ml-1 text-xs font-medium text-slate-400">{sub}</span>}</p>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    </Card>
  )
}

function StatusBadge({ status, openedAt, clickedAt }: { status: string; openedAt: string | null; clickedAt: string | null }) {
  const fmt = (iso: string | null) => iso ? new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''
  if (status === 'CLICKED') return <Badge icon={<MousePointerClick className="h-3 w-3" />} tone="emerald" title={clickedAt ? `Clicked ${fmt(clickedAt)}` : undefined}>Clicked</Badge>
  if (status === 'OPENED') return <Badge icon={<MailOpen className="h-3 w-3" />} tone="blue" title={openedAt ? `Opened ${fmt(openedAt)}` : undefined}>Opened</Badge>
  if (status === 'DELIVERED') return <Badge icon={<Mail className="h-3 w-3" />} tone="slate">Delivered</Badge>
  if (status === 'BOUNCED' || status === 'FAILED') return <Badge icon={<AlertTriangle className="h-3 w-3" />} tone="rose">Bounced</Badge>
  if (status === 'COMPLAINED') return <Badge icon={<AlertTriangle className="h-3 w-3" />} tone="rose">Complaint</Badge>
  return <Badge icon={<Mail className="h-3 w-3" />} tone="slate">Sent</Badge>
}

function Badge({ children, icon, tone, title }: { children: React.ReactNode; icon: React.ReactNode; tone: 'emerald' | 'blue' | 'slate' | 'rose'; title?: string }) {
  const cls = {
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-500',
    rose: 'bg-rose-50 text-rose-700',
  }[tone]
  return (
    <span title={title} className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`}>
      {icon}{children}
    </span>
  )
}
