'use client'

import { useState } from 'react'

type Run = {
  id: string
  name: string
  scheduleNote: string | null
  startDate: string
  sessionCount: number
  description: string | null
  priceCents: number | null
  seatsLeft: number | null
  full: boolean
  waitlistAvailable: boolean
}

function price(cents: number | null): string | null {
  if (cents == null) return null
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

export function PublicClasses({ formId, runs }: { formId: string; runs: Run[] }) {
  const [selected, setSelected] = useState<Run | null>(null)
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <div className="max-w-sm text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-2xl">✓</div>
          <h1 className="mt-4 text-lg font-semibold text-slate-900">Request sent</h1>
          <p className="mt-1 text-sm text-slate-500">
            Thanks! Your trainer will be in touch to confirm your spot{selected ? ` in ${selected.name}` : ''}.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 p-5 md:p-8">
      <div className="max-w-xl mx-auto">
        <h1 className="text-xl font-bold text-slate-900">Upcoming classes</h1>
        <p className="text-sm text-slate-500 mt-1">Pick a class to request a spot.</p>

        {runs.length === 0 ? (
          <p className="mt-10 text-center text-sm text-slate-500">
            No classes are open for enrolment right now.
          </p>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            {runs.map(r => (
              <div key={r.id} className="rounded-2xl bg-white border border-slate-100 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{r.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Starts {new Date(r.startDate).toLocaleDateString()} ·{' '}
                      {r.scheduleNote || `${r.sessionCount} session${r.sessionCount === 1 ? '' : 's'}`}
                    </p>
                    {r.description && <p className="text-sm text-slate-600 mt-2">{r.description}</p>}
                  </div>
                  {price(r.priceCents) && (
                    <span className="text-sm font-semibold text-slate-900 flex-shrink-0">{price(r.priceCents)}</span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-slate-400">
                    {r.seatsLeft == null
                      ? 'Open enrolment'
                      : r.full
                      ? r.waitlistAvailable
                        ? 'Full — waitlist open'
                        : 'Full'
                      : `${r.seatsLeft} spot${r.seatsLeft === 1 ? '' : 's'} left`}
                  </span>
                  <button
                    type="button"
                    disabled={r.full && !r.waitlistAvailable}
                    onClick={() => setSelected(r)}
                    className="text-sm font-medium rounded-xl bg-blue-600 text-white px-4 py-2 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {r.full && r.waitlistAvailable ? 'Join waitlist' : 'Request a spot'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {selected && (
        <EnrolRequestModal
          formId={formId}
          run={selected}
          onClose={() => setSelected(null)}
          onDone={() => setDone(true)}
        />
      )}
    </div>
  )
}

function EnrolRequestModal({
  formId,
  run,
  onClose,
  onDone,
}: {
  formId: string
  run: Run
  onClose: () => void
  onDone: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [dogName, setDogName] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !email.trim()) {
      setError('Name and email are required.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/form/${formId}/classes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: run.id,
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          dogName: dogName.trim() || null,
          message: message.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body.error ?? 'Could not send your request.')
        return
      }
      onDone()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Request a spot</h2>
          <p className="text-xs text-slate-500 mt-0.5">{run.name}</p>
        </div>
        <form onSubmit={submit} className="p-5 flex flex-col gap-3">
          {error && <p className="text-sm text-red-600">{error}</p>}
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Your name" value={name} onChange={e => setName(e.target.value)} />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Phone (optional)" value={phone} onChange={e => setPhone(e.target.value)} />
          <input className="h-11 rounded-xl border border-slate-200 px-3 text-sm" placeholder="Dog's name (optional)" value={dogName} onChange={e => setDogName(e.target.value)} />
          <textarea className="rounded-xl border border-slate-200 px-3 py-2 text-sm" rows={3} placeholder="Anything we should know? (optional)" value={message} onChange={e => setMessage(e.target.value)} />
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-blue-600 text-white text-sm font-medium py-2.5 hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Sending…' : 'Send request'}
            </button>
            <button type="button" onClick={onClose} className="rounded-xl px-4 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
