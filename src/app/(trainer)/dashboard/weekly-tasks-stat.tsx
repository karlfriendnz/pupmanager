'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { ChevronDown, ChevronRight, ListChecks, Dog, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface WeeklyTask {
  id: string
  title: string
  date: string         // ISO date
  clientId: string
  clientName: string
  dogName: string | null
  completed: boolean
}

/**
 * Drop-in replacement for the static "Tasks this week" StatCard. Click to
 * expand a panel listing every task scheduled to clients in the last 7 days,
 * with completion state and a link through to the client's profile.
 */
export function WeeklyTasksStat({ tasks }: { tasks: WeeklyTask[] }) {
  const [open, setOpen] = useState(false)
  const completedCount = tasks.filter(t => t.completed).length

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="text-left group cursor-pointer h-full"
        aria-expanded={open}
      >
        <Card className="p-4 h-full flex flex-col gap-2 group-hover:border-blue-200 group-hover:shadow-sm transition-all">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tasks this week</p>
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 flex-shrink-0">
              <ListChecks className="h-3.5 w-3.5" aria-hidden />
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-2xl font-bold tabular-nums leading-none text-slate-900">
              {tasks.length}
            </p>
            {open
              ? <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
              : <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />}
          </div>
          {/* Reserved height-matching slot — StatCard pins a progress bar
              to the bottom; this card has no progress so the slot stays
              hidden but keeps the card the same height as siblings. */}
          <div className="mt-auto h-1.5" aria-hidden />
        </Card>
      </button>

      {open && (
        // The expanded panel takes the full grid width below the stat cards.
        <div className="col-span-2 md:col-span-4 -mt-1">
          <Card className="overflow-hidden">
            <div className="px-5 py-3 flex items-center justify-between border-b border-slate-100">
              <p className="text-sm font-semibold text-slate-900">Tasks this week</p>
              <p className="text-xs text-slate-500">{completedCount} of {tasks.length} completed</p>
            </div>
            {tasks.length === 0 ? (
              <p className="text-sm text-slate-400 px-5 py-6 text-center">No tasks assigned in the last 7 days.</p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                {tasks.map(t => {
                  const d = new Date(t.date)
                  return (
                    <Link
                      key={t.id}
                      href={`/clients/${t.clientId}`}
                      className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors"
                    >
                      <span className={cn(
                        'h-6 w-6 rounded-full flex items-center justify-center flex-shrink-0',
                        t.completed ? 'bg-emerald-100 text-emerald-700' : 'border border-slate-200 text-slate-300'
                      )}>
                        {t.completed && <Check className="h-3.5 w-3.5" aria-hidden />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 truncate">{t.title}</p>
                        <p className="text-xs text-slate-500 truncate inline-flex items-center gap-1">
                          {t.clientName}
                          {t.dogName && <>
                            <span className="text-slate-300">·</span>
                            <Dog className="h-3 w-3 text-slate-400" aria-hidden />{t.dogName}
                          </>}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400 flex-shrink-0">
                        {d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  )
}
