'use client'

import { useState, useEffect, useMemo } from 'react'
import { CalendarPlus, X, Loader2, CheckCircle2 } from 'lucide-react'
import { openExternal } from '@/lib/external-link'
import { enumerateStartTimes, type AvailabilityRow, type BlackoutRow, type BusyInterval } from '@/lib/availability'
import { zonedToUtc, todayInTz } from '@/lib/timezone'

type Pkg = {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  selfBookRequiresApproval: boolean
}

type Availability = {
  tz: string
  slots: AvailabilityRow[]
  blackouts: BlackoutRow[]
  busy: BusyInterval[]
}

// How far ahead the picker offers days — matches the my-availability page.
const DAYS_AHEAD = 28
// Granularity of offered start times inside each window.
const STEP_MINS = 30

function price(c: number | null) {
  return c == null ? null : `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
}

function addDayStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Label the date deterministically from its own calendar value — NOT via
  // toLocaleDateString, which renders in the VIEWER's timezone and, for a client
  // in a different tz than the trainer (e.g. NZ), shows the wrong weekday. The
  // date the option enumerates is trainer-local, so its true weekday is fixed.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return `${WEEKDAY_SHORT[dow]} ${d} ${MONTH_SHORT[m - 1]}`
}

function fmtTimeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

// The UTC instant for a trainer-local date + "HH:MM".
function toUtcIso(dateStr: string, hhmm: string, tz: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, min] = hhmm.split(':').map(Number)
  return zonedToUtc(y, m, d, h, min, tz).toISOString()
}

export function SelfBookCta() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-blue-700 transition-colors"
      >
        <CalendarPlus className="h-4 w-4" /> Book a package
      </button>
      {open && <SelfBookModal onClose={() => setOpen(false)} />}
    </>
  )
}

function SelfBookModal({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [packages, setPackages] = useState<Pkg[]>([])
  const [availability, setAvailability] = useState<Availability | null>(null)
  const [packageId, setPackageId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<'booked' | 'requested' | 'waitlisted' | null>(null)

  // Load self-bookable packages + the trainer's availability once on mount.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/my/self-book').then(r => (r.ok ? r.json() : [])),
      fetch('/api/my/self-book/availability').then(r => (r.ok ? r.json() : null)),
    ])
      .then(([pkgs, avail]: [Pkg[], Availability | null]) => {
        if (cancelled) return
        setPackages(pkgs)
        setPackageId(pkgs[0]?.id ?? '')
        setAvailability(avail)
      })
      .catch(() => { if (!cancelled) setError('Could not load packages.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selected = packages.find(p => p.id === packageId)
  const duration = selected?.durationMins ?? 0

  // Days in the next four weeks that can hold this package's first session.
  const availableDates = useMemo(() => {
    if (!availability || duration <= 0) return []
    const today = todayInTz(availability.tz)
    const out: string[] = []
    for (let i = 0; i < DAYS_AHEAD; i++) {
      const dateStr = addDayStr(today, i)
      if (enumerateStartTimes(availability.slots, dateStr, duration, availability.blackouts, STEP_MINS, availability.busy).length > 0) {
        out.push(dateStr)
      }
    }
    return out
  }, [availability, duration])

  // Valid start times for the chosen day, dropping any already in the past.
  const timeOptions = useMemo(() => {
    if (!availability || !date || duration <= 0) return []
    const now = Date.now()
    return enumerateStartTimes(availability.slots, date, duration, availability.blackouts, STEP_MINS, availability.busy)
      .filter(t => new Date(toUtcIso(date, t, availability.tz)).getTime() > now)
  }, [availability, date, duration])

  // Keep the date valid as the package (and thus duration/day list) changes.
  useEffect(() => {
    if (availableDates.length === 0) { setDate(''); return }
    if (!availableDates.includes(date)) setDate(availableDates[0])
  }, [availableDates, date])

  // Keep the time valid as the day (and thus time list) changes.
  useEffect(() => {
    if (timeOptions.length === 0) { setTime(''); return }
    if (!timeOptions.includes(time)) setTime(timeOptions[0])
  }, [timeOptions, time])

  async function book(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!packageId || !date || !time || !availability) {
      setError('Pick a package and an available time.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/my/self-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, startDate: toUtcIso(date, time, availability.tz) }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof b.error === 'string' ? b.error : 'Could not book.')
        return
      }
      // Paid package → hand off to Stripe; the webhook books on success.
      if (b.mode === 'payment' && b.url) {
        openExternal(b.url)
        return // keep the spinner up while we leave for Stripe
      }
      setDone(b.mode === 'booked' ? 'booked' : 'requested')
    } finally {
      setSaving(false)
    }
  }

  async function joinWaitlist() {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/my/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: packageId || null }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        setError(typeof b.error === 'string' ? b.error : 'Could not join the waitlist.')
        return
      }
      setDone('waitlisted')
    } finally {
      setSaving(false)
    }
  }

  const noTimesForDay = !!date && timeOptions.length === 0
  const noDaysAtAll = availableDates.length === 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Book a package</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          {done ? (
            <div className="text-center py-4">
              <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-3" />
              <p className="font-medium text-slate-900">
                {done === 'booked'
                  ? 'Booked!'
                  : done === 'requested'
                    ? 'Request sent'
                    : "You're on the waitlist"}
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {done === 'booked'
                  ? 'Your sessions are on the calendar — check your Sessions tab.'
                  : done === 'requested'
                    ? 'Your trainer will confirm the times and you’ll be notified.'
                    : 'Your trainer will be in touch when a slot opens up.'}
              </p>
              <button
                onClick={onClose}
                className="mt-5 w-full rounded-xl bg-slate-900 text-white text-sm font-medium py-2.5"
              >
                Done
              </button>
            </div>
          ) : loading ? (
            <div className="py-10 text-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin mx-auto" />
            </div>
          ) : packages.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-sm text-slate-600">
                There are no packages you can book yourself right now.
              </p>
              <button
                onClick={joinWaitlist}
                disabled={saving}
                className="mt-4 w-full rounded-xl border border-slate-200 text-sm font-medium py-2.5 hover:bg-slate-50 disabled:opacity-50"
              >
                Join the waitlist instead
              </button>
              {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
            </div>
          ) : (
            <form onSubmit={book} className="flex flex-col gap-3">
              {error && <p className="text-sm text-red-600">{error}</p>}

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">Package</label>
                <select
                  value={packageId}
                  onChange={e => setPackageId(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {packages.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {price(p.priceCents) ? ` · ${price(p.priceCents)}` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selected && (
                <p className="text-xs text-slate-500">
                  {selected.sessionCount > 0
                    ? `${selected.sessionCount} session${selected.sessionCount === 1 ? '' : 's'}`
                    : 'Ongoing'}
                  {selected.sessionCount > 1 ? `, every ${selected.weeksBetween} week${selected.weeksBetween === 1 ? '' : 's'}` : ''}
                  {' · '}
                  {selected.durationMins} min
                  {selected.selfBookRequiresApproval ? ' · needs trainer approval' : ' · books instantly'}
                </p>
              )}

              {noDaysAtAll ? (
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-3 text-center">
                  <p className="text-sm text-slate-600">
                    No open times in your trainer’s calendar over the next four weeks.
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">Day</label>
                    <select
                      value={date}
                      onChange={e => setDate(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {availableDates.map(d => (
                        <option key={d} value={d}>{fmtDateLabel(d)}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">Start time</label>
                    <select
                      value={time}
                      onChange={e => setTime(e.target.value)}
                      disabled={noTimesForDay}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      {noTimesForDay ? (
                        <option value="">No times left this day</option>
                      ) : (
                        timeOptions.map(t => (
                          <option key={t} value={t}>{fmtTimeLabel(t)}</option>
                        ))
                      )}
                    </select>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Only your trainer’s open times are shown. The rest of the package auto-places from here.
                    </p>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={saving || noDaysAtAll || noTimesForDay || !time}
                className="mt-1 w-full rounded-xl bg-blue-600 text-white text-sm font-medium py-2.5 hover:bg-blue-700 disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {selected?.selfBookRequiresApproval ? 'Request booking' : 'Book now'}
              </button>
              <button
                type="button"
                onClick={joinWaitlist}
                disabled={saving}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                None of these times work? Join the waitlist
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
