'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/shared/page-header'
import { Dog, X, CalendarDays, User, MessageSquare, Phone } from 'lucide-react'
import { PuppySchoolSetup } from '@/components/trainer/puppy-school-setup'
import type { PuppySchoolSummary, WeekBoard, WeekBoardCell, BoardAttendee } from '@/lib/puppy-school'

export function PuppySchoolView({ schools, board, scheduleDays }: { schools: PuppySchoolSummary[]; board: WeekBoard; scheduleDays: number[] }) {
  const [creating, setCreating] = useState(schools.length === 0)

  // Columns filtered to the trainer's chosen weekdays (col index i → ISO i+1).
  const columns = board.columns.filter((_, i) => scheduleDays.includes(i + 1))

  // Which days each dog appears in this week (dogId → column keys), for the
  // "also here this week" quick action.
  const daysByDog = new Map<string, Set<string>>()
  for (const partKey of Object.keys(board.cells)) {
    for (const [colKey, cell] of Object.entries(board.cells[partKey])) {
      for (const a of cell.attendees) {
        if (!a.dogId) continue
        const s = daysByDog.get(a.dogId) ?? new Set<string>()
        s.add(colKey)
        daysByDog.set(a.dogId, s)
      }
    }
  }
  const colLabel = new Map(board.columns.map(c => [c.key, c.label]))

  return (
    <>
      {/* No "New school" action. A daycare has ONE day-parted offering; the
          setup form still appears automatically when there isn't one yet, and a
          second can be added from the offerings list if it's ever needed. The
          button also read as "school", which this isn't. */}
      <PageHeader title="Doggy Daycare" />

      {/* No page padding: the board runs edge to edge so a full day's dogs get
          every pixel of width. The setup form keeps its own padding — it's a
          form, not a grid, and full-bleed would leave it floating. */}
      <div className="w-full flex-1 min-h-0 flex flex-col">
        {creating ? (
          <div className="p-4 md:p-8">
            {schools.length > 0 && (
              <button onClick={() => setCreating(false)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
                <X className="h-4 w-4" /> Back to the board
              </button>
            )}
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Dog className="h-5 w-5 text-teal-600" /> {schools.length === 0 ? 'Start your doggy daycare' : 'Add a doggy daycare'}</h2>
              <p className="text-sm text-slate-500 mt-0.5">Split the day into parts parents can book — mornings, afternoons, or however you run it.</p>
            </div>
            <PuppySchoolSetup />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {/* No header row: the board is the page. What used to sit here — a
                programme chip, a week total and a day picker — either repeated
                the page title or duplicated a control that lives elsewhere
                (TrainerProfile.scheduleDays is owned by the schedule's own
                settings panel). The run detail is still at /doggy-daycare/:runId. */}
            <WeekBoardGrid board={board} columns={columns} daysByDog={daysByDog} colLabel={colLabel} />
          </div>
        )}
      </div>
    </>
  )
}

interface PopState { att: BoardAttendee; days: string[]; top: number; left: number; flip: boolean }

function WeekBoardGrid({ board, columns, daysByDog, colLabel }: { board: WeekBoard; columns: { key: string; label: string }[]; daysByDog: Map<string, Set<string>>; colLabel: Map<string, string> }) {
  const [pop, setPop] = useState<PopState | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cancelHide = () => { if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null } }
  const scheduleHide = () => { cancelHide(); hideTimer.current = setTimeout(() => setPop(null), 140) }

  const showPop = (att: BoardAttendee, el: HTMLElement) => {
    cancelHide()
    const r = el.getBoundingClientRect()
    const flip = r.right + 260 > window.innerWidth
    setPop({ att, days: [...(daysByDog.get(att.dogId) ?? [])].map(k => colLabel.get(k) ?? k), top: r.top, left: flip ? r.left - 8 : r.right + 8, flip })
  }

  if (board.parts.length === 0) {
    return (
      <div className="flex-1 min-h-0 flex items-center justify-center rounded-2xl border border-slate-200 bg-white p-10 text-center">
        <div>
          <div className="mx-auto w-11 h-11 rounded-full bg-teal-50 flex items-center justify-center mb-3"><CalendarDays className="h-5 w-5 text-teal-600" /></div>
          <p className="text-sm text-slate-600">No sessions scheduled this week yet.</p>
        </div>
      </div>
    )
  }

  // Per-day total = distinct DOGS in that column, not the sum of per-part
  // occupancy. A dog booked into both morning and afternoon is one dog here —
  // summing cell.booked across parts double-counts full-day and multi-part dogs.
  const dayTotal = (colKey: string) => {
    const dogs = new Set<string>()
    for (const p of board.parts) {
      for (const a of board.cells[p.key]?.[colKey]?.attendees ?? []) {
        if (a.dogId) dogs.add(a.dogId)
      }
    }
    return dogs.size
  }

  return (
    <>
      {/* Full-bleed: no rounding, no side border, minimal inner padding. The
          card chrome cost ~40px of width that a 40-dog day would rather spend on
          dogs. A top border keeps it visually separate from the page header.
          The padding lives on the GRID, not here: sticky offsets are measured
          from the scrollport's padding box, so padding out here would leave an
          8px strip above the pinned dates for the board to show through. */}
      <div className="flex flex-1 min-h-0 flex-col overflow-auto border-t border-slate-200 bg-white">
        <div className="grid flex-1 gap-1.5 min-w-[640px] p-2" style={{ gridTemplateColumns: `100px repeat(${columns.length}, minmax(96px, 1fr))`, gridTemplateRows: `auto repeat(${board.parts.length}, minmax(4rem, 1fr))` }}>
          {/* Header row. Pinned to the top so the dates stay readable however
              far down the board you are, and the day-part column is pinned to
              the left so a sideways swipe on a phone never loses which row is
              which. Every header item is placed EXPLICITLY in row 1 — the
              backdrop fills the whole row, so auto-placement would otherwise
              shunt the dates down to row 2.

              The backdrop exists because the header cells are separate grid
              items: without it, the 1.5 gaps between them let the board show
              through in slivers as it scrolls under. Negative margins stretch
              it over the grid's own padding and the row gap below. */}
          <div aria-hidden className="sticky top-0 z-20 bg-white" style={{ gridRow: 1, gridColumn: '1 / -1', marginLeft: -8, marginRight: -8, marginBottom: -6 }} />
          <div className="sticky top-0 left-0 z-40 bg-white -ml-2 -mr-1.5 pl-3 pb-1 flex items-end text-[11px] font-semibold uppercase tracking-wide text-slate-400" style={{ gridRow: 1, gridColumn: 1 }}>Part</div>
          {columns.map((c, i) => {
            const today = c.key === board.todayKey
            return (
              <div key={c.key} className={`sticky top-0 z-30 text-center pb-1 ${today ? 'text-teal-700' : 'text-slate-400'}`} style={{ gridRow: 1, gridColumn: i + 2 }}>
                <div className="text-[11px] font-mono font-semibold uppercase tracking-wide">{c.label}{today && ' ·'}</div>
                <div className="text-[10px] font-mono tabular-nums">{dayTotal(c.key)} booked</div>
              </div>
            )
          })}

          {/* Part rows */}
          {board.parts.map(part => (
            <PartRow
              key={part.key}
              label={part.label}
              todayKey={board.todayKey}
              cells={columns.map(c => ({ colKey: c.key, cell: board.cells[part.key]?.[c.key] }))}
              onDogEnter={showPop}
              onDogLeave={scheduleHide}
            />
          ))}
        </div>
      </div>

      {/* Hover quick-actions popover (fixed, so it escapes the cell's scroll). */}
      {pop && (
        <div
          className="fixed z-40 w-56 rounded-xl border border-slate-200 bg-white shadow-xl p-3"
          style={{ top: Math.min(pop.top, window.innerHeight - 180), left: pop.left, transform: pop.flip ? 'translateX(-100%)' : undefined }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="flex items-center gap-2 mb-2">
            <DogAvatar att={pop.att} sizeClass="h-8 w-8" />
            <div className="min-w-0">
              <div className="text-sm font-semibold text-slate-900 truncate">{pop.att.dog}</div>
              {pop.att.owner && <div className="text-xs text-slate-500 truncate">{pop.att.owner}</div>}
            </div>
          </div>
          {pop.days.length > 0 && (
            <div className="text-[11px] text-slate-500 mb-2">In this week: <span className="text-slate-700">{pop.days.join(', ')}</span></div>
          )}
          <div className="flex flex-col gap-1">
            {pop.att.phone && (
              <a href={`tel:${pop.att.phone}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><Phone className="h-4 w-4 text-slate-400" /> {pop.att.phone}</a>
            )}
            {pop.att.clientId && (
              <>
                <Link href={`/clients/${pop.att.clientId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><User className="h-4 w-4 text-slate-400" /> Owner details</Link>
                <Link href={`/messages?client=${pop.att.clientId}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"><MessageSquare className="h-4 w-4 text-slate-400" /> Message owner</Link>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function DogAvatar({ att, sizeClass = 'h-4 w-4' }: { att: BoardAttendee; sizeClass?: string }) {
  if (att.photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={att.photoUrl} alt={att.dog} className={`rounded-full object-cover shrink-0 ${sizeClass}`} />
  }
  return <span className={`grid place-items-center bg-teal-100 text-teal-700 text-[10px] font-semibold rounded-full shrink-0 ${sizeClass}`}>{att.dog.slice(0, 1).toUpperCase()}</span>
}

function PartRow({ label, cells, todayKey, onDogEnter, onDogLeave }: {
  label: string
  cells: { colKey: string; cell: WeekBoardCell | undefined }[]
  todayKey: string
  onDogEnter: (att: BoardAttendee, el: HTMLElement) => void
  onDogLeave: () => void
}) {
  return (
    <>
      {/* Pinned left, and stretched over the gaps around it (-mb/-mr-1.5) so the
          board doesn't flash through the joins on a sideways swipe. */}
      <div className="sticky left-0 z-10 flex items-center bg-white -ml-2 -mb-1.5 -mr-1.5 pl-2 pr-2.5 text-sm font-semibold text-slate-700">{label}</div>
      {cells.map(({ colKey, cell }, i) => {
        const today = colKey === todayKey
        if (!cell) return <div key={i} className={`rounded-lg border min-h-[64px] ${today ? 'bg-teal-50/40 border-teal-100' : 'bg-slate-50 border-slate-100'}`} />
        const full = cell.capacity != null && cell.booked >= cell.capacity
        const pct = cell.capacity ? Math.min(100, Math.round((cell.booked / cell.capacity) * 100)) : cell.booked > 0 ? 100 : 0
        return (
          <div key={i} className={`rounded-lg border p-2 flex flex-col gap-1.5 min-h-[64px] ${today ? 'bg-teal-50/40 border-teal-200' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between">
              <span className={`font-mono text-xs font-semibold ${full ? 'text-amber-600' : 'text-teal-700'}`}>{cell.booked}{cell.capacity != null ? `/${cell.capacity}` : ''}</span>
              {cell.waitlist > 0 && <span className="font-mono text-[9.5px] text-amber-600">+{cell.waitlist} wait</span>}
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <div className={`h-full rounded-full ${full ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
            </div>
            {/* Two dogs per row: a full daycare day runs to 40 dogs, and one per
                row turned a single cell into a very long scroll. The avatar
                shrinks to match so the name still has room to read. */}
            {cell.attendees.length > 0 && (
              <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-0.5 pr-0.5 content-start">
                {cell.attendees.map((a, j) => (
                  <div
                    key={j}
                    onMouseEnter={e => onDogEnter(a, e.currentTarget)}
                    onMouseLeave={onDogLeave}
                    className="flex min-w-0 items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-1 py-1 text-[13px] text-slate-700 cursor-default hover:border-teal-300 hover:bg-teal-50/40"
                  >
                    <DogAvatar att={a} sizeClass="h-6 w-6 shrink-0" />
                    <span className="truncate">{a.dog}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
