'use client'

import { useState, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { isRichTextEmpty } from '@/lib/rich-text'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { XeroAccountField } from '@/components/shared/xero-account-field'
import { RequirePaymentField } from '@/components/shared/require-payment-field'
import { BufferField } from '@/components/shared/buffer-field'
import { PlaceAutocomplete } from '@/components/maps/place-autocomplete'
import { ImageUploadButton } from '@/components/image-uploader'
import { DateTimePicker } from '@/components/shared/date-time-picker'
import { AddLocationModal } from '@/components/shared/add-location-modal'
import { SessionSlotsEditor, newSlot, type SessionSlot } from '@/components/shared/session-slots'
import { TicketTiersEditor, newTier, type TicketTier } from '@/components/shared/ticket-tiers'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { User, Users, CalendarDays, X, ChevronDown, Check, Plus, MapPin, type LucideIcon } from 'lucide-react'
import { PUBLIC_CLASS_ENROLLMENT_ENABLED } from '@/lib/feature-flags'
import { isValidSpecialPrice, SPECIAL_PRICE_TOO_HIGH } from '@/lib/special-price'

export type PackageColor = 'blue' | 'emerald' | 'amber' | 'rose' | 'purple' | 'orange' | 'teal' | 'indigo' | 'pink' | 'cyan'

// The four things a trainer can create. A UI-level discriminator over the
// persisted Package flags (isGroup / allowDropIn / sessionCount / recurrence).
type OfferingKind = 'onetoone' | 'group' | 'dropin' | 'oneoff'

// What each kind IS, in the trainer's words. A casual class is a group class
// that takes single-session bookings, so it presets isGroup + allowDropIn.
const OFFERING_KINDS = [
  { key: 'onetoone', icon: User, label: '1:1 consult', desc: 'One-on-one sessions you book with a single client — grooming, a training session, a behaviour consult.' },
  { key: 'group', icon: Users, label: 'Group class', desc: 'A cohort shares one schedule and roster and signs up for the whole course.' },
  { key: 'dropin', icon: Users, label: 'Casual class', desc: 'People join one session at a time and pay per session — great for casual regulars.' },
  { key: 'oneoff', icon: CalendarDays, label: 'One-off event', desc: 'A single event on one date — a workshop, seminar or meet-up people sign up to.' },
] as const satisfies readonly { key: OfferingKind; icon: LucideIcon; label: string; desc: string }[]

// One text field, one dropdown, so they line up down the form.
const FIELD_CLASS = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
// A native <select> paints its chevron INSIDE its padding box, so an even px-3
// leaves a long option ("Ongoing (no fixed end)") running straight into the
// arrow. Give the right edge room for it.
const SELECT_CLASS = 'h-11 w-full rounded-xl border border-slate-200 bg-white pl-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

const COLOR_OPTIONS: { id: PackageColor; label: string; swatch: string }[] = [
  { id: 'blue',    label: 'Blue',    swatch: 'bg-blue-500' },
  { id: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500' },
  { id: 'amber',   label: 'Amber',   swatch: 'bg-amber-500' },
  { id: 'rose',    label: 'Rose',    swatch: 'bg-rose-500' },
  { id: 'purple',  label: 'Purple',  swatch: 'bg-purple-500' },
  { id: 'orange',  label: 'Orange',  swatch: 'bg-orange-500' },
  { id: 'teal',    label: 'Teal',    swatch: 'bg-teal-500' },
  { id: 'indigo',  label: 'Indigo',  swatch: 'bg-indigo-500' },
  { id: 'pink',    label: 'Pink',    swatch: 'bg-pink-500' },
  { id: 'cyan',    label: 'Cyan',    swatch: 'bg-cyan-500' },
]

export interface PkgRow {
  id: string
  name: string
  description: string | null
  sessionCount: number
  weeksBetween: number
  durationMins: number
  // "Gap before the next session" — optional so older loaders that don't select
  // it still satisfy the type; the form defaults it to 0.
  bufferMins?: number
  sessionType: 'IN_PERSON' | 'VIRTUAL'
  priceCents: number | null
  specialPriceCents: number | null
  color: PackageColor | null
  defaultSessionFormId: string | null
  requireSessionNotes: boolean
  // Group-class config (optional so an older loader that doesn't select
  // them still satisfies the type — the form defaults them).
  isGroup?: boolean
  /** Declared at creation: this offering is a one-off EVENT, not a class.
   *  Never re-derived from the shape — that's what made a one-session class
   *  turn into an event the moment it was saved. */
  isEvent?: boolean
  capacity?: number | null
  allowDropIn?: boolean
  dropInPriceCents?: number | null
  recurrenceRule?: string | null
  allowWaitlist?: boolean
  publicEnrollment?: boolean
  clientSelfBook?: boolean
  selfBookRequiresApproval?: boolean
  xeroAccountCode?: string | null
  requirePayment?: boolean | null
  // A drop-in class's schedule slots, as stored. Optional so loaders that don't
  // select them still satisfy the type — the form then starts with one blank.
  sessionSlots?: StoredSlot[]
  ticketTiers?: StoredTier[]
  // The class this offering is scheduled as, when it has exactly one run — the
  // form then edits that class's venue/cover/staff too, and sends rescheduling
  // to the class page (which knows not to move sessions people have attended).
  classRunId?: string | null
  runCount?: number
  /** When the class starts. Editing this moves the whole series. */
  startAtIso?: string | null
  /** Someone has been marked present, so the dates can no longer move. */
  hasAttendance?: boolean
  /** The scheduled class's lifecycle state. */
  runStatus?: 'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'
  scheduleNote?: string | null
  location?: string | null
  imageUrl?: string | null
  assignedMembershipIds?: string[]
  assignments: number
}

/** A PackageTicketTier as it comes back from the server (cents). */
export interface StoredTier {
  id: string
  name: string
  priceCents: number | null
  capacity: number | null
  xeroAccountCode: string | null
}

/** A PackageSessionSlot as it comes back from the server (cents, ISO date). */
export interface StoredSlot {
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

export interface SessionFormOption {
  id: string
  name: string
}

// We collect price as a decimal string from the user (e.g. "120" or "120.50")
// then convert to cents server-side. This keeps the input UX natural without
// pulling in a money/decimal library.
const formSchema = z.object({
  name: z.string().min(1, 'Name required'),
  description: z.string().optional(),
  // 0 = ongoing — the trainer picks an end date when assigning the package.
  sessionCount: z.number().int().min(0).max(52),
  weeksBetween: z.number().int().min(0).max(52),
  durationMins: z.number().int().min(15).max(480),
  sessionType: z.enum(['IN_PERSON', 'VIRTUAL']),
  price: z.string().optional(),
  specialPrice: z.string().optional(),
  color: z.enum(['blue', 'emerald', 'amber', 'rose', 'purple', 'orange', 'teal', 'indigo', 'pink', 'cyan']).nullable().optional(),
}).superRefine((v, ctx) => {
  // The special price is the amount actually charged and is shown next to the
  // normal one as a saving — set it higher and the offering advertises a
  // discount while billing more. Caught here so the trainer reads a sentence
  // under the field they're typing in, and again in the API, which is what
  // actually makes it true.
  if (!isValidSpecialPrice(dollarsToCents(v.price), dollarsToCents(v.specialPrice))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['specialPrice'],
      message: SPECIAL_PRICE_TOO_HIGH,
    })
  }
})

/** Stored slot → editor slot. Keeps the real id so a save updates in place
 *  (and every session already generated off it keeps its price). */
function storedToSlot(s: StoredSlot): SessionSlot {
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

/** Stored tier → editor tier. Keeps the real id so a save updates in place. */
function storedToTier(t: StoredTier): TicketTier {
  return {
    id: t.id,
    name: t.name,
    account: t.xeroAccountCode ?? '',
    price: centsToDollars(t.priceCents),
    capacity: t.capacity == null ? '' : String(t.capacity),
  }
}

/** Editor slot → API payload. Ids the server doesn't recognise are treated as
 *  new slots, so a locally-added card needs no special casing here. */
function slotToPayload(s: SessionSlot) {
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

export function dollarsToCents(s: string | undefined): number | null {
  if (!s || !s.trim()) return null
  const n = parseFloat(s)
  if (Number.isNaN(n) || n < 0) return null
  return Math.round(n * 100)
}

export function centsToDollars(cents: number | null): string {
  if (cents === null || cents === undefined) return ''
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

type FormValues = z.infer<typeof formSchema>

/**
 * The shared package create/edit form. Used on the create page (/offerings/new)
 * and the edit page (/packages/[packageId]/edit). Lays its fields out in a
 * responsive two-column grid (short inputs pair up; description, toggles and
 * the colour picker span both). Renders the fields + submit/cancel actions;
 * the surrounding page chrome is the caller's concern.
 */
export function PackageForm({
  existing,
  sessionForms,
  region,
  initialKind,
  onCancel,
  onSaved,
}: {
  existing: PkgRow | null
  sessionForms: SessionFormOption[]
  /** ISO country code for localising Google address suggestions. */
  region?: string
  /** Pre-select the kind when creating (from the "+" menu on a specific page). */
  initialKind?: OfferingKind
  onCancel: () => void
  onSaved: (p: PkgRow, isNew: boolean) => void
}) {
  // Editing an existing offering drops the wizard chrome: no step numbers, no
  // "What are you setting up?" chooser — just the fields, plus Delete/Clone.
  const stepped = !existing
  const [deleting, setDeleting] = useState(false)
  const [cloning, setCloning] = useState(false)
  async function handleDelete() {
    if (!existing || deleting) return
    if (!confirm('Delete this offering? This can’t be undone.')) return
    setDeleting(true)
    const res = await fetch(`/api/packages/${existing.id}`, { method: 'DELETE' })
    if (res.ok) window.location.href = '/packages'
    else { setError('Could not delete this offering.'); setDeleting(false) }
  }
  async function handleClone() {
    if (!existing || cloning) return
    setCloning(true)
    const res = await fetch(`/api/packages/${existing.id}/clone`, { method: 'POST' })
    const body = await res.json().catch(() => null) as { id?: string } | null
    if (res.ok && body?.id) window.location.href = `/packages/${body.id}/edit`
    else { setError('Could not clone this offering.'); setCloning(false) }
  }
  const [error, setError] = useState<string | null>(null)
  const [color, setColor] = useState<PackageColor | null>(existing?.color ?? null)
  const [defaultSessionFormId, setDefaultSessionFormId] = useState<string | null>(existing?.defaultSessionFormId ?? null)
  const [requireSessionNotes, setRequireSessionNotes] = useState<boolean>(existing?.requireSessionNotes ?? true)
  // Turnaround gap blocked out after each session of this package.
  const [bufferMins, setBufferMins] = useState<number>(existing?.bufferMins ?? 0)
  // Group-class config — extra state (not RHF fields). New offerings can be
  // pre-set to a kind via the "+" menu (initialKind).
  const [isGroup, setIsGroup] = useState<boolean>(existing?.isGroup ?? (initialKind != null && initialKind !== 'onetoone'))
  const [capacity, setCapacity] = useState<string>(
    existing?.capacity != null ? String(existing.capacity) : '',
  )
  const [allowDropIn, setAllowDropIn] = useState<boolean>(existing?.allowDropIn ?? (initialKind === 'dropin'))
  const [dropInPrice, setDropInPrice] = useState<string>(centsToDollars(existing?.dropInPriceCents ?? null))
  const [recurrenceRule, setRecurrenceRule] = useState<string>(existing?.recurrenceRule ?? '')
  // Class-only scheduling (lives on a ClassRun today — see the audit). Shown for
  // the class/drop-in/one-off kinds so this one form covers "when / where / who".
  // NOT yet wired to run creation — captured for review while we shape the form.
  const [startAt, setStartAt] = useState<Date | null>(existing?.startAtIso ? new Date(existing.startAtIso) : null)
  // True when this offering is already in the diary as exactly one class.
  const scheduled = !!existing?.classRunId
  const hasAttendance = !!existing?.hasAttendance
  const [runStatus, setRunStatus] = useState<'SCHEDULED' | 'RUNNING' | 'COMPLETED' | 'CANCELLED'>(
    existing?.runStatus ?? 'SCHEDULED',
  )
  const [location, setLocation] = useState<string>(existing?.location ?? '')
  const [imageUrl, setImageUrl] = useState<string | null>(existing?.imageUrl ?? null)
  const [scheduleNote, setScheduleNote] = useState<string>(existing?.scheduleNote ?? '')
  // Drop-in classes define their weekly slots individually (day/time/location).
  // Editing hydrates them from the stored schedule so a save round-trips.
  const [slots, setSlots] = useState<SessionSlot[]>(() =>
    existing?.sessionSlots?.length ? existing.sessionSlots.map(storedToSlot) : [newSlot()],
  )
  // Join link for a virtual session (Zoom/Meet); only when session type = Virtual.
  const [virtualLink, setVirtualLink] = useState<string>('')
  // Simple ticket tiers for a one-off event (name + price + capacity).
  const [tickets, setTickets] = useState<TicketTier[]>(() =>
    existing?.ticketTiers?.length ? existing.ticketTiers.map(storedToTier) : [newTier()],
  )
  // Who delivers this — assignable for every kind. Fetched client-side (the
  // team endpoint returns membership ids). NOT yet wired to persistence.
  const [team, setTeam] = useState<{ id: string; name: string | null; title: string | null }[]>([])
  const [assignedIds, setAssignedIds] = useState<string[]>(existing?.assignedMembershipIds ?? [])
  const [assignOpen, setAssignOpen] = useState(false)
  // Saved locations to pick from (built in Settings → Locations). '' = none,
  // a location id = that saved place, '__custom' = type a one-off address.
  // A saved location carries a picture. The offering only stores the venue as
  // free text, so that picture is only reachable by matching the stored text
  // back to the row it came from — which is exactly what the picker does below.
  const [savedLocations, setSavedLocations] = useState<{ id: string; name: string; address: string | null; imageUrl: string | null }[]>([])
  const [locationChoice, setLocationChoice] = useState<string>('')
  const [addLocationOpen, setAddLocationOpen] = useState(false)
  useEffect(() => {
    let off = false
    fetch('/api/trainer/locations')
      .then(r => (r.ok ? r.json() : null))
      .then((d: { locations?: { id: string; name: string; address: string | null; imageUrl: string | null }[] } | null) => {
        if (!off && d?.locations) {
          const rows = d.locations.map(l => ({ id: l.id, name: l.name, address: l.address, imageUrl: l.imageUrl ?? null }))
          setSavedLocations(rows)
          // Re-select what this offering was saved with. Without this the
          // dropdown reopens on "Choose location…" however many times you set
          // it — the venue looks lost, and the location's image never shows
          // because nothing knows which location it is. Matched on address
          // first (that's what gets stored), then on name for the rows saved
          // with no address.
          setLocationChoice(prev => {
            if (prev) return prev
            const stored = (existing?.location ?? '').trim()
            if (!stored) return prev
            const hit = rows.find(l => (l.address ?? '').trim() === stored) ?? rows.find(l => l.name.trim() === stored)
            return hit ? hit.id : prev
          })
        }
      })
      .catch(() => {})
    return () => { off = true }
  }, [existing?.location])
  const chosenLocation = savedLocations.find(l => l.id === locationChoice) ?? null
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
  // The offering kind drives the card selection + which schedule fields show.
  // Read from what the offering SAYS it is. This used to re-derive "event" from
  // the shape (one session, no recurrence) — so opening an ordinary class that
  // runs once showed it as an event and saving re-persisted it as one, moving
  // it off the trainer's Classes list for good.
  const [kind, setKind] = useState<OfferingKind>(() => {
    if (!existing) return initialKind ?? 'onetoone'
    if (!existing.isGroup) return 'onetoone'
    if (existing.allowDropIn) return 'dropin'
    if (existing.isEvent) return 'oneoff'
    return 'group'
  })
  // Asking "what are you setting up?" only makes sense when the answer isn't
  // already known. Arriving from Consults, Classes, Casual classes or Events
  // the kind came with the link, so the question is noise — and worse, it
  // invites a trainer to change what they already said they were making. It is
  // only asked from the generic "New offering", where it is the FIRST step.
  const needsKindStep = stepped && initialKind == null

  function selectKind(k: OfferingKind) {
    setKind(k)
    setIsGroup(k !== 'onetoone')
    setAllowDropIn(k === 'dropin')
    if (k === 'oneoff') setRecurrenceRule('')
    // On its own step, choosing IS the step — move straight on to the details
    // rather than making them reach for Next.
    if (needsKindStep && currentKey === 'kind') setWstep(s => s + 1)
  }
  // Add-mode wizard: one section per step (a drop-in has no pricing step).
  // Editing shows every section on one page (stepped === false).
  const stepKeys: string[] = [
    ...(needsKindStep ? ['kind'] : []),
    'start', 'schedule', ...(kind === 'dropin' ? [] : ['pricing']), 'settings',
  ]
  const [wstep, setWstep] = useState(0)
  const clampedStep = Math.min(wstep, stepKeys.length - 1)
  const currentKey = stepKeys[clampedStep]
  const onSection = (k: string) => !stepped || currentKey === k
  const isLastStep = clampedStep === stepKeys.length - 1
  // Cards carry their step number in both modes, so the one-page edit reads as
  // the same ordered steps you filled in when you created it.
  const stepNo = (k: string) => stepKeys.indexOf(k) + 1
  // Saving is something the trainer ASKS for. Set only by the save button, and
  // read once per submit — so a step change, or Enter in any field, can never
  // create the offering behind their back.
  const saveIntent = useRef(false)
  const [allowWaitlist, setAllowWaitlist] = useState<boolean>(existing?.allowWaitlist ?? false)
  const [publicEnrollment, setPublicEnrollment] = useState<boolean>(existing?.publicEnrollment ?? false)
  // Client self-booking (independent of group classes).
  const [xeroAccountCode, setXeroAccountCode] = useState<string>(existing?.xeroAccountCode ?? '')
  const [xeroActive, setXeroActive] = useState(false)
  const [clientSelfBook, setClientSelfBook] = useState<boolean>(existing?.clientSelfBook ?? false)
  const [selfBookRequiresApproval, setSelfBookRequiresApproval] = useState<boolean>(existing?.selfBookRequiresApproval ?? true)
  const [requirePayment, setRequirePayment] = useState<boolean | null>(existing?.requirePayment ?? null)
  const { register, handleSubmit, watch, setValue, trigger, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: existing
      ? {
          name: existing.name,
          description: existing.description ?? '',
          sessionCount: existing.sessionCount,
          weeksBetween: existing.weeksBetween,
          durationMins: existing.durationMins,
          sessionType: existing.sessionType,
          price: centsToDollars(existing.priceCents),
          specialPrice: centsToDollars(existing.specialPriceCents),
        }
      : { sessionCount: 1, weeksBetween: 2, durationMins: 60, sessionType: 'IN_PERSON', price: '', specialPrice: '' },
  })

  // A one-off package — a single session, no cadence. "Weeks between" is moot.
  const oneOff = Number(watch('sessionCount')) === 1

  // A blocked save has to say why — ALWAYS. Field-level errors are only enough
  // when the field is on screen, and it often isn't: the wizard shows one card
  // at a time, and even the one-page edit collapses cards. This used to name
  // just two fields (special price, name), so a validation failure anywhere
  // else — a duration under the 15-minute minimum on a class created elsewhere
  // with a shorter one, a session count out of range — blocked the save with
  // nothing on screen at all. That is the trainer's "the Save button doesn't
  // work": it worked, it was refusing, and it refused in silence.
  //
  // Take whatever the resolver actually complained about, in field order, and
  // say it at the top of the form.
  function onInvalid(errs: typeof errors) {
    const ORDER = ['name', 'specialPrice', 'price', 'sessionCount', 'weeksBetween', 'durationMins', 'sessionType', 'description', 'color'] as const
    const named = ORDER.map(k => errs[k]?.message).find((m): m is string => !!m)
    // Nothing recognised still has to surface — never fall through to silence.
    const any = Object.values(errs).map(e => (e as { message?: string })?.message).find((m): m is string => !!m)
    setError(named ?? any ?? 'Some of the details on this form need fixing before it can be saved.')
  }

  // Convert 1:1 ↔ group. Its own request because the server refuses the change
  // while the package is in use and explains why — a message worth showing
  // rather than folding into a generic save failure.
  async function onSubmit(values: FormValues) {
    // While the wizard is running, only the last step's save button may save.
    // Every other submit is one the trainer didn't ask for — an Enter keypress
    // in a field, or the footer button changing from Next to Create under the
    // pointer (a click's activation behaviour is resolved AFTER React has
    // re-rendered, so the browser sees a submit button and submits).
    const intended = saveIntent.current
    saveIntent.current = false
    if (stepped && !(intended && isLastStep)) return
    setError(null)
    // When Xero is connected with a curated shortlist, the income account is
    // required so every package/class posts to a real Xero account.
    if (xeroActive && !xeroAccountCode) {
      setError('Choose a Xero income account for this consult.')
      return
    }
    // Slot times start blank so nobody publishes a guessed hour by accident —
    // which means catching the blanks here, with a sentence, rather than
    // letting the server reject the shape.
    if (kind === 'dropin' && slots.some(s => !s.start || !s.end)) {
      setError('Give every session a start and finish time.')
      return
    }
    // Moving a class that has attendance recorded is refused (the rebuild would
    // delete the sessions the register hangs off). The payload has always just
    // DROPPED the new date in that case, so the save came back fine and the
    // date sprang back to what it was — "I changed it, hit Save, nothing
    // happened". Say so instead of quietly ignoring them.
    const startMoved =
      !!existing && isGroup && !!startAt &&
      startAt.toISOString() !== (existing.startAtIso ?? null)
    if (startMoved && hasAttendance) {
      setError("Attendance has already been recorded on this class, so its dates are fixed. Change anything else here, or cancel this class and create a new one to move it.")
      return
    }
    const url = existing ? `/api/packages/${existing.id}` : '/api/packages'
    const method = existing ? 'PATCH' : 'POST'
    // Convert the dollar-string price fields into cents before sending; the
    // server stores cents to dodge floating-point math.
    const { price, specialPrice, ...rest } = values
    // One cadence model for all kinds: N sessions every W weeks (a one-off
    // event is just 1 session, no cadence).
    const sessionCount = kind === 'oneoff' ? 1 : values.sessionCount
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...rest,
        sessionCount,
        // A single-session offering has no cadence — store 0 rather than
        // whatever was last typed into the (now hidden) weeks field.
        weeksBetween: Number(sessionCount) === 1 ? 0 : values.weeksBetween,
        description: values.description || null,
        priceCents: dollarsToCents(price),
        specialPriceCents: dollarsToCents(specialPrice),
        bufferMins,
        color,
        defaultSessionFormId,
        // Hidden for a one-off event (see the Settings card), so never leave a
        // stale `true` behind nudging the trainer to write session notes on a
        // single occasion that either happened or didn't.
        requireSessionNotes: kind === 'oneoff' ? false : requireSessionNotes,
        isGroup,
        // WHAT THIS IS, stated outright. The one place that knows an offering is
        // an event is the trainer picking "One-off event" here (or arriving from
        // /offerings/new?kind=oneoff); before this it was never persisted and
        // every screen guessed from the shape instead. Sent on edit too — always
        // the current selection, so re-saving a class keeps it a class.
        isEvent: kind === 'oneoff',
        capacity: isGroup && capacity.trim() ? Math.max(0, Math.floor(Number(capacity))) : null,
        allowDropIn: isGroup && allowDropIn,
        dropInPriceCents: isGroup && allowDropIn ? dollarsToCents(dropInPrice) : null,
        // A drop-in class IS its schedule — send the slots so each session
        // keeps its own day, time, venue, staff, capacity and price. The server
        // derives allowDropIn / the headline price from them.
        ...(kind === 'dropin' && { sessionSlots: slots.map(slotToPayload) }),
        // What a one-off event sells. The editor always keeps one empty row for
        // you to type into, and the server's tier schema requires a name — so
        // sending that empty row failed the whole save with a flat "Failed to
        // save." on any event that hadn't been given ticket types yet. Drop the
        // blanks here, which is what "unnamed tiers are dropped" always meant.
        ...(kind === 'oneoff' && {
          ticketTiers: tickets.filter(t => t.name.trim()).map(t => ({
            id: t.id,
            name: t.name,
            priceCents: dollarsToCents(t.price),
            capacity: t.capacity.trim() ? Math.max(0, Math.floor(Number(t.capacity))) : null,
            xeroAccountCode: t.account || null,
          })),
        }),
        // Scheduling. A group offering saved with a start date is put in the
        // diary as well as defined: the server creates its first class run and
        // that run's sessions, so it appears on /classes (or /events) at once.
        // Only on create — rescheduling an existing class is its own flow, with
        // the "don't move sessions that already have attendance" guard.
        // The start date. On create it schedules the class; on edit it MOVES
        // it — the server rebuilds the sessions, and refuses once anyone has
        // been marked present.
        ...(isGroup && startAt && !hasAttendance && { startAt: startAt.toISOString() }),
        // The cover image belongs to the OFFERING, not to the class it happens
        // to be scheduled as — a 1:1 consult has a picture too, and it has no
        // run. Sending it only for group offerings is why an image added to a
        // package vanished on save: the key never left the browser, and the
        // server treated the missing key as "clear it".
        imageUrl,
        // Venue / note / staff belong to the scheduled class. Sent on
        // create AND edit — on edit the server applies them to the run, which
        // is the whole reason they're on this form.
        ...(isGroup && {
          ...(scheduled && { status: runStatus }),
          scheduleNote: scheduleNote || null,
          location: location || null,
          assignedMembershipIds: assignedIds,
        }),
        recurrenceRule: isGroup && recurrenceRule ? recurrenceRule : null,
        allowWaitlist,
        publicEnrollment: isGroup && publicEnrollment,
        clientSelfBook,
        selfBookRequiresApproval,
        xeroAccountCode: xeroAccountCode || null,
        requirePayment,
      }),
    })
    if (!res.ok) {
      // The convert-while-in-use refusal (409) explains itself — show that
      // rather than a generic failure the trainer can't act on.
      const body = await res.json().catch(() => null) as { error?: unknown } | null
      setError(typeof body?.error === 'string' ? body.error : 'Failed to save.')
      return
    }
    const saved = await res.json()
    onSaved(
      {
        id: saved.id,
        name: saved.name,
        description: saved.description,
        sessionCount: saved.sessionCount,
        weeksBetween: saved.weeksBetween,
        durationMins: saved.durationMins,
        bufferMins: saved.bufferMins ?? 0,
        sessionType: saved.sessionType,
        priceCents: saved.priceCents ?? null,
        specialPriceCents: saved.specialPriceCents ?? null,
        color: saved.color ?? null,
        imageUrl: saved.imageUrl ?? null,
        defaultSessionFormId: saved.defaultSessionFormId ?? null,
        requireSessionNotes: saved.requireSessionNotes ?? true,
        isGroup: saved.isGroup ?? false,
        capacity: saved.capacity ?? null,
        allowDropIn: saved.allowDropIn ?? false,
        dropInPriceCents: saved.dropInPriceCents ?? null,
        recurrenceRule: saved.recurrenceRule ?? null,
        allowWaitlist: saved.allowWaitlist ?? false,
        publicEnrollment: saved.publicEnrollment ?? false,
        clientSelfBook: saved.clientSelfBook ?? false,
        selfBookRequiresApproval: saved.selfBookRequiresApproval ?? true,
        xeroAccountCode: saved.xeroAccountCode ?? null,
        requirePayment: saved.requirePayment ?? null,
        assignments: existing?.assignments ?? 0,
      },
      !existing
    )
  }

  return (
    // Sections are full-width cards now; the two-column grid lives INSIDE each
    // card, so the page is a simple stack whatever the screen width.
    <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex flex-col gap-3">
      {error && <div className="md:col-span-2"><Alert variant="error">{error}</Alert></div>}

      {addLocationOpen && (
        <AddLocationModal
          region={region}
          onClose={() => setAddLocationOpen(false)}
          onCreated={loc => {
            setSavedLocations(prev => [...prev, { id: loc.id, name: loc.name, address: loc.address, imageUrl: loc.imageUrl }])
            setLocationChoice(loc.id)
            setLocation(loc.address || loc.name)
            setAddLocationOpen(false)
          }}
        />
      )}

      {/* Wizard progress — only when adding. */}
      {stepped && (
        <div className="md:col-span-2 flex items-center gap-1.5 mb-1">
          {stepKeys.map((k, i) => (
            <div key={k} className="flex flex-1 items-center gap-1.5">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < clampedStep ? 'bg-blue-600 text-white' : i === clampedStep ? 'bg-blue-600 text-white ring-4 ring-blue-100' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</span>
              {i < stepKeys.length - 1 && <span className={`h-0.5 flex-1 rounded ${i < clampedStep ? 'bg-blue-600' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {/* ── Kind: what are you setting up? ───────────────────────────
          Its own step, and only when the link didn't already say. Choosing
          moves straight on, so it costs one tap. */}
      {needsKindStep && onSection('kind') && (
      <SectionCard
        step={stepNo('kind')}
        title="What are you setting up?"
        intro="Pick what this offering is. Your choice sets up the right options in the next steps."
      >
        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {OFFERING_KINDS.map(o => {
            const active = kind === o.key
            const Icon = o.icon
            return (
              <button
                key={o.key}
                type="button"
                onClick={() => selectKind(o.key)}
                aria-pressed={active}
                className={`rounded-2xl border p-4 text-left transition-all ${active ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500' : 'border-slate-200 bg-white hover:border-blue-200'}`}
              >
                <Icon className={`h-5 w-5 mb-2 ${active ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className={`block text-sm font-semibold ${active ? 'text-blue-900' : 'text-slate-800'}`}>{o.label}</span>
                <span className="block text-xs text-slate-500 mt-1 leading-snug">{o.desc}</span>
              </button>
            )
          })}
        </div>
      </SectionCard>
      )}

      {/* ── Start: name ──────────────────────────────────────────── */}
      {onSection('start') && (
      <SectionCard
        step={stepNo('start')}
        title="Details"
        intro="Give your offering a clear name your clients will recognise, and say what it involves."
      >

      <div className="md:col-span-2">
        <Input label="Name" placeholder="e.g. Puppy Foundations · 6 sessions" autoFocus={stepped} error={errors.name?.message} {...register('name')} />
      </div>

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Description (optional)</label>
        <RichTextEditor
          value={watch('description') ?? ''}
          onChange={html => setValue('description', isRichTextEmpty(html) ? '' : html, { shouldDirty: true })}
          minHeight={120}
          theme="light"
        />
      </div>

      </SectionCard>
      )}

      {/* ── Sessions & schedule ──────────────────────────────────── */}
      {onSection('schedule') && (
      <SectionCard
        step={stepNo('schedule')}
        title="Sessions &amp; schedule"
        intro={
          kind === 'oneoff'
            ? 'Set the single date and time your event runs, plus where it takes place.'
            : kind === 'dropin'
            ? 'Add each session people can drop into. Give every one its own day, time, capacity, price and location — duplicate or reorder them as needed.'
            : kind === 'group'
            ? 'Set when the class runs — the first session’s date and time, how many sessions, and how many weeks apart — plus capacity and location.'
            : 'Set how long each session lasts and how many are in the consult.'
        }
      >

      {/* Say it BEFORE they start typing, not after they press Save. The dates
          are the first thing on this card, and finding out they're locked only
          once the save is refused is how "the Save button doesn't work" starts. */}
      {scheduled && hasAttendance && (
        <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
          Attendance has already been recorded on this class, so its dates are fixed.
          Change anything else here, or cancel this class and create a new one to move it.
        </div>
      )}

      {/* One schedule model everywhere: a run of N sessions every W weeks.
          1:1, group and drop-in all use it; only a one-off event has no cadence. */}
      {kind === 'oneoff' ? (
        // A single event has no cadence — its date & time are set below.
        // Keep the RHF fields registered (submit forces 1 session).
        <div className="md:col-span-2">
          <p className="text-xs text-slate-500 rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
            A single event on one date. Set its date &amp; time below.
          </p>
          <div className="hidden">
            <input type="number" {...register('sessionCount', { valueAsNumber: true })} />
            <input type="number" {...register('weeksBetween', { valueAsNumber: true })} />
          </div>
        </div>
      ) : kind === 'dropin' ? (
        // Drop-in classes are a set of self-contained session cards — each with
        // its own start date, time, duration, gap, capacity, location and
        // recurrence. RHF cadence fields kept registered (unused for this kind).
        <div className="md:col-span-2">
          <SessionSlotsEditor
            value={slots}
            onChange={setSlots}
            locations={savedLocations.map(l => ({ id: l.id, name: l.name }))}
            team={team}
            region={region}
            onLocationCreated={loc => setSavedLocations(prev => [...prev, { id: loc.id, name: loc.name, address: loc.address, imageUrl: loc.imageUrl }])}
          />
          <div className="hidden">
            <input type="number" {...register('sessionCount', { valueAsNumber: true })} />
            <input type="number" {...register('weeksBetween', { valueAsNumber: true })} />
          </div>
        </div>
      ) : (
        <>
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Number of sessions</label>
            <select
              {...register('sessionCount', { valueAsNumber: true })}
              className={SELECT_CLASS}
            >
              <option value={1}>One-off (single session)</option>
              {Array.from({ length: 19 }, (_, i) => i + 2).map(n => (
                <option key={n} value={n}>{n} sessions</option>
              ))}
              <option value={0}>Ongoing (no fixed end)</option>
            </select>
          </div>
          {/* Weeks-between only matters once there's more than one session, so it
              appears the moment they pick anything other than One-off. `invisible`
              (not unmounting) keeps the grid cell so nothing below jumps, and the
              field stays registered so its value still submits. */}
          <div className={oneOff ? 'invisible' : undefined} aria-hidden={oneOff}>
            <Input
              label="Weeks between"
              type="number"
              // 0 here meant every session on the same day and time — the
              // generator now floors it at 1, so don't offer 0 either.
              min={1}
              error={errors.weeksBetween?.message}
              {...register('weeksBetween', { valueAsNumber: true })}
            />
          </div>
        </>
      )}

      {/* When / where / cover — unique to a scheduled class (these live on the
          ClassRun today). Shown for the class kinds so this one form covers the
          whole thing. Recurring classes call it the FIRST session's time. */}
      {/* Drop-in keeps these inside its session box (above); other class kinds
          show them here. */}
      {kind !== 'onetoone' && kind !== 'dropin' && (
        <div className="md:col-span-2">
          {/* One-off shows its own Date/Time sub-labels (stacked); the group's
              first-session field keeps the single label. */}
          {kind !== 'oneoff' && (
            <label className="text-sm font-medium text-slate-700 block mb-1.5">First session (date &amp; time)</label>
          )}
          <DateTimePicker value={startAt} onChange={setStartAt} stacked={kind === 'oneoff'} />
          {scheduled && !hasAttendance && (
            <p className="mt-1.5 text-xs text-slate-400">
              Changing the date, how many sessions or how far apart rebuilds this class’s sessions.
            </p>
          )}
        </div>
      )}

      {kind !== 'dropin' && (
        <Input
          label="Duration (mins)"
          type="number"
          error={errors.durationMins?.message}
          {...register('durationMins', { valueAsNumber: true })}
        />
      )}

      {/* Turnaround gap after each session — travel, clean-up, reset. Blocked
          out on the calendar so nothing can be booked into it. */}
      {kind !== 'dropin' && (
        <BufferField id="package-buffer" value={bufferMins} onChange={setBufferMins} />
      )}

      {/* Drop-in classes carry their own per-session details in the cards, so
          the class-level type / capacity / location are hidden for them. */}
      {kind !== 'dropin' && (
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Session type</label>
          <div className="flex gap-2">
            {(['IN_PERSON', 'VIRTUAL'] as const).map(t => (
              <label key={t} className="flex-1">
                <input type="radio" value={t} className="sr-only peer" {...register('sessionType')} />
                <div className="text-center py-2 rounded-xl border border-slate-200 text-sm cursor-pointer peer-checked:border-blue-500 peer-checked:bg-blue-50 peer-checked:text-blue-700 transition-colors">
                  {t === 'IN_PERSON' ? '📍 In person' : '💻 Virtual'}
                </div>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Join link — a virtual session needs somewhere to meet online. */}
      {watch('sessionType') === 'VIRTUAL' && (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Virtual session link</label>
          <input
            type="url"
            value={virtualLink}
            onChange={e => setVirtualLink(e.target.value)}
            placeholder="https://zoom.us/j/… or Google Meet link"
            className={FIELD_CLASS}
          />
        </div>
      )}

      {/* Capacity is a class-only limit, so it sits with the schedule. */}
      {isGroup && kind !== 'dropin' && (
        <div>
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Capacity (optional)</label>
          <input
            type="number"
            min={0}
            value={capacity}
            onChange={e => setCapacity(e.target.value)}
            placeholder="Leave blank for unlimited"
            className={FIELD_CLASS}
          />
          <p className="text-[11px] text-slate-400 mt-1">Max in the room per session. A run can override this.</p>
        </div>
      )}

      {/* Self-enrol option (feature-flagged) for the drop-in kind. The old
          "Drop-in price per session" field was removed on request. */}
      {kind === 'dropin' && PUBLIC_CLASS_ENROLLMENT_ENABLED && (
        <label className="md:col-span-2 flex items-start gap-3 cursor-pointer rounded-xl border border-slate-200 px-3 py-2.5">
          <input type="checkbox" checked={publicEnrollment} onChange={e => setPublicEnrollment(e.target.checked)} className="h-4 w-4 mt-0.5" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-700">Let clients self-enrol from your embed form</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">Open runs show publicly; requests arrive as enquiries for you to accept.</span>
          </span>
        </label>
      )}

      {/* Where this class is up to. Only meaningful once it's in the diary —
          an unscheduled offering has no run to have a status. */}
      {scheduled && (
        <div>
          <label htmlFor="run-status" className="text-sm font-medium text-slate-700 block mb-1.5">Status</label>
          <select
            id="run-status"
            value={runStatus}
            onChange={e => setRunStatus(e.target.value as typeof runStatus)}
            className={SELECT_CLASS}
          >
            {(['SCHEDULED', 'RUNNING', 'COMPLETED', 'CANCELLED'] as const).map(st => (
              <option key={st} value={st}>{st.charAt(0) + st.slice(1).toLowerCase()}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-slate-400">Completed and cancelled classes move to the Past tab.</p>
        </div>
      )}

      {/* The human cadence, in the trainer's own words. It's what the class
          card and the client's booking screen both show, so it's worth being
          able to write ("Tuesdays 6pm") rather than having it inferred. */}
      {kind !== 'onetoone' && kind !== 'dropin' && (
        <div className="md:col-span-2">
          <Input
            label="Schedule note (optional)"
            placeholder="e.g. Tuesdays 6:00pm"
            value={scheduleNote}
            onChange={e => setScheduleNote(e.target.value)}
          />
        </div>
      )}

      {/* Where it meets — same design as the drop-in session location: a
          dropdown of saved locations + a "+" that opens the add-location popup. */}
      {kind !== 'onetoone' && kind !== 'dropin' && (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Location <span className="text-slate-400">(optional)</span></label>
          <div className="flex gap-2">
            <select
              value={locationChoice}
              onChange={e => {
                const v = e.target.value
                setLocationChoice(v)
                const loc = savedLocations.find(l => l.id === v)
                setLocation(loc?.address || loc?.name || '')
              }}
              className={SELECT_CLASS + ' flex-1'}
            >
              <option value="">Choose location…</option>
              {savedLocations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <button
              type="button"
              onClick={() => setAddLocationOpen(true)}
              title="Add a new location"
              aria-label="Add a new location"
              className="h-11 w-11 shrink-0 inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600"
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
          {/* The picture you gave the location, where it's of some use — you can
              see you've picked the right park before you save. One row, hairline
              border, no tint. */}
          {chosenLocation && (
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              {chosenLocation.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={chosenLocation.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover border border-slate-200" />
              ) : (
                <span className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 grid place-items-center">
                  <MapPin className="h-5 w-5 text-slate-400" strokeWidth={1.75} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800 truncate">{chosenLocation.name}</span>
                <span className="block text-[11px] text-slate-400 truncate">{chosenLocation.address || 'No address saved'}</span>
              </span>
            </div>
          )}
        </div>
      )}
      </SectionCard>
      )}

      {/* ── Pricing — a drop-in prices per session, so no pricing step. ── */}
      {kind !== 'dropin' && onSection('pricing') && (
      <SectionCard
        step={stepNo('pricing')}
        title="Pricing"
        hint={
          kind === 'oneoff' ? 'What it costs to attend the event.'
            : kind === 'group' ? 'The full-course price.'
            : 'Leave blank for no set price.'
        }
        intro={
          kind === 'oneoff'
            ? 'Add the ticket types people can buy — name each one and set its price and how many are available.'
            : 'Set the price clients pay. Add a special price to show a discount next to it, or leave it blank if there’s no set price.'
        }
      >

      {/* A one-off event sells tickets (name + price + capacity); everything
          else has a single price (+ optional special). RHF price fields stay
          registered for events so their values still submit harmlessly. */}
      {kind === 'oneoff' ? (
        <>
          <div className="md:col-span-2">
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Tickets</label>
            <TicketTiersEditor value={tickets} onChange={setTickets} />
          </div>
          <div className="hidden">
            <input {...register('price')} />
            <input {...register('specialPrice')} />
          </div>
        </>
      ) : (
        <>
          {/* Leave price blank for "no price set". The special price is
              independent and only shown when populated. */}
          <Input
            label="Price"
            type="text"
            inputMode="decimal"
            placeholder="120"
            {...register('price')}
          />
          <Input
            label="Special price (optional)"
            type="text"
            inputMode="decimal"
            placeholder="—"
            error={errors.specialPrice?.message}
            hint="A discount off the price above."
            {...register('specialPrice')}
          />
        </>
      )}

      {/* Sits with the price — required when Xero is connected so revenue posts
          to the right account. Renders nothing when Xero isn't set up. */}
      <div className="md:col-span-2">
        <XeroAccountField value={xeroAccountCode} onChange={setXeroAccountCode} required onActiveChange={setXeroActive} />
      </div>

      {/* Whether clients must pay up front to book this package. */}
      <div className="md:col-span-2">
        <RequirePaymentField value={requirePayment} onChange={setRequirePayment} />
      </div>
      </SectionCard>
      )}

      {/* ── Settings ─────────────────────────────────────────────── */}
      {onSection('settings') && (
      <SectionCard
        step={stepNo('settings')}
        title="Settings"
        intro="The finishing touches — who runs it, a colour and image to spot it at a glance, and how booking and notes work. All optional; you can change them any time."
      >

      {/* Who delivers it — assignable per kind (drop-in assigns per session). */}
      {team.length > 1 && kind !== 'dropin' && (
        <div className="md:col-span-2">
          <label className="text-sm font-medium text-slate-700 block mb-1.5">Assigned to <span className="text-slate-400">(optional)</span></label>
          <div className="relative">
            <button
              type="button"
              onClick={() => setAssignOpen(o => !o)}
              className="h-11 w-full flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-left hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <span className={`flex-1 truncate ${assignedIds.length ? 'text-slate-900' : 'text-slate-400'}`}>
                {assignedIds.length === 0
                  ? 'Anyone / unassigned'
                  : assignedIds.length === 1
                    ? (team.find(m => m.id === assignedIds[0])?.name ?? 'Team member')
                    : `${assignedIds.length} team members`}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
            </button>
            {assignOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setAssignOpen(false)} />
                <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10">
                  {team.map(m => {
                    const on = assignedIds.includes(m.id)
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setAssignedIds(prev => on ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-300'}`}>
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="text-slate-800">{m.name ?? 'Team member'}{m.title ? <span className="text-slate-400"> · {m.title}</span> : null}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Default session form</label>
        <p className="text-[11px] text-slate-400 mb-1.5">
          Auto-attached to each new session in this consult. Trainer can still swap it on the session.
        </p>
        <select
          value={defaultSessionFormId ?? ''}
          onChange={e => setDefaultSessionFormId(e.target.value || null)}
          className={SELECT_CLASS}
        >
          <option value="">None</option>
          {sessionForms.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>

      {/* Session notes are a package / 1:1 idea — "near the end of each session
          in this consult" means nothing for a one-off event, which is a single
          occasion you either ran or didn't. Don't ask the question, and don't
          send the nudge either (see the submit payload). */}
      {kind !== 'oneoff' && (
        <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={requireSessionNotes}
            onChange={e => setRequireSessionNotes(e.target.checked)}
            className="h-4 w-4 mt-0.5"
          />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-700">Send a follow-up reminder for session notes</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">
              Sends a push near the end of each session in this consult nudging you to write notes. Turn off for drop-in classes or anything that doesn&apos;t need a follow-up.
            </span>
          </span>
        </label>
      )}

      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={allowWaitlist}
          onChange={e => setAllowWaitlist(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">Keep a waitlist when this is full</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            {kind === 'onetoone'
              ? 'People can register interest once you have no room, so you can offer them a spot when one frees up.'
              : 'Once every place is taken, people can join a waitlist instead of being turned away — and are enrolled automatically when someone withdraws.'}
          </span>
        </span>
      </label>

      {/* ─── Client self-booking ─────────────────────────────────── */}
      <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={clientSelfBook}
          onChange={e => setClientSelfBook(e.target.checked)}
          className="h-4 w-4 mt-0.5"
        />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-slate-700">Let clients self-book this from their availability tab</span>
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Clients pick a start time from your real openings; the rest auto-place on the consult cadence.
          </span>
        </span>
      </label>

      {clientSelfBook && (
        <label className="md:col-span-2 flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/40 px-3 py-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={selfBookRequiresApproval}
            onChange={e => setSelfBookRequiresApproval(e.target.checked)}
            className="h-4 w-4 mt-0.5"
          />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-medium text-slate-700">Require my approval before it&apos;s booked</span>
            <span className="block text-[11px] text-slate-400 mt-0.5">
              On: the client&apos;s pick is a request you confirm. Off: it books instantly onto your calendar.
            </span>
          </span>
        </label>
      )}

      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Schedule colour</label>
        <p className="text-[11px] text-slate-400 mb-1.5">Sessions assigned to this consult will use this colour on the calendar. Leave blank to keep the default status colour.</p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setColor(null)}
            className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors ${
              color === null
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            Default
          </button>
          {COLOR_OPTIONS.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setColor(opt.id)}
              aria-label={opt.label}
              className={`h-7 w-7 rounded-full border-2 transition-all ${opt.swatch} ${color === opt.id ? 'border-slate-900 ring-2 ring-slate-300' : 'border-white shadow-sm hover:scale-110'}`}
            />
          ))}
        </div>
      </div>

      {/* Image / icon — every kind, on the last step per request. */}
      <div className="md:col-span-2">
        <label className="text-sm font-medium text-slate-700 block mb-1.5">Image <span className="text-slate-400">(optional)</span></label>
        {imageUrl ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="" className="h-24 w-full max-w-[16rem] rounded-xl object-cover border border-slate-200" />
            <button
              type="button"
              onClick={() => setImageUrl(null)}
              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-white border border-slate-200 text-slate-500 hover:text-red-500 hover:border-red-200 flex items-center justify-center shadow-sm"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <ImageUploadButton onUploaded={urls => { if (urls[0]) setImageUrl(urls[0]) }} />
            <span className="text-xs text-slate-400">Add an icon or cover photo.</span>
          </div>
        )}
      </div>
      </SectionCard>
      )}

      {/* Footer — wizard nav when adding, Save/Delete/Clone when editing. */}
      {stepped ? (
        <>
        {/* Spacer so the last fields clear the fixed mobile footer. */}
        <div className="md:col-span-2 h-20 md:hidden" aria-hidden />
        <div className="md:col-span-2 flex items-center gap-2 fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur md:static md:z-auto md:mt-2 md:bg-transparent md:px-0 md:pb-0 md:backdrop-blur-none">
          {clampedStep > 0 && (
            <Button type="button" variant="ghost" onClick={() => setWstep(s => Math.max(0, s - 1))}>Back</Button>
          )}
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <div className="ml-auto">
            {/* Distinct keys matter: without them React reuses the one DOM node
                and just flips type="button" → type="submit", which the browser
                then treats as the click it is still resolving. A separate node
                means the click that ended the step lands on a button that no
                longer exists, and nothing is submitted. */}
            {isLastStep ? (
              <Button
                key="wizard-save"
                type="submit"
                loading={isSubmitting}
                onClick={() => { saveIntent.current = true }}
              >
                Create offering
              </Button>
            ) : (
              <Button
                key="wizard-next"
                type="button"
                onClick={async () => {
                  if (currentKey === 'start' && !(await trigger('name'))) return
                  // Catch a special price above the price HERE, while the two
                  // fields are still on screen — a submit-time failure two steps
                  // later would just look like a dead Save button.
                  if (currentKey === 'pricing' && !(await trigger('specialPrice'))) return
                  setWstep(s => Math.min(stepKeys.length - 1, s + 1))
                }}
              >
                Next
              </Button>
            )}
          </div>
        </div>
        </>
      ) : (
        <>
        {/* Spacer so the last card clears the pinned mobile action bar. */}
        <div className="h-20 md:hidden" aria-hidden />
        {/* Save stays in reach on a phone — you shouldn't have to scroll a long
            form back to the bottom to keep a change. */}
        <div className="fixed inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t border-slate-100 bg-white/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur md:static md:z-auto md:mt-1 md:rounded-2xl md:border md:bg-white md:p-4 md:backdrop-blur-none md:shadow-[0_1px_8px_rgba(15,31,36,0.04)]">
          <Button type="submit" loading={isSubmitting}>Save changes</Button>
          <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={handleClone} disabled={cloning} className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {cloning ? 'Cloning…' : 'Clone'}
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 px-3.5 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
        </>
      )}
    </form>
  )
}

/**
 * One step of the offering form, as a card.
 *
 * The wizard shows a single card at a time; editing shows every card stacked on
 * one page. Same numbered header, same intro copy, same fields in the same
 * order — so the form you learn while creating is the form you come back to,
 * and everything about an offering is reachable without hunting through tabs.
 */
function SectionCard({
  step,
  title,
  hint,
  intro,
  children,
}: {
  step: number
  title: string
  hint?: string
  intro?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="md:col-span-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_1px_8px_rgba(15,31,36,0.04)] md:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold leading-tight text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-tight text-slate-400">{hint}</p>}
        </div>
      </div>

      {intro && (
        <p className="mt-3 rounded-xl bg-blue-50/70 px-3.5 py-2.5 text-sm leading-relaxed text-slate-600">
          {intro}
        </p>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </section>
  )
}
