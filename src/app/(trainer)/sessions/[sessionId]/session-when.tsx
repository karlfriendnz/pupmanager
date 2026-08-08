'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Loader2 } from 'lucide-react'
import { accentIconStyle } from './session-actions'

/**
 * When the session is — and, on a tap, when it should be instead (Karl: "make
 * it so if you click on the date it allows you to change the date and time of
 * the session").
 *
 * It edits IN PLACE rather than opening anything. A sheet or a modal over a
 * screen this short would be a second scrolling surface for three fields, and
 * the row you tapped is exactly where the answer belongs. Native `date` and
 * `time` inputs, so a phone gets its own wheel pickers and we own no calendar.
 *
 * Times are the BROWSER's, in and out: the row shows what a date renders as
 * here, and what you type is read back the same way. A trainer editing their
 * own calendar on their own phone gets what they typed.
 */
export function SessionWhenRow({
  sessionId,
  scheduledAt,
  durationMins,
  extra,
  accent,
}: {
  sessionId: string
  /** ISO string — the row's own state until it's saved. */
  scheduledAt: string
  durationMins: number
  /** Place, "Virtual", buddy count — whatever else rides on the time line. */
  extra?: string | null
  accent?: string | null
}) {
  const router = useRouter()
  const [at, setAt] = useState(scheduledAt)
  const [mins, setMins] = useState(durationMins)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Draft fields, seeded on open so Cancel is a true cancel.
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [draftMins, setDraftMins] = useState(String(durationMins))

  const d = new Date(at)

  function open() {
    const pad = (n: number) => String(n).padStart(2, '0')
    setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
    setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setDraftMins(String(mins))
    setError(null)
    setEditing(true)
  }

  async function save() {
    if (saving) return
    const next = new Date(`${date}T${time}`)
    const nextMins = parseInt(draftMins, 10)
    // A cleared field parses to Invalid Date / NaN, and sending either would
    // 400 with nothing on screen to explain it.
    if (Number.isNaN(next.getTime())) { setError('Pick a date and a time.'); return }
    if (!Number.isFinite(nextMins) || nextMins <= 0) { setError('How many minutes?'); return }

    setSaving(true)
    setError(null)
    const res = await fetch(`/api/schedule/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: next.toISOString(), durationMins: nextMins }),
    })
    if (!res.ok) {
      setError('Could not move the session — try again.')
      setSaving(false)
      return
    }
    // Show the new time immediately; refresh so everything else on the page
    // (and the week behind it) catches up.
    setAt(next.toISOString())
    setMins(nextMins)
    setEditing(false)
    setSaving(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
      >
        <Calendar
          className="h-[18px] w-[18px] flex-shrink-0 text-slate-700"
          style={accentIconStyle(accent)}
          strokeWidth={1.75}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">
            {d.toLocaleDateString('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-slate-500">
            {[
              `${d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })} · ${mins} min`,
              extra || null,
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
    )
  }

  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[13px] font-medium text-slate-600">Date</span>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900"
          />
        </label>
        <div className="flex gap-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[13px] font-medium text-slate-600">Start time</span>
            <input
              type="time"
              value={time}
              onChange={e => setTime(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900"
            />
          </label>
          <label className="flex w-28 flex-col gap-1">
            <span className="text-[13px] font-medium text-slate-600">Minutes</span>
            <input
              type="number"
              min={5}
              step={5}
              value={draftMins}
              onChange={e => setDraftMins(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900"
            />
          </label>
        </div>

        {error && <p className="text-[13px] text-rose-600">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-lg bg-[var(--pm-brand-600)] px-3 text-sm font-medium text-white active:bg-[var(--pm-brand-700)] disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
          <button
            type="button"
            onClick={() => { setEditing(false); setError(null) }}
            disabled={saving}
            className="inline-flex min-h-[40px] items-center rounded-lg px-3 text-sm font-medium text-slate-600 active:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
