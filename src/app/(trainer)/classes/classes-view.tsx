'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { Plus, GraduationCap, Users, ChevronRight } from 'lucide-react'
import { ConnectPaymentsModal } from '../settings/connect-payments-prompt'

type RunRow = {
  id: string
  name: string
  scheduleNote: string | null
  startLabel: string
  status: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  sessionCount: number
  enrolledCount: number
  capacity: number | null
  imageUrl: string | null
  trainerNames: string[]
  isPast: boolean
}

const STATUS_STYLE: Record<RunRow['status'], string> = {
  SCHEDULED: 'bg-blue-50 text-blue-700',
  RUNNING: 'bg-emerald-50 text-emerald-700',
  COMPLETED: 'bg-slate-100 text-slate-600',
  CANCELLED: 'bg-red-50 text-red-600',
}

// Creating a class lives in the offerings wizard (/offerings/new?kind=group) —
// the one place a class is defined AND scheduled. This list only links to it.
export function ClassesView({ runs, connectName: initialConnectName = null, currency = 'NZD' }: { runs: RunRow[]; connectName?: string | null; currency?: string }) {
  // Set (to the new class's name) when the wizard bounced back here after
  // creating a priced class and Stripe isn't connected yet.
  const [connectName, setConnectName] = useState<string | null>(initialConnectName)
  const [tab, setTab] = useState<'current' | 'past'>('current')

  // Server hands the list back newest-start-first. Current classes read better
  // soonest-first (what's on next), past ones most-recent-first.
  const current = runs.filter(r => !r.isPast).reverse()
  const past = runs.filter(r => r.isPast)
  const shown = tab === 'past' ? past : current

  return (
    <>
      {/* Creating happens from the top control-bar "+" (New offering). */}
      <PageHeader
        title="Group Classes"
        subtitle="Run a class — pick the day, time and how many weeks. Clients enrol into one shared timetable with a roster, capacity and waitlist."
      />

      <div className="p-4 md:p-8 w-full max-w-3xl md:max-w-5xl xl:max-w-7xl mx-auto">
      {runs.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10 px-4">
              <GraduationCap className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600 font-medium">No classes yet</p>
              <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                Create your first class — e.g. &ldquo;Puppy Class, Thursdays 4pm for 6 weeks&rdquo;.
              </p>
              <Link href="/offerings/new?kind=group" className="mt-4 inline-block">
                <Button>
                  <Plus className="h-4 w-4" /> New class
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
        {/* Current / Past — same pill-tab bar as the client profile, so a long
            history of finished classes doesn't bury what's running now. */}
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
              <div className="text-center py-10 px-4">
                <GraduationCap className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-600 font-medium">
                  {tab === 'past' ? 'No past classes' : 'No current classes'}
                </p>
                <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                  {tab === 'past'
                    ? 'Classes move here once their last session has been, or when you mark them complete or cancelled.'
                    : 'Every class you have has finished. Start a new one to fill the calendar.'}
                </p>
                {tab === 'current' && (
                  <Link href="/offerings/new?kind=group" className="mt-4 inline-block">
                    <Button>
                      <Plus className="h-4 w-4" /> New class
                    </Button>
                  </Link>
                )}
              </div>
            </CardBody>
          </Card>
        ) : (
        <div className="flex flex-col gap-3">
          {shown.map(r => (
            <Link key={r.id} href={`/classes/${r.id}`} className="block">
              <Card className="hover:border-blue-200 transition-colors">
                <CardBody className="py-4">
                  <div className="flex items-center gap-4">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={r.imageUrl}
                        alt=""
                        className="h-11 w-11 rounded-xl object-cover flex-shrink-0 border border-slate-200"
                      />
                    ) : (
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
                        <GraduationCap className="h-5 w-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      {/* Title gets the full row; the status chip wraps beneath it
                          on a narrow phone instead of squeezing the name to
                          "Reactiv…". */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-medium text-slate-900 break-words">{r.name}</p>
                        <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}>
                          {r.status.toLowerCase()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {r.startLabel} ·{' '}
                        {r.scheduleNote || `${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'}`}
                        {r.trainerNames.length > 0 && <span className="text-slate-400"> · {r.trainerNames.join(', ')}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-slate-600 flex-shrink-0">
                      <Users className="h-4 w-4 text-slate-400" />
                      {r.enrolledCount}
                      {r.capacity != null && <span className="text-slate-400">/ {r.capacity}</span>}
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
          href="/offerings/new?kind=group"
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 py-3.5 text-sm font-medium text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600"
        >
          <Plus className="h-4 w-4" /> New class
        </Link>
        </>
      )}

      {connectName && (
        <ConnectPaymentsModal onClose={() => setConnectName(null)} currency={currency} />
      )}
      </div>
    </>
  )
}
