'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dog, ExternalLink, Loader2, Check } from 'lucide-react'
import { SessionSlotsEditor, newSlot, type SessionSlot } from '@/components/shared/session-slots'
import { PuppySchoolSetup } from '@/components/trainer/puppy-school-setup'
// The SAME derivation the board's columns come from — imported, never copied,
// so the preview here and the board can't disagree.
import { openDaysFromSlots, ISO_DAY_LABEL } from '@/lib/daycare-days'
import { useCurrency } from '@/components/currency-context'
import { currencySymbol } from '@/lib/money'

/** A PackageSessionSlot as the server hands it over (cents, ISO date). */
export interface DaycareSlot {
  id: string
  order: number
  startDate: string | null
  day: number
  startTime: string
  endTime: string
  gapMins: number
  capacity: number | null
  priceCents: number | null
  specialPriceCents: number | null
  xeroAccountCode: string | null
  requirePayment: boolean
  locationId: string | null
  recurrenceRule: string | null
  assignedMembershipIds: string[]
}

export interface DaycareSchool {
  id: string
  name: string
  priceCents: number | null
  dropInPriceCents: number | null
  capacity: number | null
  allowWaitlist: boolean
  clientSelfBook: boolean
  slots: DaycareSlot[]
}

function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}
function dollarsToCents(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = parseFloat(t)
  if (Number.isNaN(n) || n < 0) return null
  return Math.round(n * 100)
}

/** Stored slot → the shared editor's shape. Keeps the real id so a save updates
 *  in place and the sessions already generated off it stay attached. */
function toEditorSlot(s: DaycareSlot): SessionSlot {
  return {
    id: s.id,
    startDate: s.startDate ? s.startDate.slice(0, 10) : '',
    day: s.day,
    start: s.startTime,
    end: s.endTime,
    gap: String(s.gapMins),
    capacity: s.capacity == null ? '' : String(s.capacity),
    price: centsToDollars(s.priceCents),
    specialPrice: centsToDollars(s.specialPriceCents),
    account: s.xeroAccountCode ?? '',
    requirePayment: s.requirePayment,
    assignedIds: s.assignedMembershipIds,
    locationId: s.locationId ?? '',
    repeat: s.recurrenceRule ?? '',
  }
}

/** Editor slot → the /api/packages PATCH payload (the same shape the offering
 *  form sends, so the server reconcile is unchanged). */
function toPayload(s: SessionSlot) {
  const cap = s.capacity.trim()
  return {
    id: s.id,
    startDate: s.startDate || null,
    day: s.day,
    startTime: s.start,
    endTime: s.end,
    gapMins: Number(s.gap) || 0,
    capacity: cap ? Math.max(0, Math.floor(Number(cap))) : null,
    priceCents: dollarsToCents(s.price),
    specialPriceCents: dollarsToCents(s.specialPrice),
    xeroAccountCode: s.account || null,
    requirePayment: s.requirePayment,
    locationId: s.locationId || null,
    recurrenceRule: s.repeat && s.repeat !== 'NONE' ? s.repeat : null,
    assignedMembershipIds: s.assignedIds,
  }
}

export function DaycarePanel({
  schools,
  locations: initialLocations,
  region,
}: {
  schools: DaycareSchool[]
  locations: { id: string; name: string }[]
  region?: string
}) {
  // No daycare yet: the setup form IS the page. This is what the board's
  // removed "+ New school" button used to open, and it's the only way in now.
  if (schools.length === 0) {
    return (
      <div className="max-w-3xl">
        <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Dog className="h-5 w-5 text-teal-600" /> Start your doggy daycare
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Split the day into parts parents can book — mornings, afternoons, or however you run it.
            The days you tick here are the days your board shows.
          </p>
        </div>
        <PuppySchoolSetup />
      </div>
    )
  }

  return (
    <div className="max-w-3xl flex flex-col gap-6">
      {schools.map(s => (
        <SchoolCard key={s.id} school={s} locations={initialLocations} region={region} />
      ))}
    </div>
  )
}

function SchoolCard({
  school,
  locations,
  region,
}: {
  school: DaycareSchool
  locations: { id: string; name: string }[]
  region?: string
}) {
  const router = useRouter()
  const currency = useCurrency()
  const sym = currencySymbol(currency)

  const [slots, setSlots] = useState<SessionSlot[]>(() =>
    school.slots.length ? school.slots.map(toEditorSlot) : [newSlot()],
  )
  const [locs, setLocs] = useState(locations)
  const [team, setTeam] = useState<{ id: string; name: string | null; title: string | null }[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Same endpoint the offering form uses, so "assigned to" offers the same people.
  useEffect(() => {
    let off = false
    fetch('/api/trainer/team')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { members?: { id: string; name: string | null; title: string | null; status?: string }[] } | null) => {
        if (!off && d?.members) setTeam(d.members.filter(m => m.status === 'ACTIVE').map(m => ({ id: m.id, name: m.name, title: m.title })))
      })
      .catch(() => {})
    return () => { off = true }
  }, [])

  // What the board will show — the same derivation the board itself runs, so
  // the trainer can see the consequence of a day before saving it.
  const openDays = useMemo(
    () => openDaysFromSlots(slots.filter(s => s.start && s.end).map(s => ({ day: s.day }))),
    [slots],
  )
  const anyTimed = slots.some(s => s.start && s.end)

  const priceLabel = school.priceCents != null
    ? `${sym}${centsToDollars(school.priceCents)}`
    : school.dropInPriceCents != null
      ? `from ${sym}${centsToDollars(school.dropInPriceCents)} a part`
      : 'No price set'

  async function save() {
    setError(null)
    setSaved(false)
    if (slots.some(s => !s.start || !s.end)) {
      setError('Give every part of the day a start and finish time.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/packages/${school.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Slots only. Everything else about the offering is edited on the
        // offering itself — sending more from here would be a second editor.
        body: JSON.stringify({ sessionSlots: slots.map(toPayload) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null
        setError(typeof body?.error === 'string' ? body.error : 'Could not save the day-parts — please try again.')
        return
      }
      setSaved(true)
      router.refresh()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      {/* The offering itself. Name, price and the rest are edited in the real
          package editor — this says what it is and sends you there, rather than
          growing a second form that would drift from it. */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Dog className="h-5 w-5 text-teal-600" /> {school.name}
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {priceLabel}
            {school.capacity != null && <> · up to {school.capacity} dogs</>}
            {school.allowWaitlist && <> · waitlist on</>}
            {school.clientSelfBook && <> · clients can book</>}
          </p>
          <p className="text-xs text-slate-500 mt-2">
            {anyTimed
              ? <>Your board shows <span className="font-semibold text-slate-700">{openDays.map(d => ISO_DAY_LABEL[d]).join(', ')}</span> — the days your parts run on.</>
              : <>Give a part a time and the days it runs to fill your board.</>}
          </p>
        </div>
        <Link
          href={`/packages/${school.id}/edit`}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:border-blue-400 hover:text-blue-600"
        >
          Name &amp; price <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      {/* The day-parts. Same editor the drop-in class form uses — one card per
          part, each with its day, time, capacity, price, venue and staff. */}
      <div className="p-5">
        <div className="mb-3">
          <h4 className="text-sm font-semibold text-slate-900">Parts of the day</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            One card per part, per day it runs. A part that runs Tue–Fri is four cards — duplicate one and change the day.
          </p>
        </div>

        <SessionSlotsEditor
          value={slots}
          onChange={s => { setSlots(s); setSaved(false) }}
          locations={locs}
          team={team}
          region={region}
          onLocationCreated={loc => setLocs(prev => [...prev, { id: loc.id, name: loc.name }])}
        />

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        <div className="mt-4 flex items-center justify-end gap-3">
          {saved && !saving && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save parts
          </button>
        </div>

        {/* Honest about the one thing this can't do. Sessions already in the
            diary were generated from these parts when the daycare was created;
            changing a part here changes what a part IS and what the board's
            columns are, but it does not go back and move days already booked. */}
        <p className="mt-3 text-xs text-slate-400">
          Days already in the diary keep the times they were created with — change one of those on the day itself.
        </p>
      </div>
    </div>
  )
}
