'use client'

// The trainer-facing editor for a class / drop-in / event's automated messages.
//
// The flow is a TIMELINE, read top to bottom in the order it will actually
// happen. Each stop states its own three facts on their own lines down the left
// — WHEN it fires, HOW it's sent, WHO it reaches — with the message itself to
// the right of the rail. Tapping a stop opens it full screen; "Preview" shows
// the message as a real client will receive it.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Bell, Mail, Smartphone, Plus, Trash2, Loader2, Star, Check, Sparkles, Save, X, Users, Eye, ChevronLeft } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { RichText } from '@/components/shared/rich-text'
import { ModalPortal } from '@/components/shared/modal-portal'
import { isRichTextEmpty } from '@/lib/rich-text'
import { sortStepsByTime, channelsForAudience } from '@/lib/comms-flow-steps'
import { commsPlaceholderOptionsFor, type PlaceholderOption } from '@/lib/placeholder-labels'

type Channel = 'PUSH' | 'EMAIL' | 'IN_APP'
type Direction = 'BEFORE_SESSION' | 'AFTER_SESSION' | 'AFTER_PURCHASE' | 'BEFORE_PERIOD_END'
type Audience = 'ENROLLED' | 'ENROLLED_AND_WAITLIST' | 'CUSTOM' | 'STAFF'

interface Step {
  id: string
  direction: Direction
  offsetMinutes: number
  channels: Channel[]
  audience: Audience
  customClientIds: string[]
  important: boolean
  // NULLABLE on the server since flows widened past messages (a FORM or UPLOAD
  // step has no copy). This screen only ever authors MESSAGE steps, so it keeps
  // them non-empty — but it must not assume a step it LOADS has them, or the
  // first non-message step in a flow blanks the whole editor with
  // "cannot read properties of null".
  title: string | null
  body: string | null
  emailBody: string | null
  enabled: boolean
  order: number
}
/** What the screen shows for a step with no copy of its own. */
const copyOf = (v: string | null | undefined) => v ?? ''
interface TemplateSummary { id: string; name: string; stepCount: number }
interface ClientOpt { id: string; name: string; dog?: string | null }

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
// WHICH SET depends on what the flow hangs off — see commsPlaceholderOptionsFor
// in lib/placeholder-labels.ts. A membership step has no session behind it, so
// the session vocabulary would offer tokens that substitute to nothing.
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

// What a step's timing reads as. A membership has no session, so its anchor is
// the client joining ("when they join", "3 days after they join") or the end of
// their current period ("7 days before it renews").
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

export function CommsFlowEditor({ runId, packageId, membershipId, clients = [], offeringName, location }: {
  runId?: string
  packageId?: string
  membershipId?: string
  clients?: ClientOpt[]
  /** This offering's name + venue, so the preview reads as the real thing. */
  offeringName?: string | null
  location?: string | null
}) {
  // Scoped to a class run (group / drop-in / event / puppy school), a 1:1
  // package, or a membership. The API trees mirror each other.
  const base = runId
    ? `/api/trainer/class-runs/${runId}/comms-flow`
    : membershipId
      ? `/api/trainer/memberships/${membershipId}/comms-flow`
      : `/api/trainer/packages/${packageId}/comms-flow`
  // A membership has no timetable, so its steps hang off the purchase instead —
  // which also decides which placeholders genuinely substitute.
  const isMembership = !!membershipId
  const placeholderOptions = commsPlaceholderOptionsFor(isMembership ? 'membership' : 'session')
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [draft, setDraft] = useState<Step | null>(null)
  const [previewing, setPreviewing] = useState<Step | null>(null)
  const [busy, setBusy] = useState(false)
  // Applying a template writes a whole flow server-side and can take a beat —
  // it gets its own flag so the screen can say so, rather than looking dead.
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [sRes, tRes] = await Promise.all([fetch(base), fetch('/api/trainer/comms-flow-templates')])
      if (!sRes.ok) { setError('Couldn’t load messages. If you just updated, restart the dev server.'); setSteps([]); return }
      setSteps(await sRes.json())
      setTemplates(tRes.ok ? await tRes.json() : [])
    } catch {
      setError('Couldn’t reach the server.'); setSteps([])
    }
  }, [base])
  useEffect(() => { load() }, [load])

  async function api(path: string, init: RequestInit): Promise<Response | null> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
      if (!res.ok) { setError('Something went wrong — please try again.'); return null }
      return res
    } catch {
      setError('Something went wrong — please try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  async function addMessage() {
    const res = await api(base, { method: 'POST', body: JSON.stringify({}) })
    if (!res) return
    const step: Step = await res.json()
    setSteps(prev => [...(prev ?? []), step])
    setDraft({ ...step })
  }
  async function seedStarter() {
    const res = await api(base, { method: 'POST', body: JSON.stringify({ seed: 'starter' }) })
    if (res) setSteps(await res.json())
  }
  async function saveDraft() {
    if (!draft) return
    const { id, direction, offsetMinutes, channels, audience, customClientIds, important, title, body, emailBody, enabled } = draft
    const res = await api(`${base}/${id}`, {
      method: 'PATCH',
      // Only persist an email body when Email is a channel and one was written.
      body: JSON.stringify({ direction, offsetMinutes, channels, audience, customClientIds, important, title, body, emailBody: channels.includes('EMAIL') && emailBody?.trim() ? emailBody : null, enabled }),
    })
    if (!res) return
    const saved: Step = await res.json()
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
      if (res) setSteps(await res.json())
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
  function toggleChannel(ch: Channel) {
    if (!draft) return
    const has = draft.channels.includes(ch)
    const channels = has ? draft.channels.filter(c => c !== ch) : [...draft.channels, ch]
    if (channels.length === 0) return // always leave one way to send
    patchDraft({ channels })
  }

  // The flow only makes sense read in the order it happens, not the order the
  // trainer happened to add the messages in.
  const ordered = useMemo(() => sortStepsByTime(steps ?? []), [steps])

  if (steps === null) {
    return <div className="flex items-center gap-2 text-sm text-slate-500 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading messages…</div>
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div>
          <h3 className="text-base font-semibold text-slate-900">Reminders &amp; messages</h3>
          <p className="text-sm text-slate-500 mt-0.5 max-w-prose">Messages that send themselves around each session — by push or email to your clients, and in‑app to your team.</p>
        </div>
        {steps.length > 0 && (
          <button onClick={saveAsTemplate} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <Save className="h-4 w-4 text-slate-500" strokeWidth={1.75} /> Save as template
          </button>
        )}
      </div>

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
          <p className="text-sm text-slate-600 mb-4 max-w-sm mx-auto">No messages yet. Add reminders that go out automatically around each session.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button onClick={seedStarter} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-60">
              <Sparkles className="h-4 w-4" strokeWidth={1.75} /> Use starter reminders
            </button>
            <button onClick={addMessage} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a message
            </button>
          </div>
          {templates.length > 0 && (
            <div className="mt-4"><TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} applying={applying} /></div>
          )}
        </div>
      ) : (
        <>
          <ol className="border-t border-slate-200">
            {ordered.map((step, i) => (
              <TimelineStop
                key={step.id}
                step={step}
                first={i === 0}
                last={i === ordered.length - 1}
                busy={busy}
                onEdit={() => setDraft({ ...step })}
                onPreview={() => setPreviewing(step)}
                onToggle={() => toggleEnabled(step)}
              />
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 p-4 sm:px-5">
            <button onClick={addMessage} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Plus className="h-4 w-4" strokeWidth={1.75} /> Add a message
            </button>
            {templates.length > 0 && <TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} applying={applying} />}
          </div>
        </>
      )}

      {draft && (
        <StepSheet
          draft={draft}
          clients={clients}
          isMembership={isMembership}
          placeholders={placeholderOptions}
          busy={busy}
          onPatch={patchDraft}
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
 * One stop on the timeline. The three facts each get their own line down the
 * left of the rail — when it fires, how it's sent, who it reaches — because
 * crammed onto one line with dots between them they read as one long sentence
 * nobody finishes.
 */
function TimelineStop({ step, first, last, busy, onEdit, onPreview, onToggle }: {
  step: Step
  first: boolean
  last: boolean
  busy: boolean
  onEdit: () => void
  onPreview: () => void
  onToggle: () => void
}) {
  const chans = CHANNELS.filter(c => step.channels.includes(c.key))
  return (
    <li className={`flex items-stretch gap-2 border-b border-slate-100 last:border-b-0 ${step.enabled ? '' : 'opacity-55'}`}>
      <button
        type="button"
        onClick={onEdit}
        disabled={busy}
        className="flex min-w-0 flex-1 items-stretch gap-2 sm:gap-3 py-3.5 pl-4 text-left hover:bg-slate-50 disabled:opacity-60"
      >
        {/* WHEN · HOW · WHO — one fact per line, hugging the rail. Crammed onto
            one line they read as a sentence nobody finishes; truncated, the
            second channel disappears. So each wraps rather than clipping. */}
        <div className="w-[100px] sm:w-[160px] shrink-0 text-right">
          <span className="block text-sm font-medium text-slate-900 leading-snug">{humanWhen(step.direction, step.offsetMinutes)}</span>
          <span className="mt-1 flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5 text-xs text-slate-500">
            {chans.map(c => <c.Icon key={c.key} className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />)}
            <span>{chans.map(c => c.label).join(' + ') || 'No channel'}</span>
          </span>
          <span className="mt-0.5 block text-xs text-slate-500">{audienceLabel(step.audience)}</span>
          {!step.enabled && <span className="mt-0.5 block text-xs text-slate-400">Paused</span>}
        </div>

        {/* The rail itself. */}
        <span className="relative w-2.5 shrink-0" aria-hidden>
          <span className={`absolute left-1/2 w-px -translate-x-1/2 bg-slate-200 ${first ? 'top-2' : 'top-0'} ${last ? 'h-2' : 'bottom-0'}`} />
          <span className={`absolute left-1/2 top-1 h-2 w-2 -translate-x-1/2 rounded-full border ${step.enabled ? 'border-slate-400 bg-slate-400' : 'border-slate-300 bg-white'}`} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-1.5">
            <span className="min-w-0 text-sm font-medium text-slate-900 line-clamp-2">{copyOf(step.title)}</span>
            {step.important && <Star className="h-3.5 w-3.5 shrink-0 mt-0.5 text-slate-500" strokeWidth={1.75} aria-label="Always sends" />}
          </span>
          <span className="mt-0.5 text-xs text-slate-500 line-clamp-2">{copyOf(step.body)}</span>
        </span>
      </button>

      <div className="flex shrink-0 items-center gap-1 pr-3 sm:pr-4">
        {/* On a phone the row has no width to spare — preview lives one tap in,
            on the message itself. */}
        <button type="button" onClick={onPreview} disabled={busy} title="Preview" className="hidden sm:block p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-60">
          <Eye className="h-4 w-4" strokeWidth={1.75} /><span className="sr-only">Preview {copyOf(step.title)}</span>
        </button>
        <Switch checked={step.enabled} onChange={onToggle} disabled={busy} onColor="bg-slate-900" aria-label={step.enabled ? `Turn off ${copyOf(step.title)}` : `Turn on ${copyOf(step.title)}`} />
      </div>
    </li>
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

function StepSheet({ draft, clients, busy, isMembership = false, placeholders, onPatch, onToggleChannel, onSave, onDelete, onPreview, onCancel }: {
  draft: Step
  clients: ClientOpt[]
  busy: boolean
  /** A membership step anchors on the purchase, not a session. */
  isMembership?: boolean
  /** Only the tokens THIS flow's engine substitutes — see placeholderOptionsFor. */
  placeholders: readonly PlaceholderOption[]
  onPatch: (p: Partial<Step>) => void
  onToggleChannel: (c: Channel) => void
  onSave: () => void
  onDelete: () => void
  onPreview: () => void
  onCancel: () => void
}) {
  const canSave = draft.channels.length > 0 && copyOf(draft.title).trim() && copyOf(draft.body).trim()
  const toStaff = draft.audience === 'STAFF'
  const channels = CHANNELS.filter(c => toStaff || !STAFF_ONLY_CHANNELS.includes(c.key))
  const audienceHint = AUDIENCES.find(a => a.key === draft.audience)?.hint

  return (
    <Sheet
      title="Message"
      onClose={onCancel}
      footer={
        <div className="flex items-center gap-2">
          <button onClick={onDelete} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-3 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-60">
            <Trash2 className="h-4 w-4" strokeWidth={1.75} /> Delete
          </button>
          <div className="flex-1" />
          <button onClick={onPreview} className="inline-flex items-center gap-1.5 h-10 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50">
            <Eye className="h-4 w-4" strokeWidth={1.75} /> Preview
          </button>
          <button onClick={onSave} disabled={busy || !canSave} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} /> : <Check className="h-4 w-4" strokeWidth={1.75} />} Save
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* WHEN */}
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

        {/* WHO — before HOW, because who it's for decides what can carry it. */}
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

        {/* WHAT */}
        <Field label="Message">
          <input value={copyOf(draft.title)} onChange={e => onPatch({ title: e.target.value })} aria-label="Title" placeholder="Title (e.g. See you tomorrow 🐾)" className="w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800" />
          <textarea value={copyOf(draft.body)} onChange={e => onPatch({ body: e.target.value })} aria-label="Message" rows={4} placeholder="Your message…" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" />
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
