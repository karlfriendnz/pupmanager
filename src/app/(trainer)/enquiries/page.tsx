import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Card } from '@/components/ui/card'
import { PhoneRowList } from '@/components/shared/flat-list'
import { cn } from '@/lib/utils'
import { Inbox, ArrowRight, CheckCircle2, XCircle } from 'lucide-react'
import { PageHeader } from '@/components/shared/page-header'
import { AddonNudge } from '@/components/shared/addon-nudge'
import { isNudgeDismissed } from '@/lib/nudge-dismissals'
import { addonNudge } from '@/components/shared/addon-nudge-registry'
import { hasAddon } from '@/lib/billing'
import { JoinRequestActions } from './join-request-actions'
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
  if (!trainerId) redirect('/login')

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
        clientProfileId: true, source: true,
      },
    }),
  ])

  const countByStatus = Object.fromEntries(counts.map(c => [c.status, c._count._all]))

  // Nudge: promote lead magnets (capture emails, grow the list) to trainers
  // fielding enquiries, unless they've already switched it on.
  const isDevPreview = process.env.NODE_ENV === 'development'
  const leadMagnetNudge = addonNudge('leadmagnets')
  const showLeadMagnetNudge = !(await hasAddon(trainerId, 'leadmagnets')) && !!leadMagnetNudge
  const leadMagnetNudgeDismissed = await isNudgeDismissed(session.user.id, 'enquiries-leadmagnets')

  return (
    <>
      <PageHeader title="Enquiries" />
      {/* The shell reserves pb-20 (80px) for the phone tab bar, but that bar is
          58px PLUS env(safe-area-inset-bottom) — ~92px on a notched iPhone — so
          the last row's tap area ends up under it. Emulators report a 0px inset,
          which is why this only shows on a real device. */}
      <div
        className="w-full p-4 md:p-8"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
      >
      {/* The same underline tabs as every other list, down to the class names
          — these stay <Link>s rather than becoming OfferingTabs because the
          chosen tab lives in the URL, which is what makes an enquiry you were
          sent a link to open on the right one. What changes is the LOOK: the
          violet underline and the filled count chips were decorative colour
          on a screen that has none anywhere else, and a trainer moving here
          from Classes had to work out that the same control was the same
          control. */}
      <div className="mb-3 flex gap-5 overflow-x-auto no-scrollbar border-b border-slate-200">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/enquiries${t.key === 'NEW' ? '' : `?tab=${t.key}`}`}
            className={cn(
              '-mb-px shrink-0 border-b-2 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-700',
            )}
          >
            {t.label}
            {countByStatus[t.key] != null && (
              <span className="ml-1.5 text-[11px] font-normal tabular-nums text-slate-400">
                {countByStatus[t.key]}
              </span>
            )}
          </Link>
        ))}
      </div>

      {enquiries.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <PhoneRowList className="md:flex md:flex-col md:gap-2">
          {enquiries.map(e => {
            // A dog owner who signed themselves up and asked to be added. There
            // is nothing to read before deciding, so the two buttons sit on the
            // row — one tap and acceptEnquiry makes them a client.
            const isJoinRequest = e.source === 'SELF_SIGNUP'
            const quickActions = isJoinRequest && e.status === 'NEW'
            return (
              <Card key={e.id} className={cn(
                'px-4 py-3 md:p-4 hover:border-violet-200 transition-colors',
                // Phone: a row in the shared block.
                'rounded-none border-0 shadow-none md:rounded-2xl md:border md:shadow-sm',
                tab === 'NEW' && !e.viewedAt && 'border-violet-200 bg-violet-50/30',
              )}>
                {/* The Card wraps the Link (rather than the other way round) so
                    the accept/decline buttons can live inside the same block —
                    a <button> inside an <a> is invalid. */}
                <Link
                  href={`/enquiries/${e.id}`}
                  // `active:` gives the tap an immediate pressed state. `hover:` is
                  // `@media (hover:hover)` in Tailwind v4, so on a phone the row had
                  // no feedback at all between the tap and the next screen painting.
                  className="block min-h-14 active:opacity-70"
                >
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
                      {isJoinRequest && (
                        <p className="text-xs font-medium text-slate-600 mb-0.5">
                          Wants to join you · signed up themselves
                        </p>
                      )}
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
                </Link>
                {quickActions && (
                  <div className="mt-3 flex justify-end border-t border-slate-200 pt-3">
                    <JoinRequestActions enquiryId={e.id} name={e.name} />
                  </div>
                )}
              </Card>
            )
          })}
        </PhoneRowList>
      )}
      </div>
      {showLeadMagnetNudge && leadMagnetNudge && (
        <AddonNudge id="enquiries-leadmagnets" {...leadMagnetNudge} forceShow={isDevPreview} dismissed={leadMagnetNudgeDismissed} />
      )}
    </>
  )
}

function EmptyState({ tab }: { tab: TabKey }) {
  const Icon = tab === 'ACCEPTED' ? CheckCircle2 : tab === 'DECLINED' ? XCircle : Inbox
  const label =
    tab === 'NEW'      ? 'No new enquiries — form submissions and people asking to join you land here.'
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
