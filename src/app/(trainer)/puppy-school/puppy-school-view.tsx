'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { PageHeader } from '@/components/shared/page-header'
import { Dog, Plus, X, CalendarDays, SlidersHorizontal, User, MessageSquare, Loader2 } from 'lucide-react'
import { PuppySchoolSetup } from '@/components/trainer/puppy-school-setup'
import type { PuppySchoolSummary, WeekBoard, WeekBoardCell, BoardAttendee } from '@/lib/puppy-school'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] // index i → ISO weekday i+1

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
            {/* Schools + this-week stat + day config */}
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
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm text-slate-500"><CalendarDays className="h-4 w-4" /> {board.totalBooked} booked this week</span>
                <DaysConfig scheduleDays={scheduleDays} />
              </div>
            </div>

            <WeekBoardGrid board={board} columns={columns} daysByDog={daysByDog} colLabel={colLabel} />
          </div>
        )}
      </div>
    </>
  )
}

// Which weekdays the board (and scheduler — same setting) shows.
function DaysConfig({ scheduleDays }: { scheduleDays: number[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Set<number>>(new Set(scheduleDays))
  const [saving, setSaving] = useState(false)

  const toggle = (d: number) => setDraft(prev => {
    const n = new Set(prev)
    if (n.has(d)) { if (n.size > 1) n.delete(d) } else n.add(d)
    return n
  })
  async function save() {
    setSaving(true)
    await fetch('/api/trainer/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scheduleDays: [...draft].sort((a, b) => a - b) }) }).catch(() => {})
    setSaving(false); setOpen(false); router.refresh()
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
        <SlidersHorizontal className="h-4 w-4 text-slate-400" /> Days
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white shadow-lg p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Days shown (also sets your schedule)</div>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABELS.map((label, i) => {
              const d = i + 1, on = draft.has(d)
              return <button key={d} onClick={() => toggle(d)} className={`h-8 px-2.5 rounded-lg text-xs font-medium border ${on ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}>{label}</button>
            })}
          </div>
          <div className="flex items-center justify-end gap-3 mt-3">
            <button onClick={() => { setDraft(new Set(scheduleDays)); setOpen(false) }} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 text-sm font-medium text-teal-700 disabled:opacity-60">{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</button>
          </div>
        </div>
      )}
    </div>
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

  // Per-day totals (sum booked across parts for each visible column).
  const dayTotal = (colKey: string) => board.parts.reduce((n, p) => n + (board.cells[p.key]?.[colKey]?.booked ?? 0), 0)

  return (
    <>
      <div className="flex flex-1 min-h-0 flex-col overflow-x-auto rounded-2xl border border-slate-200 bg-white p-3">
        <div className="grid flex-1 gap-1.5 min-w-[640px]" style={{ gridTemplateColumns: `100px repeat(${columns.length}, minmax(96px, 1fr))`, gridTemplateRows: `auto repeat(${board.parts.length}, minmax(4rem, 1fr))` }}>
          {/* Header row */}
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-1 flex items-end pb-1">Part</div>
          {columns.map(c => {
            const today = c.key === board.todayKey
            return (
              <div key={c.key} className={`text-center pb-1 ${today ? 'text-teal-700' : 'text-slate-400'}`}>
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
      <div className="flex items-center text-sm font-semibold text-slate-700 pr-1">{label}</div>
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
            {cell.attendees.length > 0 && (
              <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 pr-0.5">
                {cell.attendees.map((a, j) => (
                  <div
                    key={j}
                    onMouseEnter={e => onDogEnter(a, e.currentTarget)}
                    onMouseLeave={onDogLeave}
                    className="flex items-center gap-1 truncate rounded bg-white border border-slate-200 px-1 py-0.5 text-[11px] text-slate-700 cursor-default hover:border-teal-300 hover:bg-teal-50/40"
                  >
                    <DogAvatar att={a} sizeClass="h-4 w-4" />
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
