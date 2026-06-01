'use client'

import { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Plus, Loader2, FileText, Pencil, Trash2, Star, Link2, X, Sparkles, Check, Lock, List, Layers, ChevronLeft, ChevronRight } from 'lucide-react'
import { VoiceInput } from '@/components/voice-input'
import { ImageUploadButton, ImageGallery } from '@/components/image-uploader'

export type Question =
  | { id: string; type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'; label: string; required: boolean; isPrivate?: boolean }
  | { id: string; type: 'CUSTOM_FIELD'; customFieldId: string; required: boolean; isPrivate?: boolean }

interface FormTemplate {
  id: string
  name: string
  description: string | null
  introText?: string | null
  closingText?: string | null
  questions: Question[]
}

// Inline editor for the trainer's intro/closing message. Pulls a "use form's
// suggestion" button when the template has matching introText/closingText and
// the field is empty. Saves on blur.
function MessageComposer({
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  suggestion,
  sessionId,
  hideLabel = false,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onCommit: (v: string) => void
  suggestion?: string | null
  sessionId: string
  // Suppress the field's own label — used by the fullscreen step flow where the
  // prompt is already shown as a big heading above the composer.
  hideLabel?: boolean
}) {
  return (
    <div>
      {(!hideLabel || (suggestion && !value)) && (
        <div className="flex items-center justify-between mb-1.5">
          {hideLabel ? <span /> : <label className="text-sm font-medium text-slate-700">{label}</label>}
          {suggestion && !value && (
            <button
              type="button"
              onClick={() => { onChange(suggestion); onCommit(suggestion) }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-full px-2.5 py-1 transition-colors"
              title="Use the form's suggestion as a starting point"
            >
              <Check className="h-3 w-3" /> Use form&rsquo;s {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
      {suggestion && !value && (
        <p className="text-[11px] text-slate-400 mb-1.5 italic line-clamp-2">
          Suggested: &ldquo;{suggestion}&rdquo;
        </p>
      )}
      <div className="relative rounded-2xl bg-slate-50 border border-transparent focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50 transition-all">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={e => onCommit(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="w-full bg-transparent px-4 pt-3 pb-10 text-sm leading-relaxed focus:outline-none resize-none placeholder:text-slate-400"
        />
        <div className="absolute bottom-1.5 right-1.5">
          <VoiceInput onAppend={t => {
            const next = value.trimEnd()
            const merged = next ? `${next} ${t}` : t
            onChange(merged)
            onCommit(merged)
          }} />
        </div>
      </div>
    </div>
  )
}

interface FormResponse {
  id: string
  formId: string
  answers: Record<string, string>
  imagesByQuestion?: Record<string, string[]>
  introMessage?: string | null
  closingMessage?: string | null
  form: { id: string; name: string; questions: Question[]; introText?: string | null; closingText?: string | null }
}

interface LinkedField {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  options: string[]
  appliesTo: 'OWNER' | 'DOG'
  currentValue: string
}

interface LinkedFieldsBundle {
  clientId: string | null
  primaryDogId: string | null
  customFields: LinkedField[]
}

/**
 * Drop into any session-detail surface. Self-contained: fetches templates,
 * existing responses, and linked-field metadata for the session, then renders
 * the report + an "Attach form" affordance.
 *
 * `layout='modal'` (default): pickers and fillers render as modal overlays —
 * suitable when the host is itself a modal/popover.
 * `layout='inline'`: pickers and fillers render directly on the page, no
 * overlays — suitable for the full-page session view.
 *
 * `autoPromptIfEmpty` opens the picker on first load if no responses exist.
 */
export function SessionFormReport({
  sessionId,
  layout = 'modal',
  autoPromptIfEmpty = false,
}: {
  sessionId: string
  layout?: 'modal' | 'inline'
  autoPromptIfEmpty?: boolean
}) {
  const [templates, setTemplates] = useState<FormTemplate[] | null>(null)
  const [responses, setResponses] = useState<FormResponse[] | null>(null)
  const [linked, setLinked] = useState<LinkedFieldsBundle | null>(null)
  const [editing, setEditing] = useState<{ template: FormTemplate; existing: FormResponse | null } | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [autoPrompted, setAutoPrompted] = useState(false)

  useEffect(() => {
    fetch('/api/session-forms')
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => setTemplates(Array.isArray(data) ? (data as FormTemplate[]) : []))
      .catch(() => setTemplates([]))
    fetch(`/api/sessions/${sessionId}/form-responses`)
      .then(r => r.ok ? r.json() : [])
      .then((data: unknown) => setResponses(Array.isArray(data) ? (data as FormResponse[]) : []))
      .catch(() => setResponses([]))
    fetch(`/api/sessions/${sessionId}/linked-fields`)
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => setLinked((data as LinkedFieldsBundle) ?? null))
      .catch(() => setLinked(null))
  }, [sessionId])

  // Auto-open picker once on first load when caller requested it AND the
  // session has no responses but at least one template exists.
  useEffect(() => {
    if (!autoPromptIfEmpty || autoPrompted) return
    if (templates === null || responses === null) return
    if (responses.length === 0 && templates.length > 0) {
      setPickerOpen(true)
    }
    setAutoPrompted(true)
  }, [autoPromptIfEmpty, autoPrompted, templates, responses])

  function handleSaved(saved: FormResponse) {
    setResponses(prev => {
      const list = prev ?? []
      const idx = list.findIndex(r => r.formId === saved.formId)
      if (idx === -1) return [...list, saved]
      const next = list.slice()
      next[idx] = saved
      return next
    })
    setEditing(null)
    fetch(`/api/sessions/${sessionId}/linked-fields`)
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => setLinked((data as LinkedFieldsBundle) ?? null))
      .catch(() => {})
  }

  // Quiet delete — the caller is responsible for confirming first. Inline
  // callers use a two-step in-place confirmation; modal callers (the report
  // card trash icon) add a browser confirm via `handleDeleteWithPrompt`.
  async function handleDelete(formId: string) {
    const res = await fetch(`/api/sessions/${sessionId}/form-responses/${formId}`, { method: 'DELETE' })
    if (res.ok) {
      setResponses(prev => (prev ?? []).filter(r => r.formId !== formId))
    }
  }

  async function handleDeleteWithPrompt(formId: string) {
    if (!confirm('Remove this form from the session? Your answers will be lost.')) return
    await handleDelete(formId)
  }

  const loaded = templates !== null && responses !== null && linked !== null
  const attachedFormIds = new Set((responses ?? []).map(r => r.formId))
  const unattached = (templates ?? []).filter(t => !attachedFormIds.has(t.id))
  const linkedFieldMap = new Map((linked?.customFields ?? []).map(f => [f.id, f]))

  // INLINE MODE — the surface that lives at /sessions/[id].
  if (layout === 'inline') {
    if (!loaded) {
      return (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )
    }

    // No templates exist anywhere — surface a one-time setup nudge.
    if ((templates?.length ?? 0) === 0) {
      return (
        <p className="text-sm text-slate-400">
          No session forms yet. Create one in <a href="/settings?tab=forms" className="text-blue-600 hover:underline">Settings → Forms</a>.
        </p>
      )
    }

    // A form is attached — render it as the always-editable surface. Sessions
    // hold at most one form, so we read the head of the array directly.
    if ((responses?.length ?? 0) > 0 && linked) {
      const r = responses![0]
      const template = (templates ?? []).find(t => t.id === r.formId)
      if (!template) {
        return (
          <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 text-sm text-amber-700">
            The template for &ldquo;{r.form.name}&rdquo; was deleted. Existing answers are preserved but cannot be edited.
          </div>
        )
      }
      // Default to a read-only PREVIEW with an Edit button. Editing reveals the
      // filler; saving (handleSaved sets editing=null) or cancelling returns
      // to the preview.
      if (!editing) {
        return (
          <InlineNotesPreview
            response={r}
            template={template}
            linkedFieldMap={linkedFieldMap}
            onEdit={() => setEditing({ template, existing: r })}
          />
        )
      }
      return (
        <FormFillerBody
          sessionId={sessionId}
          template={editing.template}
          existing={editing.existing}
          linked={linked}
          onSaved={handleSaved}
          onCancel={() => setEditing(null)}
          onRemove={() => handleDelete(r.formId)}
          key={r.formId}
        />
      )
    }

    // No form yet — offer a dropdown to pick one. Selecting attaches it
    // immediately by writing an empty response, which then re-renders into
    // the always-editable form view above.
    return (
      <div className="p-5">
      <FormDropdown
        templates={templates ?? []}
        sessionId={sessionId}
        onAttached={(template) => {
          // Optimistically synthesise a response so the next render shows the
          // filler immediately, then refresh from the server for canonical ids.
          setResponses(prev => ([
            ...(prev ?? []),
            {
              id: `optimistic-${template.id}`,
              formId: template.id,
              answers: {},
              form: { id: template.id, name: template.name, questions: template.questions },
            },
          ]))
          fetch(`/api/sessions/${sessionId}/form-responses`)
            .then(r => r.ok ? r.json() : [])
            .then((data: unknown) => setResponses(Array.isArray(data) ? (data as FormResponse[]) : []))
            .catch(() => {})
        }}
      />
      </div>
    )
  }

  // A session holds at most one form. Once attached, the Attach button hides;
  // removing the form (via the filler footer) reveals it again.
  const canAttach = loaded && (templates?.length ?? 0) > 0 && (responses?.length ?? 0) === 0

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
          Session report
        </p>
        {canAttach && (
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200"
          >
            <Plus className="h-3 w-3" /> Attach form
          </button>
        )}
      </div>

      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (templates?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-400">
          No session forms yet. Create one in <a href="/settings?tab=forms" className="text-blue-600 hover:underline">Settings → Forms</a>.
        </p>
      ) : (responses?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-400">
          No reports filled in. Click &ldquo;Attach form&rdquo; to capture observations.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {responses!.map(r => {
            const template = (templates ?? []).find(t => t.id === r.formId)
            const questions: Question[] = template?.questions ?? r.form.questions
            return (
              <div key={r.id} className="border border-slate-200 rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <p className="font-medium text-slate-900 text-sm truncate">{r.form.name}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => template && setEditing({ template, existing: r })}
                      disabled={!template}
                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded disabled:opacity-40"
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteWithPrompt(r.formId)}
                      className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {questions.map(q => {
                    const value = r.answers[q.id] ?? ''
                    if (!value) return null
                    const label = q.type === 'CUSTOM_FIELD'
                      ? linkedFieldMap.get(q.customFieldId)?.label ?? 'Linked field'
                      : q.label
                    const displayType = q.type === 'CUSTOM_FIELD'
                      ? mapCustomFieldType(linkedFieldMap.get(q.customFieldId)?.type)
                      : q.type
                    return (
                      <div key={q.id}>
                        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide flex items-center gap-1">
                          {q.type === 'CUSTOM_FIELD' && <Link2 className="h-3 w-3 text-emerald-600" />}
                          {label}
                        </p>
                        <AnswerDisplay type={displayType} value={value} />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal-layout overlays */}
      {layout === 'modal' && pickerOpen && (
        <ModalShell onClose={() => setPickerOpen(false)}>
          <FormPickerBody
            templates={unattached}
            linkedFieldMap={linkedFieldMap}
            onPick={(t) => { setEditing({ template: t, existing: null }); setPickerOpen(false) }}
            onCancel={() => setPickerOpen(false)}
          />
        </ModalShell>
      )}

      {layout === 'modal' && editing && linked && (
        <ModalShell onClose={() => setEditing(null)} large>
          <FormFillerBody
            sessionId={sessionId}
            template={editing.template}
            existing={editing.existing}
            linked={linked}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
          />
        </ModalShell>
      )}
    </div>
  )
}

function mapCustomFieldType(t: 'TEXT' | 'NUMBER' | 'DROPDOWN' | undefined): 'SHORT_TEXT' | 'NUMBER' | 'LONG_TEXT' {
  if (t === 'NUMBER') return 'NUMBER'
  return 'SHORT_TEXT'
}

// Read-only preview of a saved session report (inline layout). Shows the filled
// answers with an Edit button; the host swaps in the editable filler when the
// trainer clicks Edit.
function InlineNotesPreview({
  response,
  template,
  linkedFieldMap,
  onEdit,
}: {
  response: FormResponse
  template: FormTemplate
  linkedFieldMap: Map<string, { label: string; type?: 'TEXT' | 'NUMBER' | 'DROPDOWN' }>
  onEdit: () => void
}) {
  const filled = template.questions.filter(q => response.answers[q.id])
  return (
    <div>
      {/* Header strip */}
      <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 bg-gradient-to-r from-slate-50 via-white to-white">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm flex-shrink-0">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 text-sm truncate leading-tight">{response.form.name}</p>
            <p className="text-[11px] text-slate-400 leading-tight">Session notes</p>
          </div>
        </div>
        <button
          onClick={onEdit}
          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 h-9 rounded-xl bg-slate-900 text-white hover:bg-slate-800 active:scale-95 transition flex-shrink-0 shadow-sm"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      </div>

      {filled.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-300">
            <FileText className="h-6 w-6" />
          </span>
          <p className="text-sm text-slate-500 mt-3">No notes recorded for this session yet.</p>
          <button
            onClick={onEdit}
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold px-4 h-9 rounded-xl bg-slate-900 text-white hover:bg-slate-800 active:scale-95 transition"
          >
            <Pencil className="h-3.5 w-3.5" /> Add your write-up
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {filled.map(q => {
            const value = response.answers[q.id] ?? ''
            const isCustom = q.type === 'CUSTOM_FIELD'
            const label = isCustom
              ? linkedFieldMap.get(q.customFieldId)?.label ?? 'Linked field'
              : q.label
            const displayType = isCustom
              ? mapCustomFieldType(linkedFieldMap.get(q.customFieldId)?.type)
              : q.type
            return (
              <div key={q.id} className="px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
                <p className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  {isCustom && <Link2 className="h-3.5 w-3.5 text-emerald-500" />}
                  {label}
                  {q.isPrivate && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Private — only you can see this, not the client">
                      <Lock className="h-2.5 w-2.5" /> Private
                    </span>
                  )}
                </p>
                <div className="mt-1 text-[15px] text-slate-700 leading-relaxed">
                  <AnswerDisplay type={displayType} value={value} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function AnswerDisplay({ type, value }: { type: string; value: string }) {
  if (type === 'RATING_1_5') {
    const n = Math.max(0, Math.min(5, parseInt(value, 10) || 0))
    return (
      <div className="flex items-center gap-0.5 mt-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            className={`h-4 w-4 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
          />
        ))}
      </div>
    )
  }
  return (
    <p className="text-sm text-slate-700 whitespace-pre-wrap mt-0.5">{value}</p>
  )
}

function ModalShell({ children, onClose, large }: { children: React.ReactNode; onClose: () => void; large?: boolean }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div
        className={`relative z-[61] bg-white rounded-2xl shadow-2xl w-full ${large ? 'max-w-md' : 'max-w-sm'} max-h-[90vh] flex flex-col`}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function FormDropdown({
  templates,
  sessionId,
  onAttached,
}: {
  templates: FormTemplate[]
  sessionId: string
  onAttached: (t: FormTemplate) => void
}) {
  const [attaching, setAttaching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSelect(formId: string) {
    if (!formId) return
    const template = templates.find(t => t.id === formId)
    if (!template) return
    setAttaching(true)
    setError(null)
    // Attach by writing an empty response — the upsert endpoint creates it
    // if missing. The trainer fills it in afterwards in the always-on filler.
    const res = await fetch(`/api/sessions/${sessionId}/form-responses/${formId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: {} }),
    })
    if (!res.ok) {
      setError('Failed to attach form')
      setAttaching(false)
      return
    }
    setAttaching(false)
    onAttached(template)
  }

  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">Choose a form for this session</label>
      <select
        value=""
        onChange={e => handleSelect(e.target.value)}
        disabled={attaching}
        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      >
        <option value="" disabled>{attaching ? 'Attaching…' : 'Select a form…'}</option>
        {templates.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  )
}

function FormPickerBody({
  templates,
  linkedFieldMap,
  onPick,
  onCancel,
}: {
  templates: FormTemplate[]
  linkedFieldMap: Map<string, LinkedField>
  onPick: (t: FormTemplate) => void
  onCancel: () => void
}) {
  return (
    <>
      <div className="p-5 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-900">Choose a form</h3>
          <p className="text-xs text-slate-500 mt-0.5">Pick the report you want to fill in for this session.</p>
        </div>
        <button onClick={onCancel} className="p-1 text-slate-400 hover:text-slate-600 flex-shrink-0">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="p-2 max-h-[60vh] overflow-y-auto">
        {templates.length === 0 ? (
          <p className="text-sm text-slate-400 p-4 text-center">All forms are already attached.</p>
        ) : (
          templates.map(t => {
            const linkedCount = t.questions.filter(q => q.type === 'CUSTOM_FIELD' && linkedFieldMap.has(q.customFieldId)).length
            return (
              <button
                key={t.id}
                onClick={() => onPick(t)}
                className="w-full text-left p-3 rounded-xl hover:bg-slate-50 transition-colors"
              >
                <p className="text-sm font-medium text-slate-900">{t.name}</p>
                {t.description && <p className="text-xs text-slate-500 mt-0.5">{t.description}</p>}
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.questions.length} question{t.questions.length === 1 ? '' : 's'}
                  {linkedCount > 0 && (
                    <span className="text-emerald-600"> · {linkedCount} synced to client</span>
                  )}
                </p>
              </button>
            )
          })
        )}
      </div>
    </>
  )
}

function FormFillerBody({
  sessionId,
  template,
  existing,
  linked,
  onSaved,
  onCancel,
  onRemove,
}: {
  sessionId: string
  template: FormTemplate
  existing: FormResponse | null
  linked: LinkedFieldsBundle
  onSaved: (r: FormResponse) => void
  // Cancel is shown when a transient edit can be discarded (e.g. a fresh
  // attach). When the form is in always-on inline mode there's nothing to
  // cancel back to, so the host omits this and we offer Remove instead.
  onCancel?: () => void
  onRemove?: () => void
}) {
  const linkedFieldMap = new Map(linked.customFields.map(f => [f.id, f]))

  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const q of template.questions) {
      if (existing?.answers[q.id] !== undefined) {
        initial[q.id] = existing.answers[q.id]
      } else if (q.type === 'CUSTOM_FIELD') {
        initial[q.id] = linkedFieldMap.get(q.customFieldId)?.currentValue ?? ''
      } else {
        initial[q.id] = ''
      }
    }
    return initial
  })
  const [imagesByQuestion, setImagesByQuestion] = useState<Record<string, string[]>>(
    () => (existing?.imagesByQuestion ?? {}) as Record<string, string[]>
  )
  const [introMessage, setIntroMessage] = useState(existing?.introMessage ?? '')
  const [closingMessage, setClosingMessage] = useState(existing?.closingMessage ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  // Entry mode: answer one at a time in a focused fullscreen flow ('step',
  // default) or see every question at once ('list'). Step mode swipes/slides
  // through the prompts — friendlier everywhere, especially on a phone.
  const [mode, setMode] = useState<'list' | 'step'>('step')
  const [step, setStep] = useState(0)
  const touchStartX = useRef<number | null>(null)

  // Auto-revert the "are you sure?" Remove state if the trainer doesn't follow
  // through within a few seconds — nudges them away from accidental deletes.
  useEffect(() => {
    if (!confirmingRemove) return
    const t = setTimeout(() => setConfirmingRemove(false), 5000)
    return () => clearTimeout(t)
  }, [confirmingRemove])

  function setAnswer(id: string, value: string) {
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  async function handlePolish() {
    setError(null)
    setPolishing(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/polish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: template.id, answers }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body?.error?.toString() ?? 'AI polish failed')
        return
      }
      const { polished } = await res.json() as { polished: Record<string, string> }
      // Merge polished text in. Empty values are skipped server-side; merge
      // only what the AI returned so untouched fields are preserved.
      setAnswers(prev => ({ ...prev, ...polished }))
    } finally {
      setPolishing(false)
    }
  }

  async function handleSave() {
    setError(null)
    for (const q of template.questions) {
      if (!q.required) continue
      const val = (answers[q.id] ?? '').trim()
      if (!val) {
        const label = q.type === 'CUSTOM_FIELD'
          ? linkedFieldMap.get(q.customFieldId)?.label ?? 'Linked field'
          : q.label
        setError(`"${label}" is required`)
        return
      }
    }
    setSaving(true)
    const res = await fetch(`/api/sessions/${sessionId}/form-responses/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers,
        imagesByQuestion,
        introMessage: introMessage || null,
        closingMessage: closingMessage || null,
      }),
    })
    if (!res.ok) {
      setError('Failed to save')
      setSaving(false)
      return
    }
    const saved = await res.json()
    onSaved({
      id: saved.id,
      formId: saved.formId,
      answers: saved.answers as Record<string, string>,
      form: { id: template.id, name: template.name, questions: template.questions },
    })
    setSaving(false)
  }

  const renderQuestion = (q: Question) => {
    if (q.type === 'CUSTOM_FIELD') {
      const linkedField = linkedFieldMap.get(q.customFieldId)
      if (!linkedField) {
        return (
          <div key={q.id} className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Linked field is missing or was deleted.
          </div>
        )
      }
      return (
        <div key={q.id}>
          <label className="text-sm font-medium text-slate-700 mb-1.5 flex items-center gap-1">
            <Link2 className="h-3 w-3 text-emerald-600" />
            {linkedField.label}{q.required && <span className="text-red-500">*</span>}
          </label>
          <CustomFieldInput
            field={linkedField}
            value={answers[q.id] ?? ''}
            onChange={v => setAnswer(q.id, v)}
            imageUrls={imagesByQuestion[q.id] ?? []}
            onImagesChange={(urls) => setImagesByQuestion(prev => ({ ...prev, [q.id]: urls }))}
            sessionId={sessionId}
          />
          <p className="text-[11px] text-emerald-700 mt-1">
            Saving will update the {linkedField.appliesTo === 'DOG' ? "dog's" : "client's"} record.
          </p>
        </div>
      )
    }
    return (
      <div key={q.id}>
        <label className="text-sm font-medium text-slate-700 block mb-1.5">
          {q.label}{q.required && <span className="text-red-500"> *</span>}
        </label>
        <BasicQuestionInput
          type={q.type}
          value={answers[q.id] ?? ''}
          onChange={v => setAnswer(q.id, v)}
          imageUrls={imagesByQuestion[q.id] ?? []}
          onImagesChange={(urls) => setImagesByQuestion(prev => ({ ...prev, [q.id]: urls }))}
          sessionId={sessionId}
        />
      </div>
    )
  }

  // Bare input control (no field label) for the fullscreen one-at-a-time flow,
  // where the prompt is shown as a big heading above the control instead.
  const renderControl = (q: Question): React.ReactNode => {
    if (q.type === 'CUSTOM_FIELD') {
      const linkedField = linkedFieldMap.get(q.customFieldId)
      if (!linkedField) {
        return (
          <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Linked field is missing or was deleted.
          </div>
        )
      }
      return (
        <>
          <CustomFieldInput
            field={linkedField}
            value={answers[q.id] ?? ''}
            onChange={v => setAnswer(q.id, v)}
            imageUrls={imagesByQuestion[q.id] ?? []}
            onImagesChange={(urls) => setImagesByQuestion(prev => ({ ...prev, [q.id]: urls }))}
            sessionId={sessionId}
          />
          <p className="text-[11px] text-emerald-700 mt-1.5">
            Saving will update the {linkedField.appliesTo === 'DOG' ? "dog's" : "client's"} record.
          </p>
        </>
      )
    }
    return (
      <BasicQuestionInput
        type={q.type}
        value={answers[q.id] ?? ''}
        onChange={v => setAnswer(q.id, v)}
        imageUrls={imagesByQuestion[q.id] ?? []}
        onImagesChange={(urls) => setImagesByQuestion(prev => ({ ...prev, [q.id]: urls }))}
        sessionId={sessionId}
      />
    )
  }

  const introComposer = (
    <MessageComposer label="Opening message" placeholder="How would you like to start the report? (optional)" value={introMessage} onChange={setIntroMessage} onCommit={() => { /* persisted on Save */ }} suggestion={template.introText} sessionId={sessionId} />
  )
  const closingComposer = (
    <MessageComposer label="Closing message" placeholder="How would you like to wrap up the report? (optional)" value={closingMessage} onChange={setClosingMessage} onCommit={() => { /* persisted on Save */ }} suggestion={template.closingText} sessionId={sessionId} />
  )

  // One-at-a-time flow: opening → each question → closing. Each panel shows the
  // prompt as a big heading with the bare input below; the fullscreen view keeps
  // the heading / input / nav in fixed positions and slides between panels.
  const questionCount = template.questions.length
  const stepPanels: {
    key: string
    eyebrow: string
    title: string
    hint?: string
    required?: boolean
    isPrivate?: boolean
    control: React.ReactNode
  }[] = [
    {
      key: 'intro',
      eyebrow: 'Opening',
      title: 'Opening message',
      hint: 'How would you like to start the report? (optional)',
      control: (
        <MessageComposer hideLabel label="Opening message" placeholder="Set the scene…" value={introMessage} onChange={setIntroMessage} onCommit={() => {}} suggestion={template.introText} sessionId={sessionId} />
      ),
    },
    ...template.questions.map((q, i) => ({
      key: q.id,
      eyebrow: `Question ${i + 1} of ${questionCount}`,
      title: q.type === 'CUSTOM_FIELD' ? (linkedFieldMap.get(q.customFieldId)?.label ?? 'Linked field') : q.label,
      required: q.required,
      isPrivate: q.isPrivate,
      control: renderControl(q),
    })),
    {
      key: 'closing',
      eyebrow: 'Wrap-up',
      title: 'Closing message',
      hint: 'How would you like to wrap up? (optional)',
      control: (
        <MessageComposer hideLabel label="Closing message" placeholder="Leave them with a takeaway…" value={closingMessage} onChange={setClosingMessage} onCommit={() => {}} suggestion={template.closingText} sessionId={sessionId} />
      ),
    },
  ]
  const curStep = Math.min(step, stepPanels.length - 1)
  const isLastStep = curStep >= stepPanels.length - 1

  function onTouchStart(e: React.TouchEvent) { touchStartX.current = e.touches[0]?.clientX ?? null }
  function onTouchEnd(e: React.TouchEvent) {
    if (mode !== 'step' || touchStartX.current == null) return
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
    if (dx < -50 && curStep < stepPanels.length - 1) setStep(curStep + 1)
    else if (dx > 50 && curStep > 0) setStep(curStep - 1)
    touchStartX.current = null
  }

  // FULLSCREEN ONE-AT-A-TIME FLOW — focused, fixed-layout, slides between
  // prompts. The heading / input / nav stay in the same place every step; only
  // the sliding track moves.
  if (mode === 'step') {
    const panel = stepPanels[curStep]
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-white">
        {/* Top bar — close + switch to full list */}
        <div className="flex items-center gap-2 px-3 sm:px-5 h-14 border-b border-slate-100 flex-shrink-0">
          <button
            type="button"
            onClick={() => (onCancel ? onCancel() : setMode('list'))}
            className="p-2 -ml-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
          <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-900">{template.name}</p>
          <button
            type="button"
            onClick={() => setMode('list')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1.5 rounded-lg hover:bg-slate-100"
          >
            <List className="h-3.5 w-3.5" /> Full list
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 pt-5 flex-shrink-0">
          <div className="mx-auto w-full max-w-xl">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
              <span className="truncate pr-2">{panel.eyebrow}</span>
              <span className="tabular-nums flex-shrink-0">{curStep + 1} / {stepPanels.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out" style={{ width: `${((curStep + 1) / stepPanels.length) * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Sliding track — one panel per prompt; internal layout is identical
            across panels so the box never jumps as you advance. */}
        <div className="flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div
            className="flex h-full transition-transform duration-300 ease-out"
            style={{ transform: `translateX(-${curStep * 100}%)` }}
          >
            {stepPanels.map(p => (
              <div key={p.key} className="h-full w-full flex-shrink-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-xl px-6 py-8 sm:py-12">
                  <div className="min-h-[3.5rem]">
                    <h2 className="text-2xl sm:text-[28px] font-bold leading-tight text-slate-900 flex items-start gap-2 flex-wrap">
                      <span>{p.title}</span>
                      {p.required && <span className="text-red-500 text-xl leading-none">*</span>}
                      {p.isPrivate && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 mt-1.5" title="Private — only you can see this, not the client">
                          <Lock className="h-2.5 w-2.5" /> Private
                        </span>
                      )}
                    </h2>
                    {p.hint && <p className="text-sm text-slate-400 mt-1.5">{p.hint}</p>}
                  </div>
                  <div className="mt-6">{p.control}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="px-6 flex-shrink-0">
            <div className="mx-auto w-full max-w-xl text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{error}</div>
          </div>
        )}

        {/* Fixed footer nav — Back / Next stay put across every step */}
        <div className="border-t border-slate-100 flex-shrink-0 bg-white">
          <div className="mx-auto w-full max-w-xl px-6 py-3.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(Math.max(0, curStep - 1))}
              disabled={curStep === 0}
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-0"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            {isLastStep ? (
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 h-11 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save notes
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep(Math.min(stepPanels.length - 1, curStep + 1))}
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold px-6 h-11"
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="px-5 py-4 border-b border-slate-100 flex-shrink-0">
        <h3 className="font-semibold text-slate-900">{template.name}</h3>
        {template.description && <p className="text-xs text-slate-500 mt-0.5">{template.description}</p>}
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}

        {/* Entry mode toggle — full list vs the focused one-at-a-time flow */}
        <div className="self-start inline-flex items-center gap-1 rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          <button type="button" onClick={() => setMode('list')} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${mode === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            <List className="h-3.5 w-3.5" /> Full list
          </button>
          <button type="button" onClick={() => { setMode('step'); setStep(0) }} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-slate-500 hover:text-slate-700">
            <Layers className="h-3.5 w-3.5" /> One at a time
          </button>
        </div>

        {introComposer}
        {template.questions.map(renderQuestion)}
        {closingComposer}
      </div>

      <div className="flex items-center justify-between gap-2 p-4 border-t border-slate-100 flex-shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePolish}
            disabled={polishing || saving}
            className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Run answers through AI to clean up your dictated notes"
          >
            {polishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {polishing ? 'Polishing…' : 'Polish with AI'}
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={() => {
                if (!confirmingRemove) { setConfirmingRemove(true); return }
                setConfirmingRemove(false)
                onRemove()
              }}
              disabled={saving}
              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors ${
                confirmingRemove
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'text-slate-500 hover:text-red-500 hover:bg-red-50'
              }`}
              title={confirmingRemove ? 'Click again to confirm' : 'Remove this form from the session'}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {confirmingRemove ? 'Click again to permanently remove' : 'Remove'}
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {onCancel && <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" loading={saving} onClick={handleSave}>
            {existing ? 'Save changes' : 'Save report'}
          </Button>
        </div>
      </div>
    </>
  )
}

// Append voice transcript to existing text with a single space separator.
// Empty fields just get the transcript as-is.
function appendSpoken(prev: string, transcript: string): string {
  const trimmed = prev.trimEnd()
  return trimmed ? `${trimmed} ${transcript}` : transcript
}

function BasicQuestionInput({
  type,
  value,
  onChange,
  imageUrls,
  onImagesChange,
  sessionId,
}: {
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'
  value: string
  onChange: (v: string) => void
  imageUrls?: string[]
  onImagesChange?: (urls: string[]) => void
  sessionId?: string
}) {
  // NUMBER + RATING don't get a mic or image uploader — neither makes sense
  // for a single numeric value.
  if (type === 'NUMBER') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    )
  }
  if (type === 'RATING_1_5') {
    const n = parseInt(value, 10) || 0
    return (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(String(i === n ? 0 : i))}
            className="p-1"
            aria-label={`${i} star${i === 1 ? '' : 's'}`}
          >
            <Star className={`h-6 w-6 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />
          </button>
        ))}
      </div>
    )
  }

  // SHORT_TEXT and LONG_TEXT both get the mic + image-upload button stacked
  // to the right of the field, with the gallery rendered below.
  const InputEl = type === 'LONG_TEXT'
    ? (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    )
    : (
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    )

  return (
    <div>
      <div className="flex gap-2 items-start">
        {InputEl}
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <VoiceInput onAppend={t => onChange(appendSpoken(value, t))} />
          {onImagesChange && (
            <ImageUploadButton
              onUploaded={(added) => onImagesChange([...(imageUrls ?? []), ...added])}
              context={{ sessionId }}
            />
          )}
        </div>
      </div>
      {onImagesChange && (
        <ImageGallery
          urls={imageUrls ?? []}
          onChange={onImagesChange}
          className="mt-2"
        />
      )}
    </div>
  )
}

function CustomFieldInput({
  field,
  value,
  onChange,
  imageUrls,
  onImagesChange,
  sessionId,
}: {
  field: LinkedField
  value: string
  onChange: (v: string) => void
  imageUrls?: string[]
  onImagesChange?: (urls: string[]) => void
  sessionId?: string
}) {
  if (field.type === 'NUMBER') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    )
  }
  if (field.type === 'DROPDOWN') {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">Select…</option>
        {field.options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }
  // TEXT-style linked field — mic + upload stacked, gallery below.
  return (
    <div>
      <div className="flex gap-2 items-start">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex flex-col gap-1.5 flex-shrink-0">
          <VoiceInput onAppend={t => onChange(appendSpoken(value, t))} />
          {onImagesChange && (
            <ImageUploadButton
              onUploaded={(added) => onImagesChange([...(imageUrls ?? []), ...added])}
              context={{ sessionId }}
            />
          )}
        </div>
      </div>
      {onImagesChange && (
        <ImageGallery
          urls={imageUrls ?? []}
          onChange={onImagesChange}
          className="mt-2"
        />
      )}
    </div>
  )
}
