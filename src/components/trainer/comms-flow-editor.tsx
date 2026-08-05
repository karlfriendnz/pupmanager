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
// A VERTICAL STEP LIST, mobile-first. He picked it over a drag-canvas because
// the app is used on a phone, and a canvas on a 390px screen is a map you pan
// rather than a list you read:
//
//     TRIGGER  Client books a 1:1 groom
//     ────────────────────────────────────
//      1 ▸ Send form: Pre-groom questions
//            wait for their answers
//     ────────────────────────────────────
//      2 ▸ Send email: What to expect
//            straight away
//     ────────────────────────────────────
//        + Add step
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
import { useState, useEffect, useCallback, useMemo } from 'react'
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
  ShoppingBag, UserCheck, MessageSquare,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { RichText } from '@/components/shared/rich-text'
import { ModalPortal } from '@/components/shared/modal-portal'
import { DndArea } from '@/components/shared/dnd-area'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { isRichTextEmpty } from '@/lib/rich-text'
import { sortStepsByTime, channelsForAudience, type FlowStepKind, type FlowStepActor } from '@/lib/comms-flow-steps'
import { canWaitForCompletion } from '@/lib/flow-anchors'
import {
  flowStepSummary,
  flowStepKindsFor,
  FLOW_STEP_KIND_CATALOG,
  type FlowStepNames,
  type SummarisableStep,
} from '@/lib/flow-step-summary'
import { commsPlaceholderOptionsFor, type PlaceholderOption } from '@/lib/placeholder-labels'

type Channel = 'PUSH' | 'EMAIL' | 'IN_APP'
type Direction = 'BEFORE_SESSION' | 'AFTER_SESSION' | 'AFTER_PURCHASE' | 'BEFORE_PERIOD_END'
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
  const preset = OFFSETS.find(o => o.min === min)
  const label = preset ? preset.label : min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} hr` : `${Math.round(min / 1440)} days`
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

export function CommsFlowEditor({ runId, packageId, membershipId, formId, clients = [], offeringName, location, onChanged }: {
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
  const placeholderOptions = commsPlaceholderOptionsFor(isMembership ? 'membership' : 'session')
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [options, setOptions] = useState<FlowOptions>(NO_OPTIONS)
  const [draft, setDraft] = useState<Step | null>(null)
  const [previewing, setPreviewing] = useState<Step | null>(null)
  const [picking, setPicking] = useState(false)
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

  async function addStep(kind: FlowStepKind) {
    setPicking(false)
    const res = await api(base, { method: 'POST', body: JSON.stringify({ kind }) })
    if (!res) return
    const step = normalizeStep(await res.json())
    setSteps(prev => [...(prev ?? []), step])
    setDraft({ ...step })
  }
  async function seedStarter() {
    const res = await api(base, { method: 'POST', body: JSON.stringify({ seed: 'starter' }) })
    if (res) setSteps(((await res.json()) as (Partial<Step> & { id: string })[]).map(normalizeStep))
  }
  async function saveDraft() {
    if (!draft) return
    const { id, kind, actor, blocking, direction, offsetMinutes, channels, audience, customClientIds, important, title, body, emailBody, enabled, payload } = draft
    const res = await api(`${base}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        // `kind` MUST go with the patch: the server validates the payload
        // against it, and a FORM payload checked against MESSAGE's schema
        // (which is `null`) would be refused outright.
        kind, actor, blocking, direction, offsetMinutes, channels, audience, customClientIds, important, title, body,
        // Only persist an email body when Email is a channel and one was written.
        emailBody: channels.includes('EMAIL') && emailBody?.trim() ? emailBody : null,
        enabled,
        // A MESSAGE carries no config. Everything else always sends an object,
        // never null — on a Json column null means "leave it alone", so an
        // emptied payload would silently keep the old one.
        payload: kind === 'MESSAGE' ? null : (payload ?? {}),
      }),
    })
    if (!res) return
    const saved = normalizeStep(await res.json())
    setSteps(prev => (prev ?? []).map(s => (s.id === saved.id ? saved : s)))
    setDraft(null)
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

  const sensors = useSensors(
    // A few pixels of slop so a tap on a row opens it instead of starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = ordered.findIndex(s => s.id === active.id)
    const to = ordered.findIndex(s => s.id === over.id)
    if (from < 0 || to < 0) return
    const next = [...ordered]
    next.splice(to, 0, ...next.splice(from, 1))
    // Optimistic: the list is already where they dropped it, and the `order`
    // values are rewritten to match so a re-sort doesn't snap it back.
    setSteps(next.map((s, i) => ({ ...s, order: i })))
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

  const rows = (
    <ol className="border-t border-slate-200" data-review-scope={`Flow builder: ${heading}`}>
      {ordered.map((step, i) => (
        <FlowStepRow
          key={step.id}
          step={step}
          index={i}
          names={names}
          draggable={sequenced}
          busy={busy}
          onEdit={() => setDraft({ ...step })}
          onPreview={() => setPreviewing(step)}
          onToggle={() => toggleEnabled(step)}
        />
      ))}
    </ol>
  )

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{heading}</h3>
          <p className="text-sm text-slate-500 mt-0.5 max-w-prose">{blurb}</p>
        </div>
        {steps.length > 0 && !sequenced && (
          <button onClick={saveAsTemplate} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Save className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Save as template
          </button>
        )}
      </div>

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

      {steps.length === 0 ? (
        <div className="border-t border-slate-200 p-6 text-center">
          <Bell className="h-6 w-6 text-slate-400 mx-auto mb-3" strokeWidth={1.75} />
          <p className="text-sm text-slate-600 mb-4 max-w-sm mx-auto">
            {sequenced
              ? 'Nothing happens yet. Add the first step of what you want someone to go through after they send this form.'
              : 'No messages yet. Add reminders that go out automatically around each session.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {!sequenced && (
              <button onClick={seedStarter} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60">
                <Sparkles className="h-4 w-4" strokeWidth={1.75} /> Use starter reminders
              </button>
            )}
            <button onClick={() => setPicking(true)} disabled={busy} className={`inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg disabled:opacity-60 ${sequenced ? 'bg-slate-900 text-white hover:bg-slate-800' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a step
            </button>
          </div>
          {templates.length > 0 && !sequenced && (
            <div className="mt-4"><TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} applying={applying} /></div>
          )}
        </div>
      ) : (
        <>
          {sequenced ? (
            <DndArea sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={ordered.map(s => s.id)} strategy={verticalListSortingStrategy}>
                {rows}
              </SortableContext>
            </DndArea>
          ) : rows}

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-4 sm:px-5">
            <button onClick={() => setPicking(true)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Add step
            </button>
            {templates.length > 0 && !sequenced && <TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} applying={applying} />}
          </div>
        </>
      )}

      {picking && (
        <StepKindPicker
          anchor={anchor}
          busy={busy}
          onPick={addStep}
          onClose={() => setPicking(false)}
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
 * One step of the flow.
 *
 * Two lines and nothing else: what the step does, and when. Both come from
 * `flowStepSummary`, so the row cannot phrase a fact differently from the tests
 * or from any other screen that shows a step.
 *
 * A step the TRAINER does is marked, on its own line, in words — "You do this".
 * The actor is the fact a trainer will misread, and a step that quietly waits
 * for them while they believe it is waiting for the client is a journey that
 * stalls with nobody knowing why. The left edge of such a row is drawn too, so
 * a flow can be scanned without reading it.
 */
function FlowStepRow({ step, index, names, draggable, busy, onEdit, onPreview, onToggle }: {
  step: Step
  index: number
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
      className={`relative flex items-stretch border-b border-slate-100 last:border-b-0 bg-white ${step.enabled ? '' : 'opacity-55'} ${isDragging ? 'z-10 shadow-sm' : ''}`}
    >
      {/* The trainer's own steps are edged, so "whose move is it" survives a
          scan. A 2px rule, not a tinted card — see AGENTS.md. */}
      {mine && <span className="absolute inset-y-0 left-0 w-[2px] bg-slate-400" aria-hidden />}

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

      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className={`flex min-w-0 flex-1 items-start gap-3 py-3.5 text-left hover:bg-slate-50 disabled:opacity-60 ${draggable ? 'pl-1' : 'pl-4'}`}
      >
        <span className="mt-0.5 flex w-6 shrink-0 items-center justify-center text-xs font-semibold tabular-nums text-slate-400">
          {index + 1}
        </span>
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
 */
function StepKindPicker({ anchor, busy, onPick, onClose }: {
  anchor: 'PERSON' | 'SESSION' | 'PURCHASE'
  busy: boolean
  onPick: (kind: FlowStepKind) => void
  onClose: () => void
}) {
  const kinds = flowStepKindsFor(anchor)
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

function StepSheet({ draft, clients, busy, isMembership = false, sequenced = false, options, names, placeholders, onPatch, onPatchPayload, onToggleChannel, onSave, onDelete, onPreview, onCancel }: {
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
  const audienceHint = AUDIENCES.find(a => a.key === draft.audience)?.hint
  const kindLabel = FLOW_STEP_KIND_CATALOG.find(k => k.kind === draft.kind)?.label ?? 'Step'

  return (
    <Sheet
      title={kindLabel}
      onClose={onCancel}
      footer={
        <div className="flex items-center gap-2">
          <button onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-3 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-60">
            <Trash2 className="h-4 w-4" strokeWidth={1.75} /> Delete
          </button>
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

        {/* WHEN — a journey has no clock: the step before it finishing IS the
            timing, so there is nothing here to choose. */}
        {sequenced ? (
          <Field label="When">
            <p className="text-sm text-slate-600">{summary.when}.</p>
          </Field>
        ) : (
          <Field label="When">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
                {(isMembership
                  ? (['AFTER_PURCHASE', 'BEFORE_PERIOD_END'] as Direction[])
                  : (['BEFORE_SESSION', 'AFTER_SESSION'] as Direction[])
                ).map(d => (
                  <button key={d} onClick={() => onPatch({ direction: d })} className={`px-3 h-8 text-sm font-medium rounded-md ${draft.direction === d ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>
                    {d === 'BEFORE_SESSION' ? 'Before' : d === 'AFTER_SESSION' ? 'After' : d === 'AFTER_PURCHASE' ? 'After they join' : 'Before it renews'}
                  </button>
                ))}
              </div>
              <select value={draft.offsetMinutes} onChange={e => onPatch({ offsetMinutes: Number(e.target.value) })} aria-label="How long" className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
                {OFFSETS.map(o => <option key={o.min} value={o.min}>{o.label}</option>)}
              </select>
              {!isMembership && <span className="text-sm text-slate-500">the session</span>}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">Sends {humanWhen(draft.direction, draft.offsetMinutes).toLowerCase()}.</p>
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
            A journey has one person in it, so there is nobody to pick. */}
        {!sequenced && (
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

        {/* HOW */}
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

        {/* WHAT IT SAYS. Required on a MESSAGE (that IS the step); optional on
            every other kind, which sends sensible words of its own when the
            trainer writes none — see flowStepCopy. */}
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

        {/* IMPORTANT */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <Switch checked={draft.important} onChange={() => onPatch({ important: !draft.important })} onColor="bg-slate-900" className="mt-0.5" aria-label="Always send" />
          <span className="text-sm text-slate-700">
            <span className="font-medium inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} /> Always send</span>
            <span className="mt-0.5 block text-xs text-slate-500">Goes out even to someone who muted their notifications. Use it for cancellations or a change of venue.</span>
          </span>
        </label>
      </div>
    </Sheet>
  )
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
