'use client'

// The trainer-facing editor for a class / drop-in / event's automated messages.
// Designed to be dead simple: a timeline of message cards, each answering
// "when · how · who · what". Add one, pick a time, pick channels, type the
// message. Starter reminders and saveable/reusable templates in one tap.
import { useState, useEffect, useCallback } from 'react'
import { Bell, Mail, Smartphone, Plus, Trash2, Loader2, Star, Check, Sparkles, Save, Pencil, X } from 'lucide-react'

type Channel = 'PUSH' | 'EMAIL' | 'IN_APP'
type Direction = 'BEFORE_SESSION' | 'AFTER_SESSION'
type Audience = 'ENROLLED' | 'ENROLLED_AND_WAITLIST' | 'CUSTOM'

interface Step {
  id: string
  direction: Direction
  offsetMinutes: number
  channels: Channel[]
  audience: Audience
  customClientIds: string[]
  important: boolean
  title: string
  body: string
  enabled: boolean
  order: number
}
interface TemplateSummary { id: string; name: string; stepCount: number }
interface ClientOpt { id: string; name: string }

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
const CHANNELS: { key: Channel; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'PUSH', label: 'Push', Icon: Bell },
  { key: 'EMAIL', label: 'Email', Icon: Mail },
  { key: 'IN_APP', label: 'In‑app', Icon: Smartphone },
]
const AUDIENCES: { key: Audience; label: string }[] = [
  { key: 'ENROLLED', label: 'Everyone booked' },
  { key: 'ENROLLED_AND_WAITLIST', label: 'Booked + waitlist' },
  { key: 'CUSTOM', label: 'Choose people' },
]
const PLACEHOLDERS = ['{{name}}', '{{dog}}', '{{time}}', '{{date}}', '{{class}}', '{{business}}', '{{location}}']
const SAMPLE: Record<string, string> = {
  '{{name}}': 'Sam', '{{dog}}': 'Bailey', '{{time}}': '6:00 pm', '{{date}}': 'Tue 5 Aug',
  '{{class}}': 'Puppy Class', '{{business}}': 'your business', '{{location}}': 'the hall',
}

function humanWhen(direction: Direction, min: number): string {
  const preset = OFFSETS.find(o => o.min === min)
  const label = preset ? preset.label : min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} hr` : `${Math.round(min / 1440)} days`
  return `${label} ${direction === 'BEFORE_SESSION' ? 'before' : 'after'}`
}
// Read the flow top-to-bottom in real time order: earliest "before" first,
// through the session, then "after".
function timelinePos(s: Step): number {
  return s.direction === 'BEFORE_SESSION' ? -s.offsetMinutes : s.offsetMinutes
}
function preview(body: string): string {
  return PLACEHOLDERS.reduce((acc, p) => acc.split(p).join(SAMPLE[p]), body)
}

export function CommsFlowEditor({ runId, clients = [] }: { runId: string; clients?: ClientOpt[] }) {
  const base = `/api/trainer/class-runs/${runId}/comms-flow`
  const [steps, setSteps] = useState<Step[] | null>(null)
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Step | null>(null)
  const [busy, setBusy] = useState(false)
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
    startEdit(step)
  }
  async function seedStarter() {
    const res = await api(base, { method: 'POST', body: JSON.stringify({ seed: 'starter' }) })
    if (res) setSteps(await res.json())
  }
  async function saveDraft() {
    if (!draft) return
    const { id, direction, offsetMinutes, channels, audience, customClientIds, important, title, body, enabled } = draft
    const res = await api(`${base}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ direction, offsetMinutes, channels, audience, customClientIds, important, title, body, enabled }),
    })
    if (!res) return
    const saved: Step = await res.json()
    setSteps(prev => (prev ?? []).map(s => (s.id === saved.id ? saved : s)))
    setEditingId(null)
    setDraft(null)
  }
  async function toggleEnabled(step: Step) {
    setSteps(prev => (prev ?? []).map(s => (s.id === step.id ? { ...s, enabled: !s.enabled } : s)))
    await api(`${base}/${step.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !step.enabled }) })
  }
  async function remove(id: string) {
    const res = await api(`${base}/${id}`, { method: 'DELETE' })
    if (res) setSteps(prev => (prev ?? []).filter(s => s.id !== id))
  }
  async function applyTemplate(templateId: string) {
    const res = await api(`${base}/apply-template`, { method: 'POST', body: JSON.stringify({ templateId }) })
    if (res) setSteps(await res.json())
  }
  async function saveAsTemplate() {
    const name = window.prompt('Name this template (e.g. "Standard class reminders")')?.trim()
    if (!name) return
    const res = await api('/api/trainer/comms-flow-templates', { method: 'POST', body: JSON.stringify({ name, runId }) })
    if (res) load()
  }

  function startEdit(step: Step) {
    setDraft({ ...step })
    setEditingId(step.id)
  }
  function patchDraft(p: Partial<Step>) { setDraft(d => (d ? { ...d, ...p } : d)) }
  function toggleChannel(ch: Channel) {
    if (!draft) return
    const has = draft.channels.includes(ch)
    patchDraft({ channels: has ? draft.channels.filter(c => c !== ch) : [...draft.channels, ch] })
  }

  if (steps === null) {
    return <div className="flex items-center gap-2 text-sm text-slate-500 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading messages…</div>
  }

  const ordered = [...steps].sort((a, b) => timelinePos(a) - timelinePos(b))

  return (
    <div className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 border-b border-slate-100">
        <div>
          <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2"><Bell className="h-4 w-4 text-blue-600" /> Reminders &amp; messages</h3>
          <p className="text-sm text-slate-500 mt-0.5 max-w-prose">Send automatic reminders to everyone booked — before and after each session, by push, email or in‑app.</p>
        </div>
        {steps.length > 0 && (
          <div className="flex items-center gap-2">
            <button onClick={saveAsTemplate} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Save className="h-4 w-4 text-slate-400" /> Save as template
            </button>
          </div>
        )}
      </div>

      {error && <div className="mx-5 mt-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      {steps.length === 0 ? (
        <div className="p-6 text-center">
          <div className="mx-auto w-11 h-11 rounded-full bg-blue-50 flex items-center justify-center mb-3"><Bell className="h-5 w-5 text-blue-600" /></div>
          <p className="text-sm text-slate-600 mb-4 max-w-sm mx-auto">No messages yet. Add reminders that go out automatically around each session.</p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button onClick={seedStarter} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
              <Sparkles className="h-4 w-4" /> Use starter reminders
            </button>
            <button onClick={addMessage} disabled={busy} className="inline-flex items-center gap-1.5 h-10 px-4 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              <Plus className="h-4 w-4" /> Add a message
            </button>
          </div>
          {templates.length > 0 && (
            <div className="mt-4"><TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} /></div>
          )}
        </div>
      ) : (
        <div className="p-4 sm:p-5 flex flex-col gap-3">
          {ordered.map(step =>
            editingId === step.id && draft ? (
              <StepEditor
                key={step.id}
                draft={draft}
                clients={clients}
                busy={busy}
                onPatch={patchDraft}
                onToggleChannel={toggleChannel}
                onSave={saveDraft}
                onCancel={() => { setEditingId(null); setDraft(null) }}
              />
            ) : (
              <StepRow key={step.id} step={step} onEdit={() => startEdit(step)} onDelete={() => remove(step.id)} onToggle={() => toggleEnabled(step)} busy={busy} />
            ),
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button onClick={addMessage} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-dashed border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-slate-50 disabled:opacity-60">
              <Plus className="h-4 w-4" /> Add a message
            </button>
            {templates.length > 0 && <TemplatePicker templates={templates} onApply={applyTemplate} busy={busy} />}
          </div>
        </div>
      )}
    </div>
  )
}

function StepRow({ step, onEdit, onDelete, onToggle, busy }: { step: Step; onEdit: () => void; onDelete: () => void; onToggle: () => void; busy: boolean }) {
  const chans = CHANNELS.filter(c => step.channels.includes(c.key))
  const audience = AUDIENCES.find(a => a.key === step.audience)?.label ?? ''
  return (
    <div className={`rounded-xl border border-slate-200 p-3.5 flex items-start gap-3 ${step.enabled ? 'bg-white' : 'bg-slate-50 opacity-70'}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold text-slate-900">{humanWhen(step.direction, step.offsetMinutes)}</span>
          <span className="text-slate-300">·</span>
          <span className="inline-flex items-center gap-1 text-slate-600">
            {chans.map(c => <c.Icon key={c.key} className="h-3.5 w-3.5" />)}
            {chans.map(c => c.label).join(' + ')}
          </span>
          <span className="text-slate-300">·</span>
          <span className="text-slate-500">{audience}</span>
          {step.important && <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700"><Star className="h-3 w-3" /> Important</span>}
        </div>
        <p className="text-sm font-medium text-slate-800 mt-1 truncate">{step.title}</p>
        <p className="text-xs text-slate-500 truncate">{step.body}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={onToggle} disabled={busy} title={step.enabled ? 'Turn off' : 'Turn on'} className={`relative w-9 h-5 rounded-full transition-colors ${step.enabled ? 'bg-blue-600' : 'bg-slate-300'} disabled:opacity-60`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${step.enabled ? 'right-0.5' : 'left-0.5'}`} />
        </button>
        <button onClick={onEdit} disabled={busy} title="Edit" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-60"><Pencil className="h-4 w-4" /></button>
        <button onClick={onDelete} disabled={busy} title="Delete" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-60"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

function StepEditor({ draft, clients, busy, onPatch, onToggleChannel, onSave, onCancel }: {
  draft: Step
  clients: ClientOpt[]
  busy: boolean
  onPatch: (p: Partial<Step>) => void
  onToggleChannel: (c: Channel) => void
  onSave: () => void
  onCancel: () => void
}) {
  const canSave = draft.channels.length > 0 && draft.title.trim() && draft.body.trim()
  return (
    <div className="rounded-xl border-2 border-blue-200 bg-blue-50/40 p-4 flex flex-col gap-4">
      {/* WHEN */}
      <Field label="When">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-white border border-slate-200 p-0.5">
            {(['BEFORE_SESSION', 'AFTER_SESSION'] as Direction[]).map(d => (
              <button key={d} onClick={() => onPatch({ direction: d })} className={`px-3 h-8 text-sm font-medium rounded-md ${draft.direction === d ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>
                {d === 'BEFORE_SESSION' ? 'Before' : 'After'}
              </button>
            ))}
          </div>
          <select value={draft.offsetMinutes} onChange={e => onPatch({ offsetMinutes: Number(e.target.value) })} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
            {OFFSETS.map(o => <option key={o.min} value={o.min}>{o.label}</option>)}
          </select>
          <span className="text-sm text-slate-500">the session</span>
        </div>
      </Field>

      {/* HOW */}
      <Field label="How">
        <div className="flex flex-wrap gap-2">
          {CHANNELS.map(({ key, label, Icon }) => {
            const on = draft.channels.includes(key)
            return (
              <button key={key} onClick={() => onToggleChannel(key)} className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
                <Icon className="h-4 w-4" /> {label} {on && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })}
        </div>
      </Field>

      {/* WHO */}
      <Field label="Who">
        <select value={draft.audience} onChange={e => onPatch({ audience: e.target.value as Audience })} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700">
          {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        {draft.audience === 'CUSTOM' && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-2 max-h-40 overflow-y-auto">
            {clients.length === 0 ? (
              <p className="text-xs text-slate-500 px-1 py-1">Add clients to this class first.</p>
            ) : clients.map(c => {
              const on = draft.customClientIds.includes(c.id)
              return (
                <label key={c.id} className="flex items-center gap-2 px-1 py-1 text-sm text-slate-700 cursor-pointer hover:bg-slate-50 rounded">
                  <input type="checkbox" checked={on} onChange={() => onPatch({ customClientIds: on ? draft.customClientIds.filter(id => id !== c.id) : [...draft.customClientIds, c.id] })} />
                  {c.name}
                </label>
              )
            })}
          </div>
        )}
      </Field>

      {/* WHAT */}
      <Field label="Message">
        <input value={draft.title} onChange={e => onPatch({ title: e.target.value })} placeholder="Title (e.g. See you tomorrow 🐾)" className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800" />
        <textarea value={draft.body} onChange={e => onPatch({ body: e.target.value })} rows={3} placeholder="Your message…" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" />
        <div className="flex flex-wrap gap-1 mt-2">
          {PLACEHOLDERS.map(p => (
            <button key={p} onClick={() => onPatch({ body: `${draft.body}${draft.body && !draft.body.endsWith(' ') ? ' ' : ''}${p}` })} className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-blue-700 hover:bg-blue-50">{p}</button>
          ))}
        </div>
        {draft.body.trim() && <p className="mt-2 text-xs text-slate-500"><span className="font-medium text-slate-400">Preview:</span> {preview(draft.body)}</p>}
      </Field>

      {/* IMPORTANT */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <button onClick={() => onPatch({ important: !draft.important })} className={`mt-0.5 relative w-9 h-5 rounded-full shrink-0 transition-colors ${draft.important ? 'bg-amber-500' : 'bg-slate-300'}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${draft.important ? 'right-0.5' : 'left-0.5'}`} />
        </button>
        <span className="text-sm text-slate-700"><span className="font-medium inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500" /> Mark important</span><br /><span className="text-xs text-slate-500">Always send, even if the client muted their notifications. Use for cancellations or venue changes.</span></span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-60"><X className="h-4 w-4" /> Cancel</button>
        <button onClick={onSave} disabled={busy || !canSave} className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save message
        </button>
      </div>
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

function TemplatePicker({ templates, onApply, busy }: { templates: TemplateSummary[]; onApply: (id: string) => void; busy: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(o => !o)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        <Sparkles className="h-4 w-4 text-slate-400" /> Apply a template
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-56 rounded-xl border border-slate-200 bg-white shadow-lg p-1">
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
