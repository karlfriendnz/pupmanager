'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dog, ExternalLink, Loader2, Check, Plus, ChevronRight } from 'lucide-react'
import { SessionSlotsEditor, newSlot, type SessionSlot } from '@/components/shared/session-slots'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { ConfirmSheet } from '@/components/shared/confirm-sheet'
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

// PackageSessionSlot.day counts Sunday as 0. ISO_DAY_LABEL is keyed the other
// way (1=Mon…7=Sun) and is only right for the open-days preview, so the table
// gets its own names rather than converting back and forth per cell.
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "09:00" → "9am", "13:30" → "1:30pm". Dropping ":00" is what keeps a whole
 *  range inside a phone's time column without truncating it. */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  const suffix = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 === 0 ? 12 : h % 12
  return m ? `${hour}:${String(m).padStart(2, '0')}${suffix}` : `${hour}${suffix}`
}

/**
 * The grid the head and every row share, so the columns run the whole way down.
 *
 * Below sm the venue column goes: a phone has room for the four things that
 * make a part what it is — its day, its hours, how many dogs and what it costs
 * — and a fifth would put the price under the capacity instead of beside it.
 */
const PART_ROW =
  'grid items-center gap-x-2 px-3 sm:gap-x-3 ' +
  '[grid-template-columns:3.5rem_minmax(0,1fr)_2.75rem_3.75rem_0.75rem] ' +
  'sm:[grid-template-columns:6rem_8.5rem_4rem_5rem_minmax(0,1fr)_0.75rem]'

/** Cells that only exist on the wide grid. */
const WIDE_CELL = 'hidden sm:block'

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
        // Keyed on WHICH parts exist, not just the school. A part added here is
        // saved with a temporary client-side id; the server gives it a real one,
        // and the reconcile in lib/package-slots treats an id it doesn't know as
        // a fresh row. Without this the card would keep the temp id in state and
        // the next save would delete and re-create the part it just made —
        // orphaning the sessions already generated off it. Re-keying on the id
        // list means the refresh after a save reloads the card with the real
        // ids, and an ordinary edit (same ids) leaves it alone.
        <SchoolCard
          key={`${s.id}:${s.slots.map(x => x.id).join(',')}`}
          school={s}
          locations={initialLocations}
          region={region}
        />
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

  const [slots, setSlots] = useState<SessionSlot[]>(() => school.slots.map(toEditorSlot))
  const [locs, setLocs] = useState(locations)
  const [team, setTeam] = useState<{ id: string; name: string | null; title: string | null }[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The part being edited, as its own copy: closing the sheet has to leave the
  // table exactly as it was, which editing `slots` in place could not do. It is
  // an ARRAY because the shared editor takes a list — and because its own
  // Duplicate button hands back two parts, which is a perfectly good way to add
  // the same part on another day.
  const [draft, setDraft] = useState<SessionSlot[] | null>(null)
  // Where the draft goes back: an index into `slots`, or null when it's new.
  const [draftAt, setDraftAt] = useState<number | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)

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

  function openPart(i: number) {
    setError(null)
    setSaved(false)
    setDraft([slots[i]])
    setDraftAt(i)
  }

  function addPart() {
    setError(null)
    setSaved(false)
    setDraft([newSlot()])
    setDraftAt(null)
  }

  function closeSheet() {
    setDraft(null)
    setDraftAt(null)
    setConfirmRemove(false)
    setError(null)
  }

  // The shared editor's per-card X hands back an empty list. In a sheet that is
  // showing ONE part, that means "remove this part" — route it to the same
  // confirm the footer's Remove uses instead of leaving a blank sheet behind.
  function onDraftChange(next: SessionSlot[]) {
    if (next.length === 0) {
      if (draftAt === null) closeSheet()
      else setConfirmRemove(true)
      return
    }
    setDraft(next)
  }

  /** The whole list, with the draft spliced in where it belongs. */
  function withDraft(parts: SessionSlot[]): SessionSlot[] {
    if (draftAt === null) return [...slots, ...parts]
    return [...slots.slice(0, draftAt), ...parts, ...slots.slice(draftAt + 1)]
  }

  // One save path for every change. The payload is still the WHOLE slot list on
  // the same PATCH the offering form uses — the reconcile keeps ids, so sending
  // all of them to change one is what stops the others being dropped.
  async function persist(next: SessionSlot[]) {
    setError(null)
    setSaving(true)
    try {
      const res = await fetch(`/api/packages/${school.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Slots only. Everything else about the offering is edited on the
        // offering itself — sending more from here would be a second editor.
        body: JSON.stringify({ sessionSlots: next.map(toPayload) }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: unknown } | null
        setError(typeof body?.error === 'string' ? body.error : 'Could not save the day-parts — please try again.')
        return
      }
      setSlots(next)
      setSaved(true)
      closeSheet()
      router.refresh()
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function savePart() {
    if (!draft) return
    // Only what's in front of them. Complaining about a time missing from some
    // other row would be a message they can't act on from inside this sheet.
    if (draft.some(s => !s.start || !s.end)) {
      setError('Give this part of the day a start and finish time.')
      return
    }
    await persist(withDraft(draft))
  }

  async function removePart() {
    if (draftAt === null) return
    await persist(slots.filter((_, i) => i !== draftAt))
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

      {/* The day-parts, as a table you read down: a trainer checking their week
          wants to compare times and prices, which a stack of open forms makes
          impossible. A row opens the part in the same editor the drop-in class
          form uses, so there is still only one slot editor in the app. */}
      <div className="p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900">Parts of the day</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              One row per part, per day it runs. Tap a row to change it.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saved && !saving && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
            <button
              type="button"
              onClick={addPart}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-teal-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-700"
            >
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Add part
            </button>
          </div>
        </div>

        {/* The table carries its own white — the card behind it is white too,
            but the head's tint needs something to sit on. */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className={`${PART_ROW} h-9 border-b border-slate-200 bg-slate-50/70`}>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Day</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Time</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-right">Dogs</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 text-right">Price</span>
            <span className={`${WIDE_CELL} text-[11px] font-semibold uppercase tracking-wide text-slate-400`}>Where</span>
            <span aria-hidden />
          </div>

          {slots.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-500">
              No parts yet. Add the first one and your board fills in.
            </p>
          ) : (
            <div className="[&>*+*]:border-t [&>*+*]:border-slate-100">
              {slots.map((s, i) => (
                <PartRow
                  key={s.id}
                  slot={s}
                  sym={sym}
                  locationName={locs.find(l => l.id === s.locationId)?.name ?? null}
                  onOpen={() => openPart(i)}
                />
              ))}
            </div>
          )}
        </div>

        {/* A failure that happened with the sheet already closed (a removal) has
            nowhere else to land. */}
        {!draft && error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
        )}

        {/* Honest about the one thing this can't do. Sessions already in the
            diary were generated from these parts when the daycare was created;
            changing a part here changes what a part IS and what the board's
            columns are, but it does not go back and move days already booked. */}
        <p className="mt-3 text-xs text-slate-400">
          Days already in the diary keep the times they were created with — change one of those on the day itself.
        </p>
      </div>

      {draft && (
        <FullScreenSheet
          title={draftAt === null ? 'Add a part of the day' : 'Edit this part'}
          sub={school.name}
          onClose={closeSheet}
          footer={
            <>
              {error && (
                <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>
              )}
              <div className="flex items-center justify-between gap-3">
                {draftAt === null ? <span /> : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="rounded-xl px-2 py-2 text-sm font-semibold text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeSheet}
                    className="rounded-xl px-3 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={savePart}
                    disabled={saving}
                    className="inline-flex items-center gap-2 rounded-xl bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save part
                  </button>
                </div>
              </div>
            </>
          }
        >
          <SessionSlotsEditor
            value={draft}
            onChange={onDraftChange}
            locations={locs}
            team={team}
            region={region}
            onLocationCreated={loc => setLocs(prev => [...prev, { id: loc.id, name: loc.name }])}
          />
        </FullScreenSheet>
      )}

      {confirmRemove && (
        <ConfirmSheet
          title="Remove this part of the day?"
          body="Your board stops offering it. Days already in the diary keep the times they were created with."
          confirmLabel="Remove it"
          danger
          busy={saving}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={removePart}
        />
      )}
    </div>
  )
}

/** One part of the day, as a row you can open. */
function PartRow({
  slot,
  sym,
  locationName,
  onOpen,
}: {
  slot: SessionSlot
  sym: string
  locationName: string | null
  onOpen: () => void
}) {
  const time = slot.start && slot.end ? `${clock(slot.start)}–${clock(slot.end)}` : 'No time yet'
  // What a parent would actually pay, which is the special when there is one —
  // the struck original belongs on a card, not down a column.
  const onSpecial = !!slot.specialPrice.trim()
  const price = onSpecial ? slot.specialPrice.trim() : slot.price.trim()

  return (
    // The WHOLE row is the button, so every cell is a grid item of the same box
    // and the text lines up. A link or button inside a single cell would pick up
    // the 44px minimum touch target globals.css puts on every <a>/<button> and
    // sit a dozen pixels above the plain-text cells beside it.
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit the ${DAY_LONG[slot.day] ?? ''} ${time} part`}
      className={`${PART_ROW} h-14 w-full text-left transition-colors hover:bg-slate-50`}
    >
      <span className="truncate text-sm font-medium text-slate-900">
        <span className="sm:hidden">{DAY_SHORT[slot.day] ?? '—'}</span>
        <span className="hidden sm:inline">{DAY_LONG[slot.day] ?? '—'}</span>
      </span>
      <span className={`truncate text-sm ${slot.start && slot.end ? 'text-slate-600' : 'text-slate-400'}`}>{time}</span>
      <span className="text-right text-sm tabular-nums text-slate-500">{slot.capacity.trim() || '∞'}</span>
      {price ? (
        <span className={`text-right text-sm font-semibold tabular-nums ${onSpecial ? 'text-rose-600' : 'text-slate-900'}`}>
          {sym}{price}
        </span>
      ) : (
        <span className="text-right text-sm text-slate-400">—</span>
      )}
      <span className={`${WIDE_CELL} truncate text-sm text-slate-500`}>{locationName ?? '—'}</span>
      <ChevronRight className="h-4 w-4 text-slate-300" strokeWidth={1.75} aria-hidden />
    </button>
  )
}
