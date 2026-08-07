'use client'

// The trainer-facing FLOW BUILDER.
//
// One screen edits every flow this app has: a class's reminders, a package's, a
// membership's, and — new in phase 3 — the journey that hangs off a public
// enquiry FORM (enquiry → account → intake → choose what to book → you accept).
// There is deliberately not a second place that edits "the flow"; a trainer who
// found two would rightly ask which one was real.
//
// ── The shape Karl chose ────────────────────────────────────────────────────
// A VERTICAL TIMELINE, mobile-first. He picked a list over a drag-canvas
// because the app is used on a phone, and a canvas on a 390px screen is a map
// you pan rather than a list you read — then, looking at the list: "can the
// automation flow look like a timeline". So the list grew a spine:
//
//     BEFORE THEY CONFIRM
//     Part of booking — it holds the booking up until it is done.
//      (1)  Send form: Pre-groom questions
//       │     While they are booking
//     DURING THE SESSION
//     From them being booked in, through to the end of the session.
//      (2)  Send email: What to expect
//       │     1 day before
//      (3)  You take a photo of the finished groom
//             While the session is on
//     AFTER THE SESSION
//      ·   Nothing follows it up.
//
// One rail, one node per step, top to bottom in the order the client lives it.
// The three headings are Karl's stages; which one a step sits under is DERIVED
// (lib/flow-timeline.ts), never stored — a stage column would be a second
// answer to "when does this happen" and the two would drift.
//
// ONE bordered block split by hairlines — never a stack of shadowed cards
// (AGENTS.md). Each row says what the step does and when, in plain words; the
// words themselves come from `lib/flow-step-summary.ts`, which is pure and
// tested, because they are the only description of a step a trainer ever reads.
//
// Reorder is DRAG (@dnd-kit) — chevron up/down buttons are a standing no in
// this repo — and only where order means something: a journey's order IS its
// behaviour, whereas a class's reminders are sorted by the clock and dragging
// one could not change when it fires.
//
// "Add step" opens a FULL SCREEN picker, because seven choices with an
// explanation each is not a 56px menu hanging off a corner.
import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import {
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Bell, Mail, Smartphone, Plus, Trash2, Loader2, Star, Check, Sparkles, Save, X, Users, Eye,
  ChevronLeft, GripVertical, AlertTriangle, FileText, Camera, ClipboardList, KeyRound,
  ShoppingBag, UserCheck, MessageSquare, Maximize2,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { RichText } from '@/components/shared/rich-text'
import { ModalPortal } from '@/components/shared/modal-portal'
import { DndArea } from '@/components/shared/dnd-area'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { isRichTextEmpty } from '@/lib/rich-text'
import {
  sortStepsByTime,
  channelsForAudience,
  stepSendsNotification,
  type FlowStepKind,
  type FlowStepActor,
} from '@/lib/comms-flow-steps'
import { canWaitForCompletion } from '@/lib/flow-anchors'
import { canGateBooking } from '@/lib/comms-flow-steps'
import {
  groupStepsByStage,
  flowStageAdd,
  flowStageMove,
  flowStageOf,
  flowStagesFor,
  flowTimingKey,
  flowTimingOptionsFor,
  canMoveStepToStage,
  reorderFlowSteps,
  type FlowStageAdd,
  type StageableStep,
} from '@/lib/flow-timeline'
import type { FlowAnchor } from '@/lib/flow-anchors'
import {
  flowStepSummary,
  flowStepWhenText,
  flowStepKindsFor,
  FLOW_STEP_KIND_CATALOG,
  type FlowStepNames,
  type SummarisableStep,
} from '@/lib/flow-step-summary'
import { commsPlaceholderOptionsFor, type PlaceholderOption } from '@/lib/placeholder-labels'

type Channel = 'PUSH' | 'EMAIL' | 'IN_APP'
type Direction = 'BEFORE_SESSION' | 'DURING_SESSION' | 'AFTER_SESSION' | 'ON_ENROLMENT' | 'AFTER_PURCHASE' | 'BEFORE_PERIOD_END'
type Audience = 'ENROLLED' | 'ENROLLED_AND_WAITLIST' | 'CUSTOM' | 'STAFF'
type PersonTrigger = 'ON_ENQUIRY_SUBMITTED' | 'ON_SIGNUP' | 'ON_BOOKING'

interface Step {
  id: string
  // What this step ASKS FOR. Every row written before flows widened is a
  // MESSAGE, which is what the column defaults to — so an older API response
  // that omits it still reads correctly.
  kind: FlowStepKind
  actor: FlowStepActor
  trigger: PersonTrigger | null
  blocking: boolean
  /** "Ask this before they can confirm the booking" — FORM steps on an
   *  offering only. See lib/booking-gate. */
  gatesBooking: boolean
  direction: Direction
  offsetMinutes: number
  channels: Channel[]
  audience: Audience
  customClientIds: string[]
  important: boolean
  // NULLABLE on the server since flows widened past messages (a FORM or UPLOAD
  // step has no copy). A MESSAGE step still requires both — but this screen must
  // not assume a step it LOADS has them, or the first non-message step in a flow
  // blanks the whole editor with "cannot read properties of null".
  title: string | null
  body: string | null
  emailBody: string | null
  /** Kind-specific configuration. Null on a MESSAGE, by design. */
  payload: Record<string, unknown> | null
  enabled: boolean
  order: number
}
/** What the screen shows for a step with no copy of its own. */
const copyOf = (v: string | null | undefined) => v ?? ''
interface TemplateSummary { id: string; name: string; stepCount: number }
interface ClientOpt { id: string; name: string; dog?: string | null }

/** The things a step can point at — see /api/trainer/flow-options. */
interface FlowOptions {
  forms: { id: string; name: string; isActive: boolean }[]
  tasks: { id: string; title: string; group: string | null }[]
  offerings: { id: string; name: string }[]
}
const NO_OPTIONS: FlowOptions = { forms: [], tasks: [], offerings: [] }

/** A plain line icon per kind. No tinted tile behind it — that is the single
 *  clearest tell of a machine-made screen (AGENTS.md). */
const KIND_ICON: Record<FlowStepKind, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  MESSAGE: MessageSquare,
  FORM: FileText,
  UPLOAD: Camera,
  TASK: ClipboardList,
  ACCOUNT: KeyRound,
  CHOOSE_OFFERING: ShoppingBag,
  APPROVAL: UserCheck,
}

const OFFSETS: { label: string; min: number }[] = [
  // 0 is a real answer — "as it starts" / "as it ends" — and without it a step
  // holding 0 rendered a select whose value matched no option, so the browser
  // showed the FIRST one instead: the box said "15 minutes" while the line
  // under it said "Sends 0 min before."
  { label: 'right on', min: 0 },
  { label: '15 minutes', min: 15 },
  { label: '30 minutes', min: 30 },
  { label: '1 hour', min: 60 },
  { label: '2 hours', min: 120 },
  { label: '1 day', min: 1440 },
  { label: '2 days', min: 2880 },
  { label: '3 days', min: 4320 },
  { label: '1 week', min: 10080 },
]
const CHANNELS: { key: Channel; label: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { key: 'PUSH', label: 'Push', Icon: Bell },
  { key: 'EMAIL', label: 'Email', Icon: Mail },
  { key: 'IN_APP', label: 'In‑app', Icon: Smartphone },
]
// In-app is deliberately absent for clients: they already get the push and the
// email, and mirroring both into their feed made the feed useless. Staff read
// their bell, so it stays for them. (Enforced server-side too.)
const STAFF_ONLY_CHANNELS: Channel[] = ['IN_APP']

const AUDIENCES: { key: Audience; label: string; hint: string }[] = [
  { key: 'ENROLLED', label: 'Everyone booked', hint: 'Every client with a place on this offering.' },
  { key: 'ENROLLED_AND_WAITLIST', label: 'Booked + waitlist', hint: 'Also the people waiting for a place.' },
  { key: 'CUSTOM', label: 'Chosen people', hint: 'Only the clients you pick below.' },
  { key: 'STAFF', label: 'Your team', hint: 'Your team, not your clients — whoever is assigned to that session. If nobody is, it goes to the business owner.' },
]
// Plain-language names on the buttons; the token is what actually gets typed
// into the message. Labels live in one shared place so "Dog name" reads the
// same here as it does in the email composer — see lib/placeholder-labels.ts
// for why the tokens themselves must never be renamed.
//
// WHICH SET depends on what the flow hangs off — see commsPlaceholderOptionsFor.
// A membership step has no session behind it, so the session vocabulary would
// offer tokens that substitute to nothing.
//
// Preview substitutes EVERY token the engine knows, not just the ones this
// screen offers: a step written before a token was withdrawn from the picker
// still holds it, and previewing it raw would be a lie about what sends.
const SAMPLE: Record<string, string> = {
  '{{name}}': 'Sam', '{{dog}}': 'Bailey', '{{time}}': '6:00 pm', '{{date}}': 'Tue 5 Aug',
  '{{class}}': 'Puppy Class', '{{business}}': 'your business', '{{location}}': 'the hall',
  // Both spellings of the same value — a step saved before the Packages rename
  // still contains {{membership}}, and previewing it raw would be a lie about
  // what sends (the engine fills both).
  '{{package}}': 'Puppy Club', '{{membership}}': 'Puppy Club',
}
const PLACEHOLDERS = Object.keys(SAMPLE)

function audienceLabel(a: Audience): string {
  return AUDIENCES.find(x => x.key === a)?.label ?? ''
}

// What a step's timing reads as INSIDE the sheet, where the trainer is choosing
// it rather than reading it back. The ROW uses flowStepWhenText, which is the
// shared, tested version and covers the journey anchors too.
function humanWhen(direction: Direction, min: number): string {
  // A window, not a lead time — its offsetMinutes is inert (see the enum in
  // schema.prisma), so it is answered before the label is even built.
  if (direction === 'DURING_SESSION') return 'while the session is on'
  const preset = OFFSETS.find(o => o.min === min)
  const label = preset ? preset.label : min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} hr` : `${Math.round(min / 1440)} days`
  // Joining is not a moment in a session, so it is answered before the
  // before/after wording below could put a lead time either side of one.
  if (direction === 'ON_ENROLMENT') return min === 0 ? 'Straight away, when they enrol' : `${label} after they enrol`
  if (direction === 'AFTER_PURCHASE') return min === 0 ? 'When they join' : `${label} after they join`
  if (direction === 'BEFORE_PERIOD_END') return `${label} before it renews`
  return `${label} ${direction === 'BEFORE_SESSION' ? 'before' : 'after'}`
}

/**
 * Fill the placeholders with what one particular recipient would see. Anything
 * the screen actually knows (this offering's name, where it meets, who's on it)
 * beats the sample — a preview showing a stranger and someone else's class
 * doesn't answer the question the trainer opened it to ask.
 */
function preview(
  text: string,
  who?: { name?: string | null; dog?: string | null },
  offering?: { name?: string | null; location?: string | null },
): string {
  const values: Record<string, string> = { ...SAMPLE }
  if (who?.name) values['{{name}}'] = who.name.split(' ')[0]
  if (who?.dog) values['{{dog}}'] = who.dog
  // A membership flow's name lands in BOTH — `processMembershipStep` sets
  // `class` and `membership` to the membership's name.
  if (offering?.name) {
    values['{{class}}'] = offering.name
    values['{{package}}'] = offering.name
    values['{{membership}}'] = offering.name
  }
  if (offering?.location) values['{{location}}'] = offering.location
  return PLACEHOLDERS.reduce((acc, p) => acc.split(p).join(values[p]), text)
}

/** A loaded step, defaulted for the columns an older response may not carry. */
function normalizeStep(raw: Partial<Step> & { id: string }): Step {
  return {
    kind: 'MESSAGE',
    actor: 'CLIENT',
    trigger: null,
    blocking: false,
    gatesBooking: false,
    direction: 'BEFORE_SESSION',
    offsetMinutes: 1440,
    channels: [],
    audience: 'ENROLLED',
    customClientIds: [],
    important: false,
    title: null,
    body: null,
    emailBody: null,
    payload: null,
    enabled: true,
    order: 0,
    ...raw,
  } as Step
}

export function CommsFlowEditor({ runId, packageId, membershipId, formId, clients = [], offeringName, location, onChanged, fullPage = false }: {
  runId?: string
  packageId?: string
  membershipId?: string
  /** A public enquiry form — the one PERSON-anchored flow, and the only one
   *  whose steps are a sequence rather than a set of timers. */
  formId?: string
  clients?: ClientOpt[]
  /** This offering's name + venue, so the preview reads as the real thing. */
  offeringName?: string | null
  location?: string | null
  /**
   * Something in this flow was written. Optional, and only Settings passes it.
   *
   * The offering pages mount this editor beside the thing it belongs to and
   * nothing around them derives anything from it, so they need no notification.
   * The Settings index does: it shows "Off" and "needs setting up", both of
   * which are DERIVED on the server and would go stale the moment a step was
   * switched off from inside the editor.
   *
   * This is a notification, not a second write path — see `api()` below, which
   * is still the one place any change is sent from.
   */
  onChanged?: () => void
  /**
   * This IS the whole screen (/automations/…), rather than a panel on somebody
   * else's page. Karl: "can it also be opened up on a new page to remove
   * distraction from the user".
   *
   * Deliberately one flag with two small effects — no border of its own (the
   * page is the container), and no link to the page it is already on. It is
   * NOT a second editor and must never grow into one: everything a step can be
   * is edited by the code below, whichever of the six places it is mounted in.
   */
  fullPage?: boolean
}) {
  // Scoped to a class run (group / drop-in / event / puppy school), a 1:1
  // package, a membership, or a form. The API trees mirror each other.
  const base = runId
    ? `/api/trainer/class-runs/${runId}/comms-flow`
    : membershipId
      ? `/api/trainer/memberships/${membershipId}/comms-flow`
      : formId
        ? `/api/trainer/forms/${formId}/comms-flow`
        : `/api/trainer/packages/${packageId}/comms-flow`
  // A membership has no timetable, so its steps hang off the purchase instead —
  // which also decides which placeholders genuinely substitute.
  const isMembership = !!membershipId
  // A FORM's flow is a JOURNEY: person-anchored, sequential, and the only one
  // where dragging a step changes what actually happens.
  const sequenced = !!formId
  const anchor = sequenced ? 'PERSON' : isMembership ? 'PURCHASE' : 'SESSION'
  // The same flow, on its own page. Derived from the id this editor already
  // holds rather than passed in, so the five in-place mounts cannot each forget
  // it — and so there is exactly one place the route is spelled.
  const timelinePath = runId
    ? `/automations/run/${runId}`
    : membershipId
      ? `/automations/membership/${membershipId}`
      : formId
        ? `/automations/form/${formId}`
        : `/automations/package/${packageId}`
  // Where "Back" goes afterwards: the screen they left, tab and all. Read from
  // the browser in an effect rather than from useSearchParams — this component
  // mounts on six pages and a hook that forces a Suspense boundary would be six
  // places to get that right. Nothing renders differently before it arrives.
  const [returnTo, setReturnTo] = useState<string | null>(null)
  useEffect(() => { setReturnTo(window.location.pathname + window.location.search) }, [])
  const placeholderOptions = commsPlaceholderOptionsFor(isMembership ? 'membership' : 'session')
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [options, setOptions] = useState<FlowOptions>(NO_OPTIONS)
  const [draft, setDraft] = useState<Step | null>(null)
  const [previewing, setPreviewing] = useState<Step | null>(null)
  // Not a boolean any more: "Add step" is now per stage (Karl, on a screenshot
  // of the empty timeline with a box drawn at the right of each heading —
  // "please put the add step buttons here"), and WHICH stage it was tapped from
  // is what the new step gets seeded with. Null = closed.
  const [picking, setPicking] = useState<FlowStageAdd | null>(null)
  const [busy, setBusy] = useState(false)
  // Applying a template writes a whole flow server-side and can take a beat —
  // it gets its own flag so the screen can say so, rather than looking dead.
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [sRes, tRes, oRes] = await Promise.all([
        fetch(base),
        fetch('/api/trainer/comms-flow-templates'),
        fetch('/api/trainer/flow-options'),
      ])
      if (!sRes.ok) { setError('Couldn’t load this flow. If you just updated, restart the dev server.'); setSteps([]); return }
      setSteps(((await sRes.json()) as (Partial<Step> & { id: string })[]).map(normalizeStep))
      setTemplates(tRes.ok ? await tRes.json() : [])
      // Only the NAMES of the trainer's forms, homework and offerings. Losing
      // them costs labels, never the flow, so a failure here is silent.
      setOptions(oRes.ok ? await oRes.json() : NO_OPTIONS)
    } catch {
      setError('Couldn’t reach the server.'); setSteps([])
    }
  }, [base])
  useEffect(() => { load() }, [load])

  /** Ids → names, so a row can say "Send form: Pre-groom questions". */
  const names: FlowStepNames = useMemo(() => ({
    forms: Object.fromEntries(options.forms.map(f => [f.id, f.name])),
    tasks: Object.fromEntries(options.tasks.map(t => [t.id, t.title])),
    offerings: Object.fromEntries(options.offerings.map(o => [o.id, o.name])),
  }), [options])

  /**
   * The ONE place this screen writes anything.
   *
   * Every mutation goes through here — add, save, toggle, delete, reorder,
   * apply-template — which is what makes `onChanged` reliable rather than
   * something that has to be remembered at six call sites. `load()` reads with
   * a bare fetch and deliberately does not come through here, so a reload can
   * never be mistaken for a change.
   */
  async function api(path: string, init: RequestInit): Promise<Response | null> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
      if (!res.ok) { setError('Something went wrong — please try again.'); return null }
      // Only a change that actually landed. A failed save must not tell the
      // page around us that something moved.
      onChanged?.()
      return res
    } catch {
      setError('Something went wrong — please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  /** `extra` seeds the new step's columns — used by "Add a message step", which
   *  puts the message at the SAME moment as the step it was added beside so the
   *  two sit next to each other on the timeline rather than a day apart. */
  async function addStep(kind: FlowStepKind, extra: Partial<Step> = {}) {
    setPicking(null)
    const res = await api(base, { method: 'POST', body: JSON.stringify({ kind, ...extra }) })
    if (!res) return
    const step = normalizeStep(await res.json())
    setSteps(prev => [...(prev ?? []), step])
    setDraft({ ...step })
  }

  /**
   * "Add a message step", from inside a step that sends nothing.
   *
   * Karl's model is that the two sit side by side: the homework is handed out,
   * and a message tells them about it. Saving first is not politeness — the
   * sheet is about to be replaced by the new step's, and losing what they just
   * typed would make the button feel like a mistake.
   */
  async function addMessageBeside(step: Step) {
    if (!(await saveDraft())) return
    // A journey has no clock (the sequence is the timing), so there is nothing
    // to copy across — the new step simply lands after this one.
    await addStep('MESSAGE', sequenced ? {} : { direction: step.direction, offsetMinutes: step.offsetMinutes })
  }
  async function seedStarter() {
    const res = await api(base, { method: 'POST', body: JSON.stringify({ seed: 'starter' }) })
    if (res) setSteps(((await res.json()) as (Partial<Step> & { id: string })[]).map(normalizeStep))
  }
  /** True when the save landed — `addMessageBeside` will not replace the sheet
   *  with a new step's until it has. */
  async function saveDraft(): Promise<boolean> {
    if (!draft) return false
    const { id, kind, actor, blocking, gatesBooking, direction, offsetMinutes, channels, audience, customClientIds, important, title, body, emailBody, enabled, payload } = draft
    const res = await api(`${base}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        // `kind` MUST go with the patch: the server validates the payload
        // against it, and a FORM payload checked against MESSAGE's schema
        // (which is `null`) would be refused outright.
        kind, actor, blocking, direction, offsetMinutes, channels, audience, customClientIds, important, title, body,
        // Only ever sent as a gate a FORM can actually be. Switching the kind
        // away from FORM takes the gate down with it, so what disappears from
        // the screen disappears from the booking.
        gatesBooking: canGateBooking(kind, anchor, payload) ? gatesBooking : false,
        // Only persist an email body when Email is a channel and one was written.
        emailBody: channels.includes('EMAIL') && emailBody?.trim() ? emailBody : null,
        enabled,
        // A MESSAGE carries no config. Everything else always sends an object,
        // never null — on a Json column null means "leave it alone", so an
        // emptied payload would silently keep the old one.
        payload: kind === 'MESSAGE' ? null : (payload ?? {}),
      }),
    })
    if (!res) return false
    const saved = normalizeStep(await res.json())
    setSteps(prev => (prev ?? []).map(s => (s.id === saved.id ? saved : s)))
    setDraft(null)
    return true
  }
  async function toggleEnabled(step: Step) {
    setSteps(prev => (prev ?? []).map(s => (s.id === step.id ? { ...s, enabled: !s.enabled } : s)))
    await api(`${base}/${step.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !step.enabled }) })
  }
  async function remove(id: string) {
    const res = await api(`${base}/${id}`, { method: 'DELETE' })
    if (res) {
      setSteps(prev => (prev ?? []).filter(s => s.id !== id))
      setDraft(d => (d?.id === id ? null : d))
    }
  }
  async function applyTemplate(templateId: string) {
    setApplying(true)
    try {
      const res = await api(`${base}/apply-template`, { method: 'POST', body: JSON.stringify({ templateId }) })
      if (res) setSteps(((await res.json()) as (Partial<Step> & { id: string })[]).map(normalizeStep))
    } finally {
      setApplying(false)
    }
  }
  async function saveAsTemplate() {
    const name = window.prompt('Name this template (e.g. "Standard class reminders")')?.trim()
    if (!name) return
    const res = await api('/api/trainer/comms-flow-templates', { method: 'POST', body: JSON.stringify({ name, ...(runId ? { runId } : { packageId }) }) })
    if (res) load()
  }

  function patchDraft(p: Partial<Step>) {
    setDraft(d => {
      if (!d) return d
      const next = { ...d, ...p }
      // Moving a step off the team takes its in-app channel with it, so the
      // screen never shows a state the server would reject.
      next.channels = channelsForAudience(next.channels, next.audience) as Channel[]
      return next
    })
  }
  function patchPayload(p: Record<string, unknown>) {
    setDraft(d => (d ? { ...d, payload: { ...(d.payload ?? {}), ...p } } : d))
  }
  function toggleChannel(ch: Channel) {
    if (!draft) return
    const has = draft.channels.includes(ch)
    const channels = has ? draft.channels.filter(c => c !== ch) : [...draft.channels, ch]
    if (channels.length === 0) return // always leave one way to send
    patchDraft({ channels })
  }

  // A journey reads in the order the trainer arranged it — that order IS what
  // happens. A clock-anchored flow reads in the order it will actually fire,
  // which is not the order the messages were added in.
  const ordered = useMemo(
    () => (sequenced
      ? [...(steps ?? [])].sort((a, b) => a.order - b.order)
      : sortStepsByTime(steps ?? [])),
    [steps, sequenced],
  )

  // The spine, cut into Karl's stages. Every stage this kind of flow HAS comes
  // back, empty ones included — see lib/flow-timeline.ts. A membership has none
  // (no session to be before, during or after), and gets one plain spine.
  const stages = useMemo(() => groupStepsByStage(ordered, anchor), [ordered, anchor])
  // A step's number is its place READING DOWN THE PAGE.
  //
  // It used to be the index in `ordered` — the stored order — while the page
  // shows those same steps grouped into stages that run in a fixed sequence
  // (before confirm → when they enrol → during → after). The two don't line
  // up, so the rail counted 6, 1, 2, 3, 4, 5 down the screen (Karl: "why are
  // there numbers, they don't make sense"). The stored order is still what
  // drives a reorder and what the server persists; it just isn't what a
  // reader is looking at.
  //
  // Numbering the flattened stages fixes the summary line too: flowStepSummary
  // uses this index to say "once the step before is done", and "the step
  // before" now means the row directly above rather than whichever step
  // happens to sit one earlier in storage.
  const positions = useMemo(() => {
    const map = new Map<string, number>()
    let n = 0
    for (const { steps: inStage } of stages) for (const step of inStage) map.set(step.id, n++)
    return map
  }, [stages])

  const sensors = useSensors(
    // A few pixels of slop so a tap on a row opens it instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    // One list, whatever stage each step is drawn under — a step dragged across
    // a heading is the same move as one dragged within it. The renumbering is
    // pure and tested (reorderFlowSteps), because what a reorder has to get
    // right is that a RELOAD shows the same thing.
    const next = reorderFlowSteps(ordered, String(active.id), String(over.id))
    if (next === ordered) return
    // Optimistic: the list is already where they dropped it, and the `order`
    // values are rewritten to match so a re-sort doesn't snap it back.
    setSteps(next)
    const res = await api(`${base}/reorder`, { method: 'POST', body: JSON.stringify({ ids: next.map(s => s.id) }) })
    // The server hands back the saved list — the proof that a reload will show
    // this, not the order it was in before (AGENTS.md bug #1).
    if (res) setSteps(((await res.json()) as (Partial<Step> & { id: string })[]).map(normalizeStep))
    else load()
  }

  if (steps === null) {
    return <div className="flex items-center gap-2 text-sm text-slate-500 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
  }

  const heading = sequenced ? 'What happens next' : 'Reminders & messages'
  const blurb = sequenced
    ? 'The journey somebody walks after they send this form — one step at a time, in this order. Drag a step by its handle to move it.'
    : 'Messages that send themselves around each session — by push or email to your clients, and in‑app to your team.'

  // The timeline. One rail top to bottom, cut into the stages this flow has —
  // headings and all, including the ones with nothing in them, which say so
  // quietly rather than asking to be filled.
  const rows = (
    <div data-review-scope={`Flow builder: ${heading}`}>
      {stages.map(({ stage, steps: inStage }) => (
        <section key={stage?.key ?? 'all'} className="border-t border-slate-200">
          {stage && (
            /* Heading left, "Add step" hard right (Karl drew a box there).
               `items-start` + `min-w-0 flex-1` is what keeps a 390px screen
               honest: the HINT wraps under the label and the button holds its
               place, rather than the button being squeezed off the row. */
            <div className="flex items-start gap-2 px-4 pt-3.5 sm:px-5">
              <div className="min-w-0 flex-1">
                {/* The stage headings carry the shape of the whole flow, so they
                    read as headings rather than as the smallest text on screen
                    (Karl, 2026-08-06: "make these bigger"). */}
                <h4 className="text-sm font-semibold text-slate-900">{stage.label}</h4>
                <p className="mt-0.5 text-[13px] text-slate-500">{stage.hint}</p>
              </div>
              {/* Quiet by design — three filled buttons down an empty screen
                  would shout louder than the one this replaces. globals.css
                  already forces a 44px minimum on every button, so the tap
                  target is real without an exemption. */}
              <button
                type="button"
                onClick={() => setPicking(flowStageAdd(stage.key, anchor))}
                disabled={busy}
                aria-label={`Add step: ${stage.label}`}
                className="-mt-1 -mr-1 inline-flex shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
              >
                <Plus className="h-4 w-4" strokeWidth={1.75} /> Add step
              </button>
            </div>
          )}
          {inStage.length === 0 ? (
            // Quiet. Most flows use one stage, and a heading that nagged about
            // the other two would be two jobs a trainer never asked for.
            <p className="px-4 py-3 text-xs text-slate-400 sm:px-5">{stage?.empty}</p>
          ) : (
            <ol className={stage ? 'pt-2' : ''}>
              {inStage.map((step, i) => (
                <FlowStepRow
                  key={step.id}
                  step={step}
                  index={positions.get(step.id) ?? i}
                  first={i === 0}
                  last={i === inStage.length - 1}
                  names={names}
                  draggable={sequenced}
                  busy={busy}
                  onEdit={() => setDraft({ ...step })}
                  onPreview={() => setPreviewing(step)}
                  onToggle={() => toggleEnabled(step)}
                />
              ))}
            </ol>
          )}
        </section>
      ))}
    </div>
  )

  // "Save as template" belongs at the top right of the page it is on, not
  // buried under a description (Karl). It cannot MOVE to the page, though: it
  // needs `api`, `load`, and whichever of runId/packageId this editor holds. So
  // in fullPage mode it is PORTALED into the page's own header slot — same one
  // button, same one implementation, rendered where it reads correctly. A copy
  // living in the page would be a second thing to keep in step with this one.
  const templateButton = steps.length > 0 && !sequenced && (
    <button onClick={saveAsTemplate} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
      <Save className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Save as template
    </button>
  )

  return (
    <div className={fullPage ? 'bg-white' : 'rounded-xl border border-slate-200 bg-white overflow-hidden'}>
      {/* On its own page the title and the section label are the PAGE's, one
          row up. Repeating them here was two titles saying nearly the same
          thing — and the older of the two said "Reminders & messages" after the
          offering's tab was renamed to Automation. */}
      {fullPage ? (
        <HeaderSlot>{templateButton}</HeaderSlot>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
            <p className="text-sm text-slate-500 mt-0.5 max-w-prose">{blurb}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* The same flow with nothing else on the screen. A link, not a
                modal: it is a place, so it can be bookmarked, shared and
                backed out of. */}
            <Link
              href={returnTo ? `${timelinePath}?from=${encodeURIComponent(returnTo)}` : timelinePath}
              className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Full screen
            </Link>
            {templateButton}
          </div>
        </div>
      )}

      {/* The trigger, stated once at the top — every step below hangs off it,
          and a journey whose starting gun is implied is a journey nobody can
          check. */}
      {sequenced && steps.length > 0 && (
        <div className="border-t border-slate-200 px-4 sm:px-5 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Starts when</p>
          <p className="text-sm text-slate-700">Somebody sends this form</p>
        </div>
      )}

      {/* Applying a template rewrites the whole flow — say so out loud. */}
      {applying && (
        <div className="border-t border-slate-200 px-4 sm:px-5 py-2.5" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Applying template…
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full w-1/3 rounded-full bg-slate-400 animate-pm-progress-slide" />
          </div>
        </div>
      )}

      {error && <div className="border-t border-slate-200 px-4 sm:px-5 py-2.5 text-sm text-rose-700">{error}</div>}

      {/* THE SCAFFOLDING IS THE EMPTY STATE.
          A flow with no steps renders the SAME spine as one with ten — every
          stage heading, its hint, and its quiet "nothing here yet" line (Karl:
          "this should be the default screen if there is no steps"). The
          headings are the only thing that teaches a trainer what a flow can
          do; a generic "nothing yet" card teaches nothing and hides the shape,
          so there is no longer one — and nothing says the same thing twice. */}
      {sequenced ? (
        <DndArea sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ordered.map(s => s.id)} strategy={verticalListSortingStrategy}>
            {rows}
          </SortableContext>
        </DndArea>
      ) : rows}

      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-4 sm:px-5">
        {/* No generic "Add step" here any more: every step belongs to a stage,
            and one button at the bottom could only ever guess which. The
            per-heading ones above replaced it — two ways to do the same thing is
            the rule this repo keeps breaking.
            The fallback survives for a flow with NO stage headings to hang a
            button off. No anchor is in that shape today; groupStepsByStage still
            allows it, and a flow you cannot add to would be unusable. */}
        {stages.every(g => !g.stage) && (
          <button onClick={() => setPicking({ seed: {} })} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Plus className="h-4 w-4" strokeWidth={1.75} /> Add step
          </button>
        )}
        {/* Only worth offering into an empty flow — it seeds a whole starter
            flow, and a trainer who has built their own does not want it
            appended. It stays at the bottom rather than moving onto a heading:
            it fills EVERY stage, not one. */}
        {steps.length === 0 && !sequenced && (
          <button onClick={seedStarter} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Sparkles className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Use starter reminders
          </button>
        )}
        {templates.length > 0 && !sequenced && <TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} applying={applying} />}
      </div>

      {picking && (
        <StepKindPicker
          anchor={anchor}
          busy={busy}
          only={picking.kinds}
          // The seed is what puts the new step back under the heading it was
          // added from. A stage is DERIVED from these columns (flowStageOf), so
          // seeding them is the whole mechanism — there is no stage to store.
          onPick={kind => addStep(kind, picking.seed as Partial<Step>)}
          onClose={() => setPicking(null)}
        />
      )}

      {draft && (
        <StepSheet
          draft={draft}
          clients={clients}
          isMembership={isMembership}
          sequenced={sequenced}
          options={options}
          names={names}
          placeholders={placeholderOptions}
          busy={busy}
          onPatch={patchDraft}
          onPatchPayload={patchPayload}
          onToggleChannel={toggleChannel}
          onAddMessage={() => addMessageBeside(draft)}
          onSave={saveDraft}
          onDelete={() => remove(draft.id)}
          onPreview={() => setPreviewing(draft)}
          onCancel={() => setDraft(null)}
        />
      )}

      {previewing && (
        <PreviewSheet
          step={previewing}
          clients={clients}
          offering={{ name: offeringName, location }}
          onClose={() => setPreviewing(null)}
        />
      )}
    </div>
  )
}

/**
 * Renders its children into the page's own header row (`#flow-header-actions`),
 * where the full-page timeline keeps its actions.
 *
 * The alternative was a copy of "Save as template" in the page — which is a
 * server component, and would need `api`, `load`, `runId`/`packageId` and the
 * templates list all re-derived beside the editor that already has them. Two
 * implementations of one button is two things to keep in step.
 *
 * Portals AFTER mount (the slot only exists on the client render), and renders
 * nothing at all when the slot is absent, so an editor mounted with `fullPage`
 * somewhere that has no header simply shows no button rather than throwing.
 */
function HeaderSlot({ children }: { children: React.ReactNode }) {
  // "Have we hydrated yet?" as an external store — the same shape ModalPortal
  // uses, and for the same reason: a portal cannot be hydrated against server
  // HTML, and a setState-in-an-effect is a cascading render the lint rule
  // rightly rejects.
  const hydrated = useSyncExternalStore(neverChanges, onTheClient, onTheServer)
  if (!hydrated || typeof document === 'undefined') return null
  const node = document.getElementById('flow-header-actions')
  return node ? createPortal(children, node) : null
}
const neverChanges = () => () => {}
const onTheClient = () => true
const onTheServer = () => false

/**
 * One step of the flow — one node on the timeline.
 *
 * Two lines and nothing else: what the step does, and when. Both come from
 * `flowStepSummary`, so the row cannot phrase a fact differently from the tests
 * or from any other screen that shows a step.
 *
 * A step the TRAINER does is marked twice: in words on its own line ("You do
 * this"), and by a FILLED node on the rail. The actor is the fact a trainer
 * will misread, and a step that quietly waits for them while they believe it is
 * waiting for the client is a journey that stalls with nobody knowing why. The
 * filled node is what lets a flow be scanned without reading it — monochrome,
 * because a coloured dot per actor is the decorative colour AGENTS.md bans.
 *
 * `first`/`last` are the step's place IN ITS STAGE and only trim the rail, so
 * the spine starts at the first node under a heading and stops at the last
 * rather than running into the gap.
 */
function FlowStepRow({ step, index, first, last, names, draggable, busy, onEdit, onPreview, onToggle }: {
  step: Step
  index: number
  first: boolean
  last: boolean
  names: FlowStepNames
  draggable: boolean
  busy: boolean
  onEdit: () => void
  onPreview: () => void
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: step.id,
    disabled: !draggable,
  })
  const summary = flowStepSummary(step as SummarisableStep, { index, names })
  const Icon = KIND_ICON[step.kind] ?? MessageSquare
  const mine = step.actor === 'TRAINER'

  return (
    <li
      ref={setNodeRef}
      // Vertical only. A step list has no horizontal meaning, and a row that
      // slides sideways under the thumb reads as a swipe-to-delete that isn't
      // there. Pinning x to 0 does what @dnd-kit/modifiers' restrictToVerticalAxis
      // does, without adding a dependency this repo has never needed.
      style={{ transform: CSS.Transform.toString(transform && { ...transform, x: 0 }), transition }}
      className={`relative flex items-stretch bg-white ${step.enabled ? '' : 'opacity-55'} ${isDragging ? 'z-10 shadow-sm' : ''}`}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder step ${index + 1}`}
          className="flex shrink-0 cursor-grab touch-none items-center px-1.5 text-slate-300 hover:text-slate-500 active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" strokeWidth={1.75} />
        </button>
      )}

      {/* THE RAIL. One hairline down the flow, a node per step — the whole of
          "make it look like a timeline". Decorative to a screen reader: the
          order is already in the list markup.

          The node used to carry the step's number. Karl: "they are just
          noise" — and he's right, nothing on the page refers to a step BY its
          number, so it was a count for its own sake. The dot still marks where
          each step sits on the rail, filled when the step is one of ours to
          do and hollow when it's the client's, which is the one distinction
          worth a mark here. */}
      <div className={`flex shrink-0 flex-col items-center ${draggable ? 'w-7' : 'w-10'}`} aria-hidden>
        <span className={`h-3.5 w-px ${first ? 'bg-transparent' : 'bg-slate-200'}`} />
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full border ${
            mine ? 'border-slate-900 bg-slate-900' : 'border-slate-300 bg-white'
          }`}
        />
        <span className={`w-px flex-1 ${last ? 'bg-transparent' : 'bg-slate-200'}`} />
      </div>

      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg py-3 pl-1 pr-1 text-left hover:bg-slate-50 disabled:opacity-60"
      >
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-700" strokeWidth={1.75} />

        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5">
            <span className="min-w-0 text-sm font-medium text-slate-900 line-clamp-2">{summary.what}</span>
            {step.important && <Star className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-500" strokeWidth={1.75} aria-label="Always sends" />}
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">
            {summary.line}
            {step.audience === 'STAFF' && ` · ${audienceLabel(step.audience)}`}
          </span>
          {mine && <span className="mt-0.5 block text-xs font-medium text-slate-600">You do this</span>}
          {!step.enabled && <span className="mt-0.5 block text-xs text-slate-400">Paused</span>}
          {summary.problem && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={1.75} />
              {summary.problem} — it will be skipped
            </span>
          )}
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1 pr-3 sm:pr-4">
        {/* On a phone the row has no width to spare — preview lives one tap in,
            on the message itself. */}
        {step.kind === 'MESSAGE' && (
          <button type="button" onClick={onPreview} disabled={busy} title="Preview" className="hidden sm:block p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-60">
            <Eye className="h-4 w-4" strokeWidth={1.75} /><span className="sr-only">Preview {summary.what}</span>
          </button>
        )}
        <Switch checked={step.enabled} onChange={onToggle} disabled={busy} onColor="bg-slate-900" aria-label={step.enabled ? `Turn off ${summary.what}` : `Turn on ${summary.what}`} />
      </div>
    </li>
  )
}

/**
 * "Add step" — a full screen, because seven choices each needing a line of
 * explanation is not a menu hanging off a corner (AGENTS.md).
 *
 * The kinds offered depend on the anchor: three of the seven cannot be fired by
 * a clock, so a class's flow never lists them. Offering a choice whose only
 * outcome is silence is worse than a shorter menu.
 *
 * `only` narrows it further, for a STAGE that can hold fewer than its anchor
 * can. "Before they confirm" is the one: holding up a booking is something only
 * a form can do (the server refuses `gatesBooking` on any other kind), so
 * offering "Send a message" from that heading would offer a step that could not
 * stay where it was put.
 */
function StepKindPicker({ anchor, busy, only, onPick, onClose }: {
  anchor: 'PERSON' | 'SESSION' | 'PURCHASE'
  busy: boolean
  only?: FlowStepKind[]
  onPick: (kind: FlowStepKind) => void
  onClose: () => void
}) {
  const allowed = flowStepKindsFor(anchor)
  const kinds = only ? allowed.filter(o => only.includes(o.kind)) : allowed
  const theirs = kinds.filter(k => k.actor === 'CLIENT')
  const yours = kinds.filter(k => k.actor === 'TRAINER')

  const group = (label: string, list: typeof kinds) => list.length > 0 && (
    <div className="mb-4 last:mb-0">
      <p className="mb-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {list.map(o => {
          const Icon = KIND_ICON[o.kind]
          return (
            <button
              key={o.kind}
              type="button"
              disabled={busy}
              onClick={() => onPick(o.kind)}
              className="flex w-full items-start gap-3 border-b border-slate-100 px-4 py-3.5 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-60"
            >
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-slate-700" strokeWidth={1.75} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-900">{o.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{o.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )

  return (
    <FullScreenSheet title="Add a step" sub="What should happen?" onClose={onClose}>
      {group('They do it', theirs)}
      {group('You do it', yours)}
    </FullScreenSheet>
  )
}

/** A full screen on a phone, a centred panel on a desktop. */
function Sheet({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // Never two scrollbars: the page behind holds still while this is open.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] flex sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
        <div className="absolute inset-0 bg-slate-900/40 sm:backdrop-blur-sm" onMouseDown={onClose} />
        <div className="relative flex h-full w-full flex-col bg-white sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-xl">
          <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-3 sm:px-5">
            <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-lg text-slate-500 hover:bg-slate-100 sm:hidden" aria-label="Back">
              <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">{title}</h2>
            <button onClick={onClose} className="hidden p-1.5 -mr-1.5 rounded-lg text-slate-500 hover:bg-slate-100 sm:block" aria-label="Close">
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-4 py-4 sm:px-5">{children}</div>
          {footer && <div className="shrink-0 border-t border-slate-200 px-4 py-3 sm:px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
        </div>
      </div>
    </ModalPortal>
  )
}

function StepSheet({ draft, clients, busy, isMembership = false, sequenced = false, options, names, placeholders, onPatch, onPatchPayload, onToggleChannel, onAddMessage, onSave, onDelete, onPreview, onCancel }: {
  draft: Step
  clients: ClientOpt[]
  busy: boolean
  /** A membership step anchors on the purchase, not a session. */
  isMembership?: boolean
  /** A journey: the sequence is the timing, and steps can wait for each other. */
  sequenced?: boolean
  options: FlowOptions
  names: FlowStepNames
  /** Only the tokens THIS flow's engine substitutes — see placeholderOptionsFor. */
  placeholders: readonly PlaceholderOption[]
  onPatch: (p: Partial<Step>) => void
  onPatchPayload: (p: Record<string, unknown>) => void
  onToggleChannel: (c: Channel) => void
  /** Save this step and add a MESSAGE step beside it — the other half of "a
   *  step does one thing". */
  onAddMessage: () => void
  onSave: () => void
  onDelete: () => void
  onPreview: () => void
  onCancel: () => void
}) {
  const isMessage = draft.kind === 'MESSAGE'
  // A MESSAGE has always needed copy and still does. Every other kind is
  // deliberately SAVABLE half-built — a trainer adds the step, then configures
  // it — and what stops an unconfigured one running is the engine's own gate,
  // surfaced here as a warning rather than a locked button.
  const canSave = draft.channels.length > 0 && (!isMessage || (!!copyOf(draft.title).trim() && !!copyOf(draft.body).trim()))
  const summary = flowStepSummary(draft as SummarisableStep, { names })
  const toStaff = draft.audience === 'STAFF'
  const channels = CHANNELS.filter(c => toStaff || !STAFF_ONLY_CHANNELS.includes(c.key))
  // A step that sends nothing has nothing to configure about sending. Two
  // reasons, and one of them is not tidiness:
  //   • a gating FORM is a page inside the booking wizard — nobody is notified;
  //   • a FORM / UPLOAD / TASK step is an ACTION, and telling the client about
  //     it is a MESSAGE step of its own (Karl: "i don't think we need
  //     notifications if people are doing homework or forms this should be its
  //     own step").
  // A trainer who filled Who / How / What it says / Always send in on one of
  // these would be writing a message that could never reach anybody.
  const sends = stepSendsNotification(draft.kind) && !draft.gatesBooking
  const audienceHint = AUDIENCES.find(a => a.key === draft.audience)?.hint
  const kindLabel = FLOW_STEP_KIND_CATALOG.find(k => k.kind === draft.kind)?.label ?? 'Step'

  // Which stage this step is in, and when inside it. Derived, both of them —
  // there is no stage column and the sheet does not send one.
  const anchor: FlowAnchor = sequenced ? 'PERSON' : isMembership ? 'PURCHASE' : 'SESSION'
  const stage = flowStageOf(draft as StageableStep)
  const timings = flowTimingOptionsFor(draft, stage, anchor)
  // Where it could go instead. A stage that only holds forms is not offered to a
  // message, and a flow with one stage has nowhere to move to.
  const moveTo = flowStagesFor(anchor).filter(s => s.key !== stage && canMoveStepToStage(draft.kind, s.key, anchor))

  return (
    <Sheet
      title={kindLabel}
      onClose={onCancel}
      footer={
        <div className="flex items-center gap-2">
          <button onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-3 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-60">
            <Trash2 className="h-4 w-4" strokeWidth={1.75} /> Delete
          </button>
          {/* MOVE TO — the only way out of a step added under the wrong heading,
              now that the sheet no longer asks which stage it is in. Without it
              a misplaced step would be stuck there for ever, with delete and
              re-add the only escape.
              A plain <select> rather than a menu: it is a short list of places,
              it is keyboard- and screen-reader-native, and the phone gets the
              system picker for free. */}
          {moveTo.length > 0 && (
            <select
              value=""
              disabled={busy}
              aria-label="Move to another stage"
              onChange={e => {
                const to = moveTo.find(s => s.key === e.target.value)
                if (to) onPatch(flowStageMove(to.key, anchor) as Partial<Step>)
              }}
              className="h-10 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              <option value="">Move to…</option>
              {moveTo.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          )}
          <div className="flex-1" />
          {isMessage && (
            <button onClick={onPreview} className="inline-flex items-center gap-1.5 h-10 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
              <Eye className="h-4 w-4" strokeWidth={1.75} /> Preview
            </button>
          )}
          <button onClick={onSave} disabled={busy || !canSave} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Check className="h-4 w-4" strokeWidth={1.75} />} Save
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* The same gate the engine asks before it does anything, said out loud
            while there is still somebody here to fix it. */}
        {summary.problem && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            {summary.problem}. Until that&apos;s set, this step is skipped.
          </p>
        )}

        {/* BEFORE THEY CONFIRM — Karl's first stage, and the only one that is
            not a time. A FORM step with this on holds up the BOOKING: every
            client path that books this offering has to carry answers that
            satisfy the form, or the server refuses it (lib/booking-gate).

            Shown only where there is a booking to hold up — an offering, not a
            person-anchored journey (which has `blocking` for sequencing) and
            not a membership (which has no slot). And only once a form is
            actually chosen: a gate with nothing to answer is a wall with no
            door. */}
        {canGateBooking(draft.kind, sequenced ? 'PERSON' : isMembership ? 'PURCHASE' : 'SESSION', draft.payload) && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <Switch checked={draft.gatesBooking} onChange={() => onPatch({ gatesBooking: !draft.gatesBooking })} onColor="bg-slate-900" className="mt-0.5" aria-label="Ask before they can book" />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Ask this before they can book</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {draft.gatesBooking
                  ? 'They answer it as part of booking, and the booking is not confirmed until they have. Asked again every time they book.'
                  : 'They can book first and you chase the answers afterwards.'}
              </span>
            </span>
          </label>
        )}

        {/* WHEN — ONE control, and it no longer asks which stage.
            Karl, once every stage had its own "Add step": "i dont think we need
            this now that we have our add steps right?" A step is added from a
            stage, so being asked again which stage it is in was the same
            question twice — and the two controls together produced the sentence
            "Sends right on before".
            What is left is when INSIDE the stage, which is a real choice: the
            run-up reminder and the session itself are two directions but one
            question from the trainer's chair, so `flowTimingOptions` offers them
            as one list of (direction, offset) pairs.
            Nothing to choose where there is no clock: a journey's steps are
            unlocked by the one before, and a gate is answered while somebody is
            tapping Confirm. */}
        {draft.gatesBooking ? (
          <Field label="When">
            <p className="text-sm text-slate-600">While they are booking, before it is confirmed.</p>
          </Field>
        ) : sequenced ? (
          <Field label="When">
            <p className="text-sm text-slate-600">{summary.when}.</p>
          </Field>
        ) : (
          <Field label="When">
            <select
              value={flowTimingKey(draft)}
              onChange={e => {
                const picked = timings.find(t => flowTimingKey(t) === e.target.value)
                if (picked) onPatch({ direction: picked.direction as Direction, offsetMinutes: picked.offsetMinutes })
              }}
              aria-label="When"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:w-auto"
            >
              {timings.map(t => (
                // The SAME words the row shows — flowStepWhenText is the one
                // tested place a timing is phrased, so the option a trainer
                // picks and the line they read back cannot disagree.
                <option key={flowTimingKey(t)} value={flowTimingKey(t)}>
                  {flowStepWhenText({ ...(draft as SummarisableStep), ...t })}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-slate-500">
              {draft.direction === 'DURING_SESSION'
                ? 'Goes out while the session is actually running — any time between it starting and finishing.'
                : draft.direction === 'ON_ENROLMENT'
                  ? `Goes out ${summary.when.toLowerCase()} — when they get a place, not around any one session.`
                  : `Sends ${summary.when.toLowerCase()}.`}
            </p>
          </Field>
        )}

        {/* WHAT it asks for — everything except a plain message needs setting up. */}
        {!isMessage && (
          <Field label="What it asks for">
            <KindConfig draft={draft} options={options} onPatchPayload={onPatchPayload} />
          </Field>
        )}

        {/* WAIT — the blocking column, phrased as what it means.
            Only in a sequence (nothing else has a "next step"), and only for a
            kind the app can actually see finish: a wall comes down when a
            completion is written, and a step nothing writes one for would park
            every person on it for ever. See canWaitForCompletion.

            The PAYLOAD goes in too: an UPLOAD can be waited for when it asks
            for a photo of their dog (it lands on the dog, so the app sees it
            arrive) and not when it asks for any old file. Switching the target
            hides this toggle — and the route takes the wall down with it, so
            what disappears from the screen disappears from the run. */}
        {sequenced && canWaitForCompletion(draft.kind, draft.payload) && (
          <label className="flex items-start gap-2.5 cursor-pointer">
            <Switch checked={draft.blocking} onChange={() => onPatch({ blocking: !draft.blocking })} onColor="bg-slate-900" className="mt-0.5" aria-label="Wait for this step" />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Wait for this before the next step</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {draft.blocking
                  ? `Nothing else happens until they have done it — the flow will ${summary.wait ?? 'wait here'}.`
                  : 'The next step goes ahead whether or not they have done this one.'}
              </span>
            </span>
          </label>
        )}

        {/* WHOSE MOVE — the fact a trainer misreads. APPROVAL is always theirs;
            everything else can be either. */}
        {sequenced && draft.kind !== 'APPROVAL' && (
          <Field label="Whose move">
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
              {(['CLIENT', 'TRAINER'] as FlowStepActor[]).map(a => (
                <button key={a} onClick={() => onPatch({ actor: a })} className={`px-3 h-8 text-sm font-medium rounded-md ${draft.actor === a ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                  {a === 'CLIENT' ? 'They do it' : 'You do it'}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {draft.actor === 'TRAINER'
                ? 'It comes to you, not to them — your notifications, your screens.'
                : 'It goes to the person walking through this flow.'}
            </p>
          </Field>
        )}

        {/* WHO — before HOW, because who it's for decides what can carry it.
            A journey has one person in it, so there is nobody to pick. Nor does
            a gating step: it is answered by whoever is doing the booking. */}
        {!sequenced && sends && (
          <Field label="Who">
            <select value={draft.audience} onChange={e => onPatch({ audience: e.target.value as Audience })} aria-label="Who it goes to" className="h-9 w-full sm:w-auto rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
              {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            {audienceHint && <p className="mt-1.5 text-xs text-slate-500">{audienceHint}</p>}
            {draft.audience === 'CUSTOM' && (
              <div className="mt-2 rounded-lg border border-slate-200 divide-y divide-slate-100 max-h-52 overflow-y-auto no-scrollbar">
                {clients.length === 0 ? (
                  <p className="text-xs text-slate-500 px-3 py-2">Add clients to this offering first.</p>
                ) : clients.map(c => {
                  const on = draft.customClientIds.includes(c.id)
                  return (
                    <label key={c.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                      <input type="checkbox" checked={on} onChange={() => onPatch({ customClientIds: on ? draft.customClientIds.filter(id => id !== c.id) : [...draft.customClientIds, c.id] })} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.dog && <span className="text-xs text-slate-400 truncate">{c.dog}</span>}
                    </label>
                  )
                })}
              </div>
            )}
          </Field>
        )}

        {/* NOTHING IS SENT — said out loud, on the screen where the trainer is
            deciding, with the fix one tap away.
            A silently-assigned piece of homework nobody ever sees is a worse
            outcome than the noisy version, so this block is not an apology: it
            says exactly where the thing turns up, and offers the message step
            that tells them about it. */}
        {!sends && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-sm font-medium text-slate-900">Nothing is sent</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
              {draft.gatesBooking
                ? 'They answer it while they are booking — there is no push and no email.'
                : `${silentStepLanding(draft.kind)} No push, no email.`}
            </p>
            <button
              type="button"
              onClick={onAddMessage}
              disabled={busy}
              className="mt-2.5 inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <MessageSquare className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Add a message step
            </button>
            <p className="mt-1.5 text-[11px] text-slate-500">Saves this one and adds a message beside it.</p>
          </div>
        )}

        {/* HOW — only where there is a send to configure. Hiding it is not
            cosmetic: a trainer who filled it in would be writing a message
            nobody could ever receive (Karl, 2026-08-06: "the notifications
            should not show if i'm talking about forms"). */}
        {sends && (
        <Field label="How">
          <div className="flex flex-wrap gap-2">
            {channels.map(({ key, label, Icon }) => {
              const on = draft.channels.includes(key)
              return (
                <button key={key} onClick={() => onToggleChannel(key)} aria-pressed={on} className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border ${on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                  <Icon className="h-4 w-4" strokeWidth={1.75} /> {label} {on && <Check className="h-3.5 w-3.5" strokeWidth={1.75} />}
                </button>
              )
            })}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {toStaff
              ? 'In‑app lands in your team’s notification bell.'
              : 'In‑app is for your team only — clients get the push and the email.'}
          </p>
        </Field>
        )}

        {/* WHAT IT SAYS. Required on a MESSAGE (that IS the step); optional on
            every other kind, which sends sensible words of its own when the
            trainer writes none — see flowStepCopy. */}
        {sends && (
        <Field label={isMessage ? 'Message' : 'What it says (optional)'}>
          {!isMessage && (
            <p className="mb-2 text-xs text-slate-500">
              Leave these empty and we&apos;ll write it for you — &ldquo;{flowStepDefaultTitle(draft.kind)}&rdquo;.
            </p>
          )}
          <input value={copyOf(draft.title)} onChange={e => onPatch({ title: e.target.value || null })} aria-label="Title" placeholder="Title (e.g. See you tomorrow 🐾)" className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800" />
          <textarea value={copyOf(draft.body)} onChange={e => onPatch({ body: e.target.value || null })} aria-label="Message" rows={4} placeholder="Your message…" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" />
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-slate-600">Insert a placeholder</p>
            <div className="flex flex-wrap gap-1.5">
              {placeholders.map(({ token, label }) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => onPatch({ body: `${copyOf(draft.body)}${copyOf(draft.body) && !copyOf(draft.body).endsWith(' ') ? ' ' : ''}${token}` })}
                  title={`Insert ${token}`}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500">Each one is swapped for the real thing when the message goes out.</p>
          </div>
          {draft.channels.includes('EMAIL') && (
            <div className="mt-3 rounded-lg border border-slate-200 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5">
                <Mail className="h-3.5 w-3.5" strokeWidth={1.75} /> Email content
              </div>
              <p className="text-xs text-slate-500 mb-2">The formatted version sent by email. Push and in‑app use the short message above.</p>
              <RichTextEditor key={draft.id} value={draft.emailBody ?? ''} onChange={html => onPatch({ emailBody: isRichTextEmpty(html) ? null : html })} minHeight={140} theme="light" />
              <p className="mt-1.5 text-[11px] text-slate-500">The placeholders above work here too. Leave it empty to use the short message for email as well.</p>
            </div>
          )}
        </Field>
        )}

        {/* IMPORTANT — a delivery setting ("go out even to someone who muted
            their notifications"), so meaningless on a step that never sends. */}
        {sends && (
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Switch checked={draft.important} onChange={() => onPatch({ important: !draft.important })} onColor="bg-slate-900" className="mt-0.5" aria-label="Always send" />
          <span className="text-sm text-slate-700">
            <span className="font-medium inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} /> Always send</span>
            <span className="mt-0.5 block text-xs text-slate-500">Goes out even to someone who muted their notifications. Use it for cancellations or a change of venue.</span>
          </span>
        </label>
        )}
      </div>
    </Sheet>
  )
}

/**
 * WHERE the thing a silent step assigns actually turns up for the client.
 *
 * The honest half of "nothing is sent": a trainer must be able to see that the
 * homework does land, on a screen they can name, before deciding whether they
 * also want a message. Mirrors flowStepLink in lib/comms-flows.ts, which is
 * what the feed row actually points at.
 */
function silentStepLanding(kind: FlowStepKind): string {
  switch (kind) {
    case 'FORM':
      return 'The form turns up in their app, ready to fill in.'
    case 'UPLOAD':
      return 'The request turns up in their app, ready to answer.'
    case 'TASK':
      return 'The homework lands in their homework list.'
    default:
      return 'It turns up in their app.'
  }
}

/** The words the engine falls back to, quoted so a trainer can see what leaving
 *  the copy blank actually sends. Mirrors flowStepCopy in lib/comms-flows.ts. */
function flowStepDefaultTitle(kind: FlowStepKind): string {
  switch (kind) {
    case 'FORM': return 'A form to fill in'
    case 'UPLOAD': return 'Something to send us'
    case 'TASK': return 'New homework from {{business}}'
    default: return 'A message from {{business}}'
  }
}

/**
 * The kind-specific half of the sheet.
 *
 * Every field here is optional in the schema on purpose (a trainer adds a step
 * and then fills it in), so nothing below is `required` — what stops a
 * half-built step running is `flowStepConfigProblem`, shown at the top of the
 * sheet and again on the row.
 */
function KindConfig({ draft, options, onPatchPayload }: {
  draft: Step
  options: FlowOptions
  onPatchPayload: (p: Record<string, unknown>) => void
}) {
  const p = (draft.payload ?? {}) as Record<string, unknown>
  const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
  const num = (k: string) => (typeof p[k] === 'number' ? (p[k] as number) : undefined)
  const bool = (k: string) => p[k] === true

  switch (draft.kind) {
    case 'FORM':
      return (
        <>
          <select
            value={str('formId')}
            onChange={e => onPatchPayload({ formId: e.target.value || undefined })}
            aria-label="Which form"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
          >
            <option value="">Choose a form…</option>
            {options.forms.map(f => (
              <option key={f.id} value={f.id}>{f.name}{f.isActive ? '' : ' (draft)'}</option>
            ))}
          </select>
          <input
            value={str('ctaLabel')}
            onChange={e => onPatchPayload({ ctaLabel: e.target.value || undefined })}
            aria-label="Button label"
            placeholder="Button label (default: Open the form)"
            className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
          />
        </>
      )

    case 'UPLOAD':
      return (
        <>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {([['DOG_PHOTO', 'A photo of their dog'], ['ATTACHMENT', 'A file']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => onPatchPayload({ target: v, ...(v === 'DOG_PHOTO' ? { accept: 'IMAGE' } : {}) })}
                className={`px-3 h-8 text-sm font-medium rounded-md ${(str('target') || 'ATTACHMENT') === v ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            {str('target') === 'DOG_PHOTO'
              ? 'It becomes the dog’s picture everywhere in the app.'
              : 'Kept with their answer — a vet letter, a vaccination card, a photo of the garden.'}
          </p>
          <input
            value={str('label')}
            onChange={e => onPatchPayload({ label: e.target.value || undefined })}
            aria-label="What you are asking for"
            placeholder="What you're asking for (e.g. A clear photo of Bailey)"
            className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-500">
              How many
              <input
                type="number"
                min={1}
                max={20}
                value={num('maxCount') ?? 1}
                onChange={e => onPatchPayload({ maxCount: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                className="ml-1.5 h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800"
              />
            </label>
            <label className="text-xs text-slate-500">
              Largest file (MB)
              <input
                type="number"
                min={1}
                max={20}
                value={num('maxMb') ?? 10}
                onChange={e => onPatchPayload({ maxMb: Math.max(1, Math.min(20, Number(e.target.value) || 10)) })}
                className="ml-1.5 h-9 w-16 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800"
              />
            </label>
          </div>
        </>
      )

    case 'TASK':
      return (
        <>
          <select
            value={str('libraryTaskId')}
            onChange={e => onPatchPayload(
              // A library item is named BY the library item, so picking one
              // clears any inline title — two answers to "what is this called"
              // is a thing the schema refuses outright.
              e.target.value ? { libraryTaskId: e.target.value, title: undefined } : { libraryTaskId: undefined },
            )}
            aria-label="Homework from your library"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
          >
            <option value="">Type my own…</option>
            {options.tasks.map(t => (
              <option key={t.id} value={t.id}>{t.group ? `${t.group} · ` : ''}{t.title}</option>
            ))}
          </select>
          {!str('libraryTaskId') && (
            <input
              value={str('title')}
              onChange={e => onPatchPayload({ title: e.target.value || undefined })}
              aria-label="Homework title"
              placeholder="What to practise (e.g. Loose lead walking)"
              className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
            />
          )}
          <div className="mt-2 inline-flex rounded-lg border border-slate-200 p-0.5">
            {([['BEFORE_SESSION', 'To prepare'], ['AFTER_SESSION', 'To practise']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => onPatchPayload({ timing: v })}
                className={`px-3 h-8 text-sm font-medium rounded-md ${(str('timing') || 'AFTER_SESSION') === v ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )

    case 'ACCOUNT':
      return (
        <>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {([['PASSWORD', 'They pick a password'], ['MAGIC_LINK', 'We email a link']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => onPatchPayload({ method: v })}
                className={`px-3 h-8 text-sm font-medium rounded-md ${(str('method') || 'PASSWORD') === v ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            They become your client the moment this is done — there is nothing for you to accept.
          </p>
        </>
      )

    case 'CHOOSE_OFFERING':
      return (
        <>
          <p className="text-xs text-slate-500">
            {(Array.isArray(p.packageIds) ? (p.packageIds as string[]).length : 0) === 0
              ? 'Tick nothing and they see everything you have published.'
              : 'They only see the ones you tick.'}
          </p>
          <div className="mt-2 max-h-52 overflow-y-auto no-scrollbar rounded-lg border border-slate-200 divide-y divide-slate-100">
            {options.offerings.length === 0 ? (
              <p className="px-3 py-2 text-xs text-slate-500">You have nothing to offer yet.</p>
            ) : options.offerings.map(o => {
              const picked = Array.isArray(p.packageIds) ? (p.packageIds as string[]) : []
              const on = picked.includes(o.id)
              return (
                <label key={o.id} className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onPatchPayload({ packageIds: on ? picked.filter(id => id !== o.id) : [...picked, o.id] })}
                  />
                  <span className="min-w-0 flex-1 truncate">{o.name}</span>
                </label>
              )
            })}
          </div>
          <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
            <Switch checked={bool('requireTime')} onChange={() => onPatchPayload({ requireTime: !bool('requireTime') })} onColor="bg-slate-900" className="mt-0.5" aria-label="Ask for a time too" />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Ask for a time too</span>
              <span className="mt-0.5 block text-xs text-slate-500">They pick a slot, not just the thing.</span>
            </span>
          </label>
          <label className="mt-2 flex items-start gap-2.5 cursor-pointer">
            <Switch checked={bool('allowMultiple')} onChange={() => onPatchPayload({ allowMultiple: !bool('allowMultiple') })} onColor="bg-slate-900" className="mt-0.5" aria-label="Let them pick more than one" />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Let them pick more than one</span>
            </span>
          </label>
        </>
      )

    case 'APPROVAL':
      return (
        <>
          <select
            value={str('decides') || 'BOOKING_TIME'}
            onChange={e => onPatchPayload({ decides: e.target.value })}
            aria-label="What you are deciding"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800"
          >
            <option value="BOOKING_TIME">The time they picked</option>
            <option value="ENROLMENT">Whether they can join</option>
            <option value="UPLOAD">What they sent</option>
            <option value="FORM">Their answers</option>
          </select>
          <label className="mt-3 flex items-start gap-2.5 cursor-pointer">
            <Switch checked={p.allowReschedule !== false} onChange={() => onPatchPayload({ allowReschedule: p.allowReschedule === false })} onColor="bg-slate-900" className="mt-0.5" aria-label="Let me move it instead" />
            <span className="text-sm text-slate-700">
              <span className="font-medium">Let me move it instead of just saying no</span>
            </span>
          </label>
          <label className="mt-3 block text-xs text-slate-500">
            Say yes for me after
            <input
              type="number"
              min={1}
              max={720}
              value={num('autoApproveHours') ?? ''}
              placeholder="never"
              onChange={e => {
                const v = Number(e.target.value)
                onPatchPayload({ autoApproveHours: v >= 1 && v <= 720 ? Math.round(v) : undefined })
              }}
              className="mx-1.5 h-9 w-20 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-800"
            />
            hours
            <span className="mt-1 block text-xs text-slate-400">So a week away doesn&apos;t leave somebody waiting for ever.</span>
          </label>
        </>
      )

    default:
      return null
  }
}

/**
 * What this message actually lands as. Shows only the channels the step uses,
 * filled in for one real person — a trainer's first question about an automated
 * message is always "what will they see?".
 */
function PreviewSheet({ step, clients, offering, onClose }: {
  step: Step
  clients: ClientOpt[]
  offering: { name?: string | null; location?: string | null }
  onClose: () => void
}) {
  const toStaff = step.audience === 'STAFF'
  const pickable = step.audience === 'CUSTOM' && step.customClientIds.length
    ? clients.filter(c => step.customClientIds.includes(c.id))
    : clients
  const [who, setWho] = useState<string>(pickable[0]?.id ?? '')
  const person = toStaff
    ? { name: 'you', dog: null }
    : (pickable.find(c => c.id === who) ?? { name: SAMPLE['{{name}}'], dog: SAMPLE['{{dog}}'] })

  const title = preview(copyOf(step.title), person, offering)
  const body = preview(copyOf(step.body), person, offering)
  const emailHtml = step.emailBody ? preview(step.emailBody, person, offering) : null

  return (
    <Sheet
      title="Preview"
      onClose={onClose}
      footer={
        <button onClick={onClose} className="w-full sm:w-auto sm:ml-auto sm:block inline-flex items-center justify-center h-10 px-4 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800">Done</button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
          {toStaff ? (
            <p className="text-sm text-slate-600">What your team sees. It goes to whoever is assigned to that session.</p>
          ) : pickable.length ? (
            <>
              <label htmlFor="preview-as" className="text-sm text-slate-600">Preview as</label>
              <select id="preview-as" value={who} onChange={e => setWho(e.target.value)} className="h-9 min-w-0 flex-1 sm:flex-none rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                {pickable.map(c => <option key={c.id} value={c.id}>{c.name}{c.dog ? ` & ${c.dog}` : ''}</option>)}
              </select>
            </>
          ) : (
            <p className="text-sm text-slate-600">Nobody has booked yet, so this shows a sample client.</p>
          )}
        </div>
        <p className="text-xs text-slate-500 -mt-2">Sends {humanWhen(step.direction, step.offsetMinutes).toLowerCase()}, to {audienceLabel(step.audience).toLowerCase()}.</p>

        {step.channels.includes('PUSH') && (
          <PreviewPane label="On their phone" Icon={Bell}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                <span className="h-3.5 w-3.5 rounded-[4px] bg-slate-300" aria-hidden /> PupManager
                <span className="ml-auto font-normal normal-case tracking-normal">now</span>
              </div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">{title}</p>
              <p className="text-sm text-slate-600">{body}</p>
            </div>
          </PreviewPane>
        )}

        {step.channels.includes('EMAIL') && (
          <PreviewPane label="In their inbox" Icon={Mail}>
            <div className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-100 px-3 py-2">
                <p className="text-xs text-slate-500">Subject</p>
                <p className="text-sm font-medium text-slate-900">{title}</p>
              </div>
              <div className="px-3 py-3 text-sm text-slate-700">
                {emailHtml ? <RichText html={emailHtml} /> : <p className="whitespace-pre-wrap">{body}</p>}
              </div>
            </div>
          </PreviewPane>
        )}

        {step.channels.includes('IN_APP') && (
          <PreviewPane label="In the notification bell" Icon={Smartphone}>
            <div className="flex items-start gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5">
              <Bell className="h-4 w-4 mt-0.5 shrink-0 text-slate-500" strokeWidth={1.75} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{title}</p>
                <p className="text-sm text-slate-600">{body}</p>
              </div>
            </div>
          </PreviewPane>
        )}

        {step.important && (
          <p className="text-xs text-slate-500">This one always sends, even to someone who muted their notifications.</p>
        )}
      </div>
    </Sheet>
  )
}

function PreviewPane({ label, Icon, children }: { label: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {label}
      </div>
      {children}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function TemplatePicker({ templates, onApply, busy, applying }: { templates: TemplateSummary[]; onApply: (id: string) => void; busy: boolean; applying: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(o => !o)} disabled={busy || applying} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        {applying
          ? <><Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> Applying template…</>
          : <><Sparkles className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Apply a template</>}
      </button>
      {open && !applying && (
        <div className="absolute z-10 mt-1 w-60 rounded-xl border border-slate-200 bg-white shadow-lg p-1">
          {templates.map(t => (
            <button key={t.id} onClick={() => { setOpen(false); onApply(t.id) }} className="w-full text-left px-3 py-2 rounded-lg text-sm text-slate-700 hover:bg-slate-50 flex items-center justify-between">
              <span className="truncate">{t.name}</span>
              <span className="text-xs text-slate-400 shrink-0 ml-2">{t.stepCount} msg</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
