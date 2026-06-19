'use client'

import { useState, useEffect } from 'react'
import { CalendarPlus, X, Loader2, CheckCircle2 } from 'lucide-react'
import { openExternal } from '@/lib/external-link'

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

function price(c: number | null) {
  return c == null ? null : `$${(c / 100).toFixed(c % 100 === 0 ? 0 : 2)}`
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
  const [packageId, setPackageId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<'booked' | 'requested' | 'waitlisted' | null>(null)

  // Load self-bookable packages once on mount.
  useEffect(() => {
    let cancelled = false
    fetch('/api/my/self-book')
      .then(r => (r.ok ? r.json() : []))
      .then((data: Pkg[]) => {
        if (cancelled) return
        setPackages(data)
        setPackageId(data[0]?.id ?? '')
      })
      .catch(() => { if (!cancelled) setError('Could not load packages.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selected = packages.find(p => p.id === packageId)

  async function book(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!packageId || !startDate) {
      setError('Pick a package and a start time.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/my/self-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId, startDate: new Date(startDate).toISOString() }),
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

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">First session</label>
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Pick a time inside your trainer’s open times shown below. The rest auto-place on the package schedule.
                </p>
              </div>

              <button
                type="submit"
                disabled={saving}
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
