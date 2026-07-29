'use client'

// One day-part on one day: who's in, who to add, and the limit.
//
// A full screen rather than a popover, per the house rule — registering a dog
// means searching a client book and picking a dog, which is more than three
// choices and never fitted in a 56px menu hanging off a cell.
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { X, Search, Loader2, Check, UserPlus, ArrowLeft, ChevronRight, Users } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import type { WeekBoardCell, BoardAttendee } from '@/lib/puppy-school'

/** One tappable "register this dog" row: a client paired with one of their dogs. */
interface DogOption { clientId: string; clientName: string; dogId: string; dogName: string; photoUrl: string | null }

interface ApiClient {
  id: string
  name: string | null
  dogs?: { id: string; name: string; photoUrl: string | null }[]
}

export function DaycareDaySheet({
  partLabel,
  dateLabel,
  weekdayLabel,
  cell,
  onClose,
}: {
  partLabel: string
  dateLabel: string
  /** "Wednesday" — the limit applies to this weekday every week, so it's named. */
  weekdayLabel: string
  cell: WeekBoardCell
  onClose: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<'day' | 'pick'>('day')

  // Two scrollbars on screen at once is the rule this would break: the board is
  // still mounted behind, so the body is pinned for as long as the sheet is up.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape steps back through the sheet before it closes it.
      if (step === 'pick') setStep('day')
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, onClose])

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        {/* Title row + the way out, on every step. The column is centred so the
            sheet doesn't hug the left edge of a wide desktop window — the header
            and the body share the same measure. */}
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 shrink-0 w-full max-w-2xl mx-auto">
          {step === 'pick' ? (
            <button onClick={() => setStep('day')} aria-label="Back" className="-ml-1 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              <ArrowLeft className="h-5 w-5" strokeWidth={1.75} />
            </button>
          ) : (
            <button onClick={onClose} aria-label="Close" className="-ml-1 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100">
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          )}
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-900 truncate">
              {step === 'pick' ? 'Register a dog' : dateLabel}
            </div>
            <div className="text-xs text-slate-500 truncate">{partLabel}</div>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar">
          {step === 'day'
            ? <DayStep cell={cell} weekdayLabel={weekdayLabel} onRegister={() => setStep('pick')} onSaved={() => router.refresh()} />
            : <PickStep cell={cell} onDone={() => { router.refresh(); setStep('day') }} />}
        </div>
      </div>
    </ModalPortal>
  )
}

function DayStep({
  cell,
  weekdayLabel,
  onRegister,
  onSaved,
}: {
  cell: WeekBoardCell
  weekdayLabel: string
  onRegister: () => void
  onSaved: () => void
}) {
  const full = cell.capacity != null && cell.booked >= cell.capacity

  return (
    <div className="p-4 flex flex-col gap-5 w-full max-w-2xl mx-auto">
      {/* One bordered block per thing, hairline dividers inside — not a stack of
          floating cards. */}
      <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm text-slate-600">In today</span>
          <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
            {cell.booked}{cell.capacity != null ? ` / ${cell.capacity}` : ''}
          </span>
        </div>
        {cell.waitlist > 0 && (
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-slate-600">Waiting</span>
            <span className="font-mono text-sm font-semibold text-amber-600 tabular-nums">{cell.waitlist}</span>
          </div>
        )}
        {/* A part that's been and gone can't take a booking — the server refuses
            it, so the row says why rather than letting the tap fail. */}
        <button
          onClick={onRegister}
          disabled={!cell.runId || cell.closed}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-slate-50 disabled:hover:bg-white disabled:opacity-60 disabled:cursor-default"
        >
          <UserPlus className="h-5 w-5 text-slate-700 shrink-0" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">Register a dog</span>
            <span className="block text-xs text-slate-500">
              {cell.closed
                ? 'This part has already run — mark who came on the day itself.'
                : full
                  ? 'This part is full — a new booking goes on the waitlist.'
                  : 'Book one of your clients’ dogs into this part.'}
            </span>
          </span>
          {!cell.closed && <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.75} />}
        </button>
      </div>

      <LimitBlock cell={cell} weekdayLabel={weekdayLabel} onSaved={onSaved} />

      {/* Who's here. */}
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2 px-1">
          {cell.attendees.length > 0 ? `${cell.attendees.length} here` : 'Nobody yet'}
        </div>
        {cell.attendees.length === 0 ? (
          <div className="rounded-xl border border-slate-200 px-4 py-8 text-center">
            <Users className="h-6 w-6 mx-auto text-slate-300 mb-2" strokeWidth={1.75} />
            <p className="text-sm text-slate-500">No dogs booked into this part yet.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {cell.attendees.map((a, i) => <AttendeeRow key={i} att={a} />)}
          </div>
        )}
      </div>

      {cell.runId && (
        <Link
          href={`/doggy-daycare/${cell.runId}/sessions/${cell.sessionId}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900 px-1"
        >
          Open the whole day <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
        </Link>
      )}
    </div>
  )
}

function AttendeeRow({ att }: { att: BoardAttendee }) {
  const inner = (
    <>
      {att.photoUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={att.photoUrl} alt={att.dog} className="h-9 w-9 rounded-full object-cover shrink-0" />
        : <span className="h-9 w-9 grid place-items-center rounded-full bg-slate-100 text-slate-500 text-xs font-semibold shrink-0">{att.dog.slice(0, 1).toUpperCase()}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-slate-900 truncate">{att.dog}</span>
        {att.owner && <span className="block text-xs text-slate-500 truncate">{att.owner}</span>}
      </span>
    </>
  )
  if (!att.clientId) return <div className="flex items-center gap-3 px-4 py-3">{inner}</div>
  return (
    <Link href={`/clients/${att.clientId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
      {inner}
      <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.75} />
    </Link>
  )
}

function LimitBlock({ cell, weekdayLabel, onSaved }: { cell: WeekBoardCell; weekdayLabel: string; onSaved: () => void }) {
  const [value, setValue] = useState(cell.capacity == null ? '' : String(cell.capacity))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = value.trim() !== (cell.capacity == null ? '' : String(cell.capacity))

  async function save() {
    if (!cell.slotId) return
    setError(null)
    setSaved(false)
    const t = value.trim()
    const capacity = t === '' ? null : Math.floor(Number(t))
    if (capacity !== null && (!Number.isFinite(capacity) || capacity < 0)) {
      setError('Give a whole number of dogs, or leave it blank for no limit.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/trainer/daycare/slots/${cell.slotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacity }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? 'Could not save the limit — please try again.')
        return
      }
      setSaved(true)
      onSaved()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!cell.slotId) return null

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <label htmlFor="daycare-limit" className="block text-sm font-semibold text-slate-900">How many dogs fit</label>
      {/* The limit lives on the day-part, not the date — so say which days it
          moves before the trainer finds out by looking at next week. */}
      <p className="text-xs text-slate-500 mt-0.5">
        Applies to this part every {weekdayLabel}. Leave it blank for no limit.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <input
          id="daycare-limit"
          value={value}
          onChange={e => { setValue(e.target.value.replace(/[^0-9]/g, '')); setSaved(false) }}
          inputMode="numeric"
          placeholder="No limit"
          className="h-10 w-28 rounded-lg border border-slate-200 px-3 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-slate-900 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />} Save limit
        </button>
        {saved && !saving && (
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
            <Check className="h-4 w-4" strokeWidth={1.75} /> Saved
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
    </div>
  )
}

function PickStep({ cell, onDone }: { cell: WeekBoardCell; onDone: () => void }) {
  const [q, setQ] = useState('')
  const [options, setOptions] = useState<DogOption[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyDogId, setBusyDogId] = useState<string | null>(null)
  const [notify, setNotify] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Search the client book. Debounced, and every response is checked against the
  // latest query so a slow early request can't overwrite a newer list.
  useEffect(() => {
    let off = false
    setLoading(true)
    const t = setTimeout(() => {
      fetch(`/api/clients?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : null))
        .then((d: { items?: ApiClient[] } | null) => {
          if (off) return
          const rows: DogOption[] = []
          for (const c of d?.items ?? []) {
            for (const dog of c.dogs ?? []) {
              rows.push({ clientId: c.id, clientName: c.name ?? 'Client', dogId: dog.id, dogName: dog.name, photoUrl: dog.photoUrl })
            }
          }
          setOptions(rows)
        })
        .catch(() => { if (!off) setOptions([]) })
        .finally(() => { if (!off) setLoading(false) })
    }, 220)
    return () => { off = true; clearTimeout(t) }
  }, [q])

  // A dog already in this part isn't offered again — the enrolment would be
  // rejected as a duplicate, and a row that always fails is worse than no row.
  const alreadyIn = new Set(cell.attendees.map(a => a.dogId).filter(Boolean))

  async function register(opt: DogOption) {
    if (!cell.runId) return
    setError(null)
    setBusyDogId(opt.dogId)
    try {
      const res = await fetch(`/api/class-runs/${cell.runId}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // A daycare day is a DROP_IN on that one session: it books THIS day, not
        // every day of the run for the rest of time.
        body: JSON.stringify({
          clientId: opt.clientId,
          dogId: opt.dogId,
          type: 'DROP_IN',
          sessionId: cell.sessionId,
          notify,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? `Could not register ${opt.dogName}.`)
        return
      }
      setDone(prev => [...prev, opt.dogId])
      onDone()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusyDogId(null)
    }
  }

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="p-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" strokeWidth={1.75} />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search a client or dog"
            className="w-full h-11 rounded-xl border border-slate-200 pl-9 pr-3 text-sm"
          />
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
          Tell the owner they’re booked in
        </label>
        {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      </div>

      {loading && options === null ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" strokeWidth={1.75} /> Loading your clients…
        </div>
      ) : (options?.length ?? 0) === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-slate-500">
          {q ? `Nobody matching “${q}”.` : 'No clients with a dog on file yet.'}
        </div>
      ) : (
        <div className="border-t border-slate-200 divide-y divide-slate-100">
          {options!.map(opt => {
            const booked = done.includes(opt.dogId) || alreadyIn.has(opt.dogId)
            return (
              <button
                key={`${opt.clientId}:${opt.dogId}`}
                onClick={() => register(opt)}
                disabled={booked || busyDogId !== null}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 disabled:hover:bg-white"
              >
                {opt.photoUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={opt.photoUrl} alt={opt.dogName} className="h-9 w-9 rounded-full object-cover shrink-0" />
                  : <span className="h-9 w-9 grid place-items-center rounded-full bg-slate-100 text-slate-500 text-xs font-semibold shrink-0">{opt.dogName.slice(0, 1).toUpperCase()}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-900 truncate">{opt.dogName}</span>
                  <span className="block text-xs text-slate-500 truncate">{opt.clientName}</span>
                </span>
                {busyDogId === opt.dogId ? (
                  <Loader2 className="h-4 w-4 animate-spin text-slate-400 shrink-0" strokeWidth={1.75} />
                ) : booked ? (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 shrink-0">
                    <Check className="h-4 w-4" strokeWidth={1.75} /> In
                  </span>
                ) : (
                  <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" strokeWidth={1.75} />
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
