'use client'

import { useMemo, useState } from 'react'
import { Calendar, Clock, Loader2, CheckCircle2, ChevronLeft } from 'lucide-react'

interface Slot {
  iso: string
  dateStr: string
  startMin: number
  label: string
}
interface DaySlots {
  dateStr: string
  slots: Slot[]
}
interface Pkg {
  name: string
  sessionCount: number
  weeksBetween: number
  durationMins: number
}

function dayLabel(dateStr: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  // Noon-UTC anchor + UTC formatting keeps the calendar date stable (dateStr is
  // already trainer-local; no tz conversion wanted here).
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-NZ', { timeZone: 'UTC', ...opts })
}

type Result = 'booked' | 'requested' | 'enquiry'

export function BookingFlow({
  slug,
  pageSlug,
  accentColor,
  businessName,
  days,
  requiresApproval,
  knownClientName,
  isKnownClient,
  pkg,
  slotLengthMins,
}: {
  slug: string
  pageSlug: string
  accentColor: string | null
  businessName: string
  days: DaySlots[]
  requiresApproval: boolean
  knownClientName: string | null
  isKnownClient: boolean
  pkg: Pkg | null
  slotLengthMins: number
}) {
  const [dateStr, setDateStr] = useState(days[0]?.dateStr ?? '')
  const [slot, setSlot] = useState<Slot | null>(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '', dogName: '', message: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  const accent = accentColor ?? undefined
  const selectedDay = useMemo(() => days.find(d => d.dateStr === dateStr) ?? null, [days, dateStr])

  // Existing clients with a package booking that needs approval get the
  // "request" wording; everything else for them books instantly. Single
  // sessions always book instantly for a known client.
  const willRequest = (isKnownClient && requiresApproval && !!pkg) || (!isKnownClient)

  async function submit() {
    setError(null)
    if (!slot) return
    if (!isKnownClient && (!form.name.trim() || !form.email.trim())) {
      setError('Please enter your name and email.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/c/${slug}/book/${pageSlug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isKnownClient
            ? { slotIso: slot.iso }
            : {
                slotIso: slot.iso,
                name: form.name.trim(),
                email: form.email.trim(),
                phone: form.phone.trim() || null,
                dogName: form.dogName.trim() || null,
                message: form.message.trim() || null,
              },
        ),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof body.error === 'string' ? body.error : 'Could not book that time.')
        // A taken slot is gone — drop back to the picker so they re-choose.
        if (body.code === 'SLOT_TAKEN') setSlot(null)
        return
      }
      setResult((body.mode as Result) ?? (willRequest ? 'requested' : 'booked'))
    } finally {
      setSaving(false)
    }
  }

  if (result) {
    return (
      <div className="w-full rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-md shadow-slate-900/5">
        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-500" />
        <p className="text-lg font-semibold text-slate-900">
          {result === 'booked' ? "You're booked!" : result === 'requested' ? 'Request sent' : 'Request received'}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">
          {result === 'booked'
            ? `Your session is confirmed for ${slot ? `${dayLabel(slot.dateStr, { weekday: 'long', day: 'numeric', month: 'long' })}, ${slot.label}` : 'your chosen time'}.`
            : result === 'requested'
              ? `${businessName} will confirm your time and you’ll hear back shortly.`
              : `${businessName} will review your request and be in touch to confirm.`}
        </p>
      </div>
    )
  }

  if (days.length === 0) {
    return (
      <div className="w-full rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-md shadow-slate-900/5">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
          <Calendar className="h-6 w-6 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-slate-600">No open times right now</p>
        <p className="mt-1 text-xs text-slate-400">{businessName} hasn’t published availability for the next few weeks.</p>
      </div>
    )
  }

  // ── Step 2: confirm a chosen slot ──
  if (slot) {
    return (
      <div className="w-full rounded-2xl border border-slate-100 bg-white p-6 shadow-md shadow-slate-900/5">
        <button onClick={() => setSlot(null)} className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ChevronLeft className="h-4 w-4" /> Back to times
        </button>

        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <Calendar className="h-4 w-4 text-slate-400" />
            {dayLabel(slot.dateStr, { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
          <p className="mt-1 flex items-center gap-2 text-sm text-slate-600">
            <Clock className="h-4 w-4 text-slate-400" />
            {slot.label} · {pkg ? `${pkg.durationMins} min` : `${slotLengthMins} min`}
          </p>
          {pkg && (
            <p className="mt-2 text-xs text-slate-500">
              {pkg.name}
              {pkg.sessionCount > 1
                ? ` · ${pkg.sessionCount} sessions, every ${pkg.weeksBetween} week${pkg.weeksBetween === 1 ? '' : 's'} (the rest auto-schedule)`
                : ''}
            </p>
          )}
        </div>

        {isKnownClient ? (
          <p className="mt-4 text-sm text-slate-600">
            Booking as <span className="font-medium text-slate-900">{knownClientName ?? 'you'}</span>.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <Field label="Your name" required value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} />
            <Field label="Email" required type="email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} />
            <Field label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} />
            <Field label="Dog's name" value={form.dogName} onChange={v => setForm(f => ({ ...f, dogName: v }))} />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Anything we should know?</label>
              <textarea
                value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                rows={3}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <button
          onClick={submit}
          disabled={saving}
          style={accent ? { backgroundColor: accent } : undefined}
          className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50 ${accent ? '' : 'bg-blue-600 hover:bg-blue-700'}`}
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {willRequest ? 'Request this time' : 'Confirm booking'}
        </button>
      </div>
    )
  }

  // ── Step 1: pick a day + time ──
  return (
    <div className="w-full rounded-2xl border border-slate-100 bg-white p-5 shadow-md shadow-slate-900/5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">Pick a day</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
        {days.map(d => {
          const active = d.dateStr === dateStr
          return (
            <button
              key={d.dateStr}
              onClick={() => setDateStr(d.dateStr)}
              style={active && accent ? { backgroundColor: accent, borderColor: accent } : undefined}
              className={`flex shrink-0 flex-col items-center rounded-xl border px-3.5 py-2 transition-colors ${
                active
                  ? `text-white ${accent ? '' : 'border-blue-600 bg-blue-600'}`
                  : 'border-slate-200 text-slate-700 hover:border-slate-300'
              }`}
            >
              <span className="text-[11px] font-medium uppercase opacity-80">{dayLabel(d.dateStr, { weekday: 'short' })}</span>
              <span className="text-base font-semibold leading-tight">{dayLabel(d.dateStr, { day: 'numeric' })}</span>
              <span className="text-[10px] opacity-80">{dayLabel(d.dateStr, { month: 'short' })}</span>
            </button>
          )
        })}
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {selectedDay ? `Times on ${dayLabel(selectedDay.dateStr, { weekday: 'long', day: 'numeric', month: 'short' })}` : 'Pick a time'}
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {selectedDay?.slots.map(s => (
          <button
            key={s.iso}
            onClick={() => { setSlot(s); setError(null) }}
            className="rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-blue-400 hover:bg-blue-50"
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  required,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  type?: string
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
