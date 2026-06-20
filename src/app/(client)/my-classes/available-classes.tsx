'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { GraduationCap, Loader2, Users, CalendarDays } from 'lucide-react'
import { openExternal } from '@/lib/external-link'

interface OpenClass {
  id: string
  name: string
  scheduleNote: string | null
  packageName: string
  nextSessionAt: string | null
  seatsLeft: number | null
  fullPriceCents: number | null
  allowDropIn: boolean
  dropInPerSessionCents: number | null
  allowWaitlist: boolean
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R',
}

function price(cents: number | null, currency: string | null): string | null {
  if (cents == null) return null
  const sym = currency ? CURRENCY_SYMBOLS[currency.toLowerCase()] ?? '' : '$'
  return `${sym}${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

export function AvailableClasses({
  classes,
  dogs,
  defaultDogId,
  acceptPayments,
  currency,
}: {
  classes: OpenClass[]
  dogs: { id: string; name: string }[]
  defaultDogId: string | null
  acceptPayments: boolean
  currency: string | null
}) {
  const router = useRouter()
  const [dogByClass, setDogByClass] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null) // `${id}:${type}`
  const [error, setError] = useState<Record<string, string>>({})

  async function join(c: OpenClass, type: 'FULL' | 'DROP_IN') {
    const key = `${c.id}:${type}`
    if (busy) return
    setBusy(key)
    setError(e => ({ ...e, [c.id]: '' }))
    try {
      const dogId = dogByClass[c.id] ?? defaultDogId ?? null
      const res = await fetch(`/api/my/classes/${c.id}/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, dogId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(e => ({ ...e, [c.id]: typeof body.error === 'string' ? body.error : 'Could not join.' }))
        return
      }
      if (body.mode === 'payment' && body.url) {
        openExternal(body.url)
        return // keep spinner while we leave for Stripe
      }
      router.refresh() // enrolled / waitlisted — the class moves into the list below
    } catch {
      setError(e => ({ ...e, [c.id]: 'Could not join.' }))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <GraduationCap className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-slate-900">Classes you can join</h2>
      </div>

      <div className="flex flex-col gap-3">
        {classes.map(c => {
          const full = price(c.fullPriceCents, currency)
          const drop = price(c.dropInPerSessionCents, currency)
          const isFull = c.seatsLeft === 0
          const paidButNoPayments = !!c.fullPriceCents && !acceptPayments
          return (
            <div key={c.id} className="rounded-2xl bg-white shadow-[0_2px_16px_rgba(15,31,36,0.05)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                  <p className="text-xs text-slate-500">{c.packageName}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    {c.scheduleNote && <span className="inline-flex items-center gap-1"><CalendarDays className="h-3 w-3" />{c.scheduleNote}</span>}
                    {c.seatsLeft != null && (
                      <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{isFull ? 'Full' : `${c.seatsLeft} left`}</span>
                    )}
                  </div>
                </div>
                {full && <span className="shrink-0 text-sm font-semibold text-slate-900">{full}</span>}
              </div>

              {dogs.length > 1 && (
                <select
                  value={dogByClass[c.id] ?? defaultDogId ?? ''}
                  onChange={e => setDogByClass(s => ({ ...s, [c.id]: e.target.value }))}
                  className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}

              {paidButNoPayments ? (
                <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Ask your trainer to enrol you in this class.
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => join(c, 'FULL')}
                    disabled={!!busy || (isFull && !c.allowWaitlist)}
                    className="flex-1 min-w-[120px] h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {busy === `${c.id}:FULL`
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : isFull
                        ? (c.allowWaitlist ? 'Join waitlist' : 'Full')
                        : full ? `Join · ${full}` : 'Join'}
                  </button>
                  {c.allowDropIn && drop && !isFull && (
                    <button
                      onClick={() => join(c, 'DROP_IN')}
                      disabled={!!busy}
                      className="flex-1 min-w-[120px] h-11 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold inline-flex items-center justify-center gap-2 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {busy === `${c.id}:DROP_IN` ? <Loader2 className="h-4 w-4 animate-spin" /> : `Drop in · ${drop}/session`}
                    </button>
                  )}
                </div>
              )}
              {error[c.id] && <p className="mt-2 text-xs text-rose-600">{error[c.id]}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}
