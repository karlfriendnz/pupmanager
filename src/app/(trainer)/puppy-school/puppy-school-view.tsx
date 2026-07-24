'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/page-header'
import { Dog, Plus, X, CalendarDays } from 'lucide-react'
import { PuppySchoolSetup } from '@/components/trainer/puppy-school-setup'
import type { PuppySchoolSummary, WeekBoard } from '@/lib/puppy-school'

export function PuppySchoolView({ schools, board }: { schools: PuppySchoolSummary[]; board: WeekBoard }) {
  // Land straight in setup when there's nothing yet; otherwise show the board.
  const [creating, setCreating] = useState(schools.length === 0)

  return (
    <>
      <PageHeader
        title="Puppy School"
        actions={
          schools.length > 0 && !creating ? (
            <button onClick={() => setCreating(true)} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700">
              <Plus className="h-4 w-4" /> <span className="hidden sm:inline">New school</span>
            </button>
          ) : undefined
        }
      />

      <div className="p-4 md:p-8 w-full flex-1 min-h-0 flex flex-col">
        {creating ? (
          <div>
            {schools.length > 0 && (
              <button onClick={() => setCreating(false)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                <X className="h-4 w-4" /> Back to the board
              </button>
            )}
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Dog className="h-5 w-5 text-teal-600" /> {schools.length === 0 ? 'Start your puppy school' : 'Add a puppy school'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">Split the day into parts parents can book — mornings, afternoons, or however you run it.</p>
            </div>
            <PuppySchoolSetup />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* Schools list + this-week stat */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex flex-wrap items-center gap-2">
                {schools.map(s => (
                  <span key={s.id} className="inline-flex items-center gap-2 rounded-full bg-teal-50 border border-teal-200 text-teal-800 text-sm px-3 py-1">
                    <Dog className="h-3.5 w-3.5" /> {s.name}
                    <span className="text-teal-500 text-xs">{s.dayParts} part{s.dayParts === 1 ? '' : 's'} · {s.days} day{s.days === 1 ? '' : 's'}</span>
                    {s.runId && <Link href={`/classes/${s.runId}`} className="text-teal-600 underline text-xs">manage</Link>}
                  </span>
                ))}
              </div>
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-500"><CalendarDays className="h-4 w-4" /> {board.totalBooked} booked this week</span>
            </div>

            <WeekBoardGrid board={board} />
          </div>
        )}
      </div>
    </>
  )
}

function WeekBoardGrid({ board }: { board: WeekBoard }) {
  if (board.parts.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <div className="mx-auto w-11 h-11 rounded-full bg-teal-50 flex items-center justify-center mb-3"><CalendarDays className="h-5 w-5 text-teal-600" /></div>
        <p className="text-sm text-slate-600">No sessions scheduled this week yet.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3">
      <div className="grid flex-1 gap-1.5 min-w-[640px]" style={{ gridTemplateColumns: `100px repeat(${board.columns.length}, minmax(78px, 1fr))`, gridTemplateRows: `auto repeat(${board.parts.length}, minmax(3.5rem, 1fr))` }}>
        {/* Header row */}
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-1 flex items-end pb-1">Part</div>
        {board.columns.map(c => (
          <div key={c.key} className="text-[11px] font-mono font-semibold uppercase tracking-wide text-slate-400 text-center pb-1">{c.label}</div>
        ))}

        {/* Part rows */}
        {board.parts.map(part => (
          <PartRow key={part.key} label={part.label} cells={board.columns.map(c => board.cells[part.key]?.[c.key])} />
        ))}
      </div>
    </div>
  )
}

function PartRow({ label, cells }: { label: string; cells: (import('@/lib/puppy-school').WeekBoardCell | undefined)[] }) {
  return (
    <>
      <div className="flex items-center text-sm font-semibold text-slate-700 pr-1">{label}</div>
      {cells.map((cell, i) => {
        if (!cell) return <div key={i} className="rounded-lg bg-slate-50 border border-slate-100 min-h-[58px]" />
        const full = cell.capacity != null && cell.booked >= cell.capacity
        const pct = cell.capacity ? Math.min(100, Math.round((cell.booked / cell.capacity) * 100)) : cell.booked > 0 ? 100 : 0
        return (
          <div key={i} className="rounded-lg bg-slate-50 border border-slate-200 p-2 flex flex-col gap-1.5 min-h-[58px]">
            <div className="flex items-center justify-between">
              <span className={`font-mono text-xs font-semibold ${full ? 'text-amber-600' : 'text-teal-700'}`}>
                {cell.booked}{cell.capacity != null ? `/${cell.capacity}` : ''}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
            </div>
            {cell.waitlist > 0 && <span className="font-mono text-[9.5px] text-amber-600">+{cell.waitlist} wait</span>}
          </div>
        )
      })}
    </>
  )
}
