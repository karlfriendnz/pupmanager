'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { Ticket, Users, ChevronRight, CalendarDays, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export function DropInsView({ runs }: { runs: RunRow[] }) {
  const currency = useCurrency()
  // Current = still has sessions left to drop into; Past = the run's sessions
  // are all done, so nobody can drop in anymore. Same Current/Past split as
  // Group Classes.
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const current = runs.filter(r => r.upcoming.length > 0)
  const past = runs.filter(r => r.upcoming.length === 0)
  const shown = tab === 'past' ? past : current

  return (
    <>
      <PageHeader
        title="Drop-ins"
        subtitle="Single sessions of a class, sold one at a time — for people who can't commit to a whole course, or regulars filling a gap."
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
        {runs.length === 0 ? (
          <Card>
            <CardBody>
              <div className="text-center py-10 px-4">
                <Ticket className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600 font-medium">No classes are taking drop-ins</p>
                <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                  A drop-in class runs a set schedule that people can book one
                  session at a time — set the day, time and per-session price.
                </p>
                <Link href="/offerings/new?kind=dropin" className="mt-4 inline-block">
                  <Button>
                    <Plus className="h-4 w-4" /> New drop-in class
                  </Button>
                </Link>
              </div>
            </CardBody>
          </Card>
        ) : (
          <>
          {/* Current / Past — same pill-tab bar as Group Classes. */}
          <div className="flex gap-1 p-1 bg-slate-100 rounded-2xl mb-4">
            {([
              { id: 'current' as const, label: 'Current', count: current.length },
              { id: 'past' as const, label: 'Past', count: past.length },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                  tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
                <span className={`min-w-5 px-1.5 text-[11px] font-semibold tabular-nums rounded-full ${
                  tab === t.id ? 'bg-blue-100 text-blue-700' : 'bg-slate-200 text-slate-600'
                }`}>
                  {t.count}
                </span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <Card>
              <CardBody>
                <p className="py-8 text-center text-sm text-slate-400">
                  {tab === 'past' ? 'No past drop-in classes yet.' : 'No classes are currently taking drop-ins.'}
                </p>
              </CardBody>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {shown.map(r => (
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

          {/* Add sits at the BOTTOM of the list. */}
          <Link
            href="/offerings/new?kind=dropin"
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3.5 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600"
          >
            <CalendarDays className="h-4 w-4" /> New drop-in class
          </Link>
          </>
        )}
      </div>
    </>
  )
}
