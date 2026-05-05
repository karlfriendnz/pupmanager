import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Inbox, ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Enquiries' }

const TABS = [
  { key: 'NEW',      label: 'New' },
  { key: 'ACCEPTED', label: 'Accepted' },
  { key: 'DECLINED', label: 'Declined' },
] as const

type TabKey = typeof TABS[number]['key']

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/onboarding')

  const sp = await searchParams
  const tab: TabKey = (TABS.find(t => t.key === sp.tab)?.key) ?? 'NEW'

  const [counts, enquiries] = await Promise.all([
    prisma.enquiry.groupBy({
      by: ['status'],
      where: { trainerId },
      _count: { _all: true },
    }),
    prisma.enquiry.findMany({
      where: { trainerId, status: tab },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, phone: true,
        dogName: true, dogBreed: true, message: true,
        status: true, viewedAt: true, createdAt: true,
        clientProfileId: true,
      },
    }),
  ])

  const countByStatus = Object.fromEntries(counts.map(c => [c.status, c._count._all]))

  return (
    <div className="p-4 md:p-8 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Enquiries</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Form submissions awaiting your decision. Accept turns them into a client; decline closes them out.
        </p>
      </div>

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/enquiries${t.key === 'NEW' ? '' : `?tab=${t.key}`}`}
            className={cn(
              'px-4 py-2.5 text-sm font-medium relative -mb-px',
              tab === t.key ? 'text-violet-700 border-b-2 border-violet-600' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
            {countByStatus[t.key] != null && countByStatus[t.key] > 0 && (
              <span className={cn(
                'ml-1.5 inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full text-[11px] tabular-nums',
                tab === t.key ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500',
              )}>
                {countByStatus[t.key]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {enquiries.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="flex flex-col gap-2">
          {enquiries.map(e => (
            <Link key={e.id} href={`/enquiries/${e.id}`} className="block">
              <Card className={cn(
                'p-4 hover:border-violet-200 transition-colors',
                tab === 'NEW' && !e.viewedAt && 'border-violet-200 bg-violet-50/30',
              )}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-slate-900 truncate">{e.name}</p>
                      {tab === 'NEW' && !e.viewedAt && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-600 text-white uppercase tracking-wide">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 truncate">
                      {e.email}
                      {e.phone && <span> · {e.phone}</span>}
                    </p>
                    {(e.dogName || e.dogBreed) && (
                      <p className="text-xs text-slate-500 mt-0.5 truncate">
                        🐶 {e.dogName ?? '—'}{e.dogBreed ? ` · ${e.dogBreed}` : ''}
                      </p>
                    )}
                    {e.message && (
                      <p className="text-sm text-slate-600 mt-2 line-clamp-2 italic">
                        &ldquo;{e.message}&rdquo;
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <span className="text-[11px] text-slate-400 tabular-nums">{timeAgo(e.createdAt)}</span>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ tab }: { tab: TabKey }) {
  const Icon = tab === 'ACCEPTED' ? CheckCircle2 : tab === 'DECLINED' ? XCircle : Inbox
  const label =
    tab === 'NEW'      ? 'No new enquiries — once someone submits one of your forms, it lands here.'
  : tab === 'ACCEPTED' ? 'No accepted enquiries yet.'
  :                      'No declined enquiries.'
  return (
    <Card className="p-8 flex flex-col items-center text-center gap-2">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm text-slate-500 max-w-sm">{label}</p>
    </Card>
  )
}

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return date.toLocaleDateString()
}
