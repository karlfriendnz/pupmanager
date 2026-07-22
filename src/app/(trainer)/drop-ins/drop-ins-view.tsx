'use client'

import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { Ticket, Users, ChevronRight, CalendarDays } from 'lucide-react'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'

type RunRow = {
  id: string
  name: string
  scheduleNote: string | null
  startLabel: string
  capacity: number | null
  enrolled: number
  spacesLeft: number | null
  /** MINOR units (cents) — pass straight to formatMoney, which divides by 100. */
  dropInPriceCents: number | null
  dropInCount: number
  upcoming: { id: string; index: number | null; label: string }[]
}

type RecentRow = {
  id: string
  status: string
  runId: string
  runName: string
  clientName: string
  dogName: string | null
  joinedAtIndex: number | null
  whenLabel: string
}

export function DropInsView({ runs, recent }: { runs: RunRow[]; recent: RecentRow[] }) {
  const currency = useCurrency()

  return (
    <>
      <PageHeader
        title="Drop-ins"
        subtitle="Single sessions of a class, sold one at a time — for people who can't commit to a whole course, or regulars filling a gap."
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto flex flex-col gap-8">
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Classes taking drop-ins
          </h2>

          {runs.length === 0 ? (
            <Card>
              <CardBody>
                <div className="text-center py-10 px-4">
                  <Ticket className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600 font-medium">No classes are taking drop-ins</p>
                  <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                    Drop-ins are switched on per program. Open a group program, tick
                    &ldquo;Allow drop-ins&rdquo; and set a per-session price — any class running
                    from it will show up here.
                  </p>
                  <Link
                    href="/packages"
                    className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
                  >
                    Go to programs <ChevronRight className="h-4 w-4" />
                  </Link>
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {runs.map(r => (
                <Link key={r.id} href={`/classes/${r.id}`} className="block">
                  <Card className="hover:border-blue-200 transition-colors">
                    <CardBody className="py-4">
                      <div className="flex items-center gap-4">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 flex-shrink-0">
                          <Ticket className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="font-medium text-slate-900 break-words">{r.name}</p>
                            {r.dropInPriceCents != null && (
                              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                                {formatMoney(r.dropInPriceCents, currency)} / session
                              </span>
                            )}
                            {r.dropInCount > 0 && (
                              <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                {r.dropInCount} drop-in{r.dropInCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {r.startLabel}
                            {r.scheduleNote ? ` · ${r.scheduleNote}` : ''}
                            {r.upcoming.length > 0 && (
                              <span className="text-slate-400">
                                {' '}· next {r.upcoming[0].label}
                              </span>
                            )}
                          </p>
                          {r.upcoming.length === 0 && (
                            <p className="text-xs text-amber-600 mt-0.5">
                              No sessions left to drop into
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-0.5 flex-shrink-0 text-sm">
                          <span className="flex items-center gap-1.5 text-slate-600">
                            <Users className="h-4 w-4 text-slate-400" />
                            {r.enrolled}
                            {r.capacity != null && <span className="text-slate-400">/ {r.capacity}</span>}
                          </span>
                          {r.spacesLeft != null && (
                            <span className={`text-[11px] ${r.spacesLeft === 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                              {r.spacesLeft === 0 ? 'Full' : `${r.spacesLeft} space${r.spacesLeft === 1 ? '' : 's'}`}
                            </span>
                          )}
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Recent drop-ins
          </h2>
          {recent.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-400 py-6 text-center">
                  Nobody has dropped in yet. Add one from a class&apos;s roster — pick
                  &ldquo;Drop-in&rdquo; instead of the full course.
                </p>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardBody className="p-0">
                <ul className="divide-y divide-slate-100">
                  {recent.map(e => (
                    <li key={e.id}>
                      <Link
                        href={`/classes/${e.runId}`}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
                      >
                        <CalendarDays className="h-4 w-4 text-slate-300 flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 truncate">
                            {e.clientName}
                            {e.dogName && <span className="text-slate-400"> · {e.dogName}</span>}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {e.runName}
                            {e.joinedAtIndex != null && ` · joined at session ${e.joinedAtIndex}`}
                          </p>
                        </div>
                        <span className="text-xs text-slate-400 flex-shrink-0">{e.whenLabel}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </section>
      </div>
    </>
  )
}
