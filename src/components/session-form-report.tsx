'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { richTextToPlain } from '@/lib/rich-text'
import { isSessionDone } from '@/lib/report-visibility'
import { Button } from '@/components/ui/button'
import { Plus, Loader2, FileText, Pencil, Trash2, Star, Link2, X, Sparkles, Check, Lock, List, Layers, ChevronLeft, ChevronRight, ChevronDown, Send } from 'lucide-react'
import { VoiceInput } from '@/components/voice-input'
import { ImageUploadButton, ImageGallery } from '@/components/image-uploader'
import { HomeworkFlow } from '@/components/homework-flow'

export type Question =
  | { id: string; type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'; label: string; required: boolean; isPrivate?: boolean }
  | { id: string; type: 'DROPDOWN' | 'RADIO' | 'CHECKBOX'; label: string; required: boolean; isPrivate?: boolean; options: string[] }
  | { id: string; type: 'CUSTOM_FIELD'; customFieldId: string; required: boolean; isPrivate?: boolean }

// Checkbox answers hold multiple values, stored as a JSON array string. Single
// choices (dropdown / multiple choice) store the chosen option verbatim.
function parseChecks(value: string): string[] {
  if (!value) return []
  try {
    const arr = JSON.parse(value)
    return Array.isArray(arr) ? arr.map(String) : []
  } catch {
    return [value]
  }
}
function serializeChecks(list: string[]): string {
  return list.length ? JSON.stringify(list) : ''
}

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
      {!hideLabel && (
        <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
      )}
      <div className="relative rounded-2xl bg-slate-50 border border-transparent focus-within:border-accent focus-within:bg-white focus-within:ring-4 focus-within:ring-accent-soft transition-all">
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
  /** When the client was TOLD about this recap. Null means they never were. */
  sentAt?: string | null
  /**
   * Whether the client can read this write-up right now. Computed on the server
   * (lib/report-visibility) because it turns on the SESSION's status, which this
   * component never loads — completing a session publishes its notes, so a
   * `sentAt` of null no longer means "private".
   */
  visibleToClient?: boolean
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
  sessionStatus,
  layout = 'modal',
  autoPromptIfEmpty = false,
  afterClosing,
}: {
  sessionId: string
  /**
   * The session's own status, passed down from the server page. Completing a
   * session publishes its write-up, so this is what decides whether the client
   * can read it — and it has to arrive as a PROP, not from our own fetch: Mark
   * complete calls router.refresh(), which re-renders the server page but does
   * nothing to state a client component fetched on mount. Without this the card
   * still read "Draft" after the trainer had just marked the session complete.
   */
  sessionStatus?: string
  layout?: 'modal' | 'inline'
  autoPromptIfEmpty?: boolean
  /**
   * Rendered inside the editor, directly under the closing message (Karl:
   * "put homework at the bottom of the notes under closing message").
   *
   * It arrives as a slot rather than being built in here because homework is
   * the PAGE's business — it needs the client and the session date, which this
   * component has no reason to know. What it does know is where the writing
   * ends, which is the only thing being asked of it.
   */
  afterClosing?: ReactNode
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
    // Inline states carry their own row padding — the caller wraps this in a
    // bare FlatBlock, so anything without it sits flush against the border.
    if (!loaded) {
      return (
        <div className="flex items-center gap-2 px-4 py-3.5 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      )
    }

    // No templates exist anywhere — surface a one-time setup nudge.
    if ((templates?.length ?? 0) === 0) {
      return (
        <p className="px-4 py-3.5 text-sm text-slate-500">
          No session forms yet. Create one in <a href="/settings?tab=forms" className="text-accent hover:underline">Settings → Forms</a>.
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
      // An EMPTY write-up opens straight on the questions — there is nothing to
      // preview, and a preview of nothing behind an Edit button is a tap that
      // exists only because this component can also summarise (Karl, on the
      // calendar popover: "it should load the notes list view so you can start
      // filling in the notes there and then").
      //
      // Once something IS written, the preview is right: you come back to READ
      // it far more often than to change it, and Edit is one tap away.
      const nothingWritten =
        template.questions.every(q => !r.answers[q.id]) &&
        !r.introMessage && !r.closingMessage
      if (!editing && nothingWritten && autoPromptIfEmpty) {
        return (
          <FormFillerBody
            sessionId={sessionId}
            template={template}
            existing={r}
            linked={linked}
            onSaved={handleSaved}
            onCancel={() => setEditing(null)}
            onRemove={() => handleDelete(r.formId)}
            afterClosing={afterClosing}
            key={r.formId}
          />
        )
      }

      // Default to a read-only PREVIEW with an Edit button. Editing reveals the
      // filler; saving (handleSaved sets editing=null) or cancelling returns
      // to the preview.
      if (!editing) {
        return (
          <InlineNotesPreview
            response={r}
            sessionStatus={sessionStatus}
            template={template}
            linkedFieldMap={linkedFieldMap}
            onEdit={() => setEditing({ template, existing: r })}
            onSent={() => setResponses(prev =>
              (prev ?? []).map(x => (x.id === r.id ? { ...x, sentAt: new Date().toISOString(), visibleToClient: true } : x)),
            )}
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
          afterClosing={afterClosing}
          key={r.formId}
        />
      )
    }

    // No form yet — offer a dropdown to pick one. Selecting attaches it
    // immediately by writing an empty response, which then re-renders into
    // the always-editable form view above.
    // One row, like every other empty section on the page — the FlatBlock the
    // caller wraps this in supplies the border, so no padding of our own.
    return (
      <>
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
        {/* Homework survives having no form attached. It rides inside the
            write-up when there IS one (under the closing message, per Karl),
            and a session where the trainer hasn't picked a form yet still has
            homework to set — losing it with the form would be a feature that
            works only sometimes.

            It carries its own padding HERE and not in the editor: there the
            body is already `p-5`, and here it is a bare child of the card, so
            without this the heading sat hard against the border (Karl: "looks
            nasty — there is no padding"). */}
        {afterClosing && <div className="px-5 pb-5">{afterClosing}</div>}
      </>
    )
  }

  // A session holds at most one form. Once attached, the Attach button hides;
  // removing the form (via the filler footer) reveals it again.
  const canAttach = loaded && (templates?.length ?? 0) > 0 && (responses?.length ?? 0) === 0

  return (
    <div>
      {/* No "Session report" heading (Karl: "I don't think we need the
          'Report' title, just takes up space"). The screen is called Session
          notes, this is the only thing on it, and a label repeating that
          spent a row saying where you already are. The row only exists at all
          when there is a form to attach. */}
      {canAttach && (
        <div className="mb-3 flex items-center justify-end">
          <button
            onClick={() => setPickerOpen(true)}
            className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200"
          >
            <Plus className="h-3 w-3" /> Attach form
          </button>
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (templates?.length ?? 0) === 0 ? (
        <p className="text-sm text-slate-400">
          No session forms yet. Create one in <a href="/settings?tab=forms" className="text-accent hover:underline">Settings → Forms</a>.
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
                      className="p-1 text-slate-400 hover:text-accent hover:bg-accent-soft rounded disabled:opacity-40"
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
            afterClosing={afterClosing}
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
  sessionStatus,
  template,
  linkedFieldMap,
  onEdit,
  onSent,
}: {
  response: FormResponse
  sessionStatus?: string
  template: FormTemplate
  linkedFieldMap: Map<string, { label: string; type?: 'TEXT' | 'NUMBER' | 'DROPDOWN' }>
  onEdit: () => void
  onSent: () => void
}) {
  const filled = template.questions.filter(q => response.answers[q.id])
  // Can the client read this? Two sources, and the live one wins: the session's
  // current status (which router.refresh() keeps fresh after Mark complete), or
  // what the server said when this response was last fetched or saved.
  const visible = isSessionDone(sessionStatus) || (response.visibleToClient ?? !!response.sentAt)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  // The early release: show it to the client NOW, on a session that hasn't been
  // marked complete. Once the session is complete this button is gone, because
  // there is nothing left for it to do.
  async function send() {
    if (sending || visible) return
    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/sessions/bulk-send-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseIds: [response.id] }),
      })
      if (!res.ok) { setSendError('Could not send it.'); return }
      onSent()
    } catch {
      setSendError('Could not send it.')
    } finally {
      setSending(false)
    }
  }
  return (
    <div>
      {/* Header strip — the STATE of the write-up and the way into it, and
          nothing else (Karl: "I don't think we need the 'Report' title, just
          takes up space"). The form's name told the trainer what they already
          knew they were looking at, and it arrived wearing a dark rounded icon
          tile and a gradient, which is the clearest tell of a machine-made
          screen (AGENTS.md). What's left is the one line worth a row: whether
          the client can read this yet. */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
        <p className="min-w-0 flex-1 truncate text-[13px] leading-tight">
          {filled.length === 0
            ? <span className="text-slate-400">Nothing written up yet</span>
            : visible
              ? <span className="text-emerald-600">Your client can read this</span>
              : <span className="font-medium text-amber-600">Draft — mark the session complete to show your client</span>}
        </p>
        <div className="flex flex-shrink-0 items-center gap-2">
          {filled.length > 0 && !visible && (
            <button
              onClick={send}
              disabled={sending}
              title="Show it to your client now, without marking the session complete"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 h-9 rounded-xl bg-accent text-white hover:bg-accent-strong active:scale-95 transition disabled:opacity-60"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
            </button>
          )}
          <button
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 h-9 rounded-xl bg-slate-900 text-white hover:bg-slate-800 active:scale-95 transition shadow-sm"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        </div>
      </div>
      {sendError && <p className="px-5 pt-2 text-xs text-rose-600">{sendError}</p>}

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
  if (type === 'CHECKBOX') {
    const items = parseChecks(value)
    if (items.length === 0) return null
    return (
      <div className="flex flex-wrap gap-1.5 mt-0.5">
        {items.map(item => (
          <span key={item} className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
            <Check className="h-3 w-3 text-emerald-600" />{item}
          </span>
        ))}
      </div>
    )
  }
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
      {/*
        A ROW that opens the platform's own picker.

        It used to be a label plus a 48px bordered field, sitting inside a card
        of its own — so an unstarted write-up cost ~130px, and the browser's
        option list dropped out of that little box as an unbounded white panel
        over the rows beneath it. It read as broken.

        The control here is still a real native <select> — on a phone that means
        the OS wheel/sheet, which is the right answer (AGENTS.md prefers the
        platform, and "full screens, not dropdowns" is about hand-built menus,
        not the system one). It's laid transparently over the row so the row is
        the tap target and the popup anchors to a full-width row instead of
        bursting out of a small field. No portal, no overlay, no second
        scrollbar, and it works before hydration.
      */}
      <div className="relative flex w-full items-center gap-3 px-4 py-3.5">
        <FileText className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-slate-900">
            {attaching ? 'Attaching…' : 'Write up this session'}
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-slate-500">
            Choose a form
          </span>
        </span>
        <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
        <select
          value=""
          onChange={e => handleSelect(e.target.value)}
          disabled={attaching}
          aria-label="Choose a form for this session"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        >
          <option value="" disabled>Choose a form…</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      {error && <p className="px-4 pb-3 text-[13px] text-rose-600">{error}</p>}
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
                {t.description && <p className="text-xs text-slate-500 mt-0.5">{richTextToPlain(t.description)}</p>}
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
  afterClosing,
}: {
  sessionId: string
  template: FormTemplate
  existing: FormResponse | null
  linked: LinkedFieldsBundle
  onSaved: (r: FormResponse) => void
  /** Rendered under the closing message — see SessionFormReport. */
  afterClosing?: ReactNode
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
  const [sendingNow, setSendingNow] = useState(false)
  const [polishing, setPolishing] = useState(false)
  // The two ticks that decide what Save does. Both default OFF: polishing
  // rewrites the trainer's words and sending publishes them to a client, and
  // neither should happen because a box was already ticked when they arrived.
  const [polishFirst, setPolishFirst] = useState(false)
  const [sendToClient, setSendToClient] = useState(false)
  // Entry mode: see every question at once ('list', default) or answer one at
  // a time in a focused fullscreen flow ('step').
  //
  // Step used to be the default — one prompt at a time, swipeable, and pleasant
  // to write into. But it hides the SHAPE of the write-up: a trainer opening a
  // session can't see how many questions there are, which are already answered,
  // or skip to the one they actually want to change. Karl: "we want the full
  // list view of the session report to load by default". Step is still a tap
  // away for anyone who prefers writing one thing at a time.
  const [mode, setMode] = useState<'list' | 'step'>('list')
  const [step, setStep] = useState(0)
  const touchStartX = useRef<number | null>(null)
  // After saving notes in the step flow we slide into an "Add homework" phase so
  // the trainer can attach library tasks to the lesson before leaving. Holds the
  // session's client + date (needed by the library picker) and the saved report
  // to hand back to the host when they finish.
  const [homeworkPhase, setHomeworkPhase] = useState<{ clientId: string | null; date: string } | null>(null)
  const savedResponseRef = useRef<FormResponse | null>(null)

  // The two-tap "click again to confirm" Remove went with the button — the
  // action lives in a sheet you had to open on purpose now, and the host still
  // asks before it deletes anything.

  function setAnswer(id: string, value: string) {
    setAnswers(prev => ({ ...prev, [id]: value }))
  }

  /**
   * Run the answers through the AI and RETURN the merged set.
   *
   * Returning them matters: polish is a tickbox on the save now, so the save
   * happens in the same click — and `setAnswers` doesn't update the `answers`
   * this closure can see. Saving off state here would have posted the
   * unpolished text every time, silently, while the screen showed the tidy
   * version. Null means it failed and the caller should stop.
   */
  async function runPolish(): Promise<Record<string, string> | null> {
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
        return null
      }
      const { polished } = await res.json() as { polished: Record<string, string> }
      // Merge polished text in. Empty values are skipped server-side; merge
      // only what the AI returned so untouched fields are preserved.
      const merged = { ...answers, ...polished }
      setAnswers(merged)
      return merged
    } catch {
      setError('AI polish failed')
      return null
    } finally {
      setPolishing(false)
    }
  }

  // sendNow=false saves a DRAFT (client sees nothing yet). sendNow=true also
  // fires the recap to the client straight away, skipping the Draft notes queue.
  //
  // `polishFirst` runs the AI BEFORE the write, in the same click, and saves
  // what it returned — see runPolish for why the returned value is used rather
  // than state.
  async function handleSave(sendNow = false, polishFirst = false) {
    setError(null)

    let toSave = answers
    if (polishFirst) {
      const polished = await runPolish()
      // Polish failed and said so. Don't save half a decision: the trainer
      // asked for tidy text and would have got their raw dictation.
      if (!polished) return
      toSave = polished
    }

    for (const q of template.questions) {
      if (!q.required) continue
      const val = (toSave[q.id] ?? '').trim()
      if (!val) {
        const label = q.type === 'CUSTOM_FIELD'
          ? linkedFieldMap.get(q.customFieldId)?.label ?? 'Linked field'
          : q.label
        setError(`"${label}" is required`)
        return
      }
    }
    setSaving(true)
    if (sendNow) setSendingNow(true)
    const res = await fetch(`/api/sessions/${sessionId}/form-responses/${template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: toSave,
        imagesByQuestion,
        introMessage: introMessage || null,
        closingMessage: closingMessage || null,
      }),
    })
    if (!res.ok) {
      setError('Failed to save')
      setSaving(false)
      setSendingNow(false)
      return
    }
    const saved = await res.json()
    const response: FormResponse = {
      id: saved.id,
      formId: saved.formId,
      answers: saved.answers as Record<string, string>,
      sentAt: saved.sentAt ?? null,
      // Saving onto a session that is already complete publishes the write-up,
      // so the answer to "can my client read this" can change on a save with
      // nothing else about the session having moved. The server says.
      visibleToClient: saved.visibleToClient ?? false,
      form: { id: template.id, name: template.name, questions: template.questions },
    }

    // Finalise & release straight away: show it to the client now, without
    // waiting on the session being marked complete. The note is already saved,
    // so on failure we keep it as a draft and say so.
    if (sendNow) {
      const sres = await fetch('/api/sessions/bulk-send-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responseIds: [saved.id] }),
      })
      if (!sres.ok) {
        setError('Saved as a draft, but sending failed — you can send it from Draft notes.')
        setSaving(false)
        setSendingNow(false)
        return
      }
      response.sentAt = new Date().toISOString()
      response.visibleToClient = true
    }

    // In the focused step flow, follow the save with an "Add homework" phase
    // (attach library tasks to this lesson) before handing back to the host.
    // Other modes just close out as before.
    if (mode === 'step') {
      savedResponseRef.current = response
      try {
        const meta = await fetch(`/api/schedule/${sessionId}`).then(r => (r.ok ? r.json() : null))
        const date = meta?.scheduledAt ? String(meta.scheduledAt).slice(0, 10) : new Date().toISOString().slice(0, 10)
        setHomeworkPhase({ clientId: meta?.clientId ?? null, date })
      } catch {
        setHomeworkPhase({ clientId: null, date: new Date().toISOString().slice(0, 10) })
      }
      setSaving(false)
      setSendingNow(false)
      return
    }

    onSaved(response)
    setSaving(false)
    setSendingNow(false)
  }

  // Finish the homework phase → hand the saved report back to the host (which
  // closes the filler and shows the saved report).
  function finishHomework() {
    onSaved(savedResponseRef.current ?? {
      id: '', formId: template.id, answers, form: { id: template.id, name: template.name, questions: template.questions },
    })
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
          options={'options' in q ? q.options : undefined}
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
            fill
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
        options={'options' in q ? q.options : undefined}
        imageUrls={imagesByQuestion[q.id] ?? []}
        onImagesChange={(urls) => setImagesByQuestion(prev => ({ ...prev, [q.id]: urls }))}
        sessionId={sessionId}
        fill
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
    // Long-text panels get a wider, page-filling writing column.
    fill?: boolean
    control: React.ReactNode
  }[] = [
    {
      key: 'intro',
      eyebrow: 'Opening',
      title: 'Opening message',
      hint: 'How would you like to start the report? (optional)',
      fill: true,
      control: (
        <ImmersiveText value={introMessage} onChange={setIntroMessage} placeholder="Set the scene…" sessionId={sessionId} autoFocus={false} />
      ),
    },
    ...template.questions.map((q, i) => ({
      key: q.id,
      eyebrow: `Question ${i + 1} of ${questionCount}`,
      title: q.type === 'CUSTOM_FIELD' ? (linkedFieldMap.get(q.customFieldId)?.label ?? 'Linked field') : q.label,
      required: q.required,
      isPrivate: q.isPrivate,
      fill: q.type === 'LONG_TEXT' || (q.type === 'CUSTOM_FIELD' && linkedFieldMap.get(q.customFieldId)?.type === 'TEXT'),
      control: renderControl(q),
    })),
    {
      key: 'closing',
      eyebrow: 'Wrap-up',
      title: 'Closing message',
      hint: 'How would you like to wrap up? (optional)',
      fill: true,
      control: (
        <ImmersiveText value={closingMessage} onChange={setClosingMessage} placeholder="Leave them with a takeaway…" sessionId={sessionId} autoFocus={false} />
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

  // ADD-HOMEWORK PHASE — shown after the notes are saved in the step flow.
  // Lets the trainer attach library tasks to this lesson, then finish.
  if (homeworkPhase) {
    return (
      <HomeworkFlow
        sessionId={sessionId}
        clientId={homeworkPhase.clientId}
        sessionDate={homeworkPhase.date}
        onDone={finishHomework}
      />
    )
  }

  // FULLSCREEN ONE-AT-A-TIME FLOW — focused, fixed-layout, slides between
  // prompts. The heading / input / nav stay in the same place every step; only
  // the sliding track moves.
  if (mode === 'step') {
    const panel = stepPanels[curStep]
    return (
      <div className="fixed inset-0 z-[70] flex flex-col bg-white">
        {/* Top bar — close + switch to full list. Pad the device safe area
            (notch / status bar) so the controls clear the top inset. */}
        <div
          className="flex items-center gap-2 px-3 sm:px-5 min-h-[3.5rem] border-b border-slate-100 flex-shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        >
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
        <div className="pt-5 flex-shrink-0">
          <div className="mx-auto w-full max-w-2xl px-6">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
              <span className="truncate pr-2">{panel.eyebrow}</span>
              <span className="tabular-nums flex-shrink-0">{curStep + 1} / {stepPanels.length}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-accent rounded-full transition-all duration-300 ease-out" style={{ width: `${((curStep + 1) / stepPanels.length) * 100}%` }} />
            </div>
          </div>
        </div>

        {/* Active panel only. We deliberately render a single panel rather than
            a wide sliding track: the track approach mis-rendered because an
            overflowing flex/wide track gets centred in the overflow:hidden
            viewport, bleeding adjacent panels in. Panel values live in parent
            state, so swapping panels never loses input. `key` remounts for a
            light fade-in. */}
        <div className="flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div key={curStep} className="h-full w-full overflow-y-auto pm-step-fade">
            <div className="mx-auto w-full px-6 py-8 sm:py-12 max-w-2xl">
              <div className="min-h-[3.5rem]">
                <h2 className="text-2xl sm:text-[28px] font-bold leading-tight text-slate-900 flex items-start gap-2 flex-wrap">
                  <span>{panel.title}</span>
                  {panel.required && <span className="text-red-500 text-xl leading-none">*</span>}
                  {panel.isPrivate && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 mt-1.5" title="Private — only you can see this, not the client">
                      <Lock className="h-2.5 w-2.5" /> Private
                    </span>
                  )}
                </h2>
                {panel.hint && <p className="text-sm text-slate-400 mt-1.5">{panel.hint}</p>}
              </div>
              <div className="mt-6">{panel.control}</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="flex-shrink-0">
            <div className="mx-auto w-full max-w-2xl px-6 mb-2">
              <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
            </div>
          </div>
        )}

        {/* Fixed footer nav — Back / Next stay put across every step. Pad the
            bottom safe area so the home indicator doesn't overlap the buttons. */}
        <div
          className="border-t border-slate-100 flex-shrink-0 bg-white"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <div className="mx-auto w-full max-w-2xl px-6 py-3.5 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setStep(Math.max(0, curStep - 1))}
              disabled={curStep === 0}
              className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-0"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            {isLastStep ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSave(false)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold px-4 h-11 disabled:opacity-60"
                >
                  {saving && !sendingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save draft
                </button>
                <button
                  type="button"
                  onClick={() => handleSave(true)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-semibold px-5 h-11 disabled:opacity-60"
                >
                  {sendingNow ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Save &amp; send
                </button>
              </div>
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

        {/* Homework, last, because it is the last thing you decide: what they
            take home off the back of what you just wrote. */}
        {afterClosing}
      </div>

      {/* Two decisions, then one button (Karl: "make polish with AI and save
          and send to client checkboxes").

          They were buttons, and that was the problem: three of them —
          Polish, Save changes, Save & send — each did a save-shaped thing, so
          the trainer had to work out which combination they meant. Ticking
          what you want and pressing Save once says the same thing without the
          arithmetic. Polish runs BEFORE the write, in the same click.

          It was briefly `sticky bottom-0` and is not any more (Karl: "the
          sticky can't work on this page sorry"). It could only stick by
          punching a hole in the card that holds it — FlatBlock clips its
          children, and sticky resolves against the nearest clipping ancestor —
          and a bar pinned over a form the trainer is still typing into is
          covering the thing they're looking at on a small screen. */}
      <div className="flex flex-shrink-0 flex-col gap-3 border-t border-slate-100 bg-white p-4">

        <div className="flex flex-col gap-2.5">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={polishFirst}
              onChange={e => setPolishFirst(e.target.checked)}
              disabled={saving || polishing}
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-[var(--pm-brand-600)] focus:ring-[var(--pm-brand-500)]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                {polishing
                  ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                  : <Sparkles className="h-4 w-4 text-slate-500" strokeWidth={1.75} />}
                {polishing ? 'Polishing…' : 'Polish with AI'}
              </span>
              <span className="mt-0.5 block text-[13px] text-slate-500">
                Tidy up what you dictated before it saves
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={sendToClient}
              onChange={e => setSendToClient(e.target.checked)}
              disabled={saving || polishing}
              className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-slate-300 text-[var(--pm-brand-600)] focus:ring-[var(--pm-brand-500)]"
            />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                <Send className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                Send to client
              </span>
              <span className="mt-0.5 block text-[13px] text-slate-500">
                {sendToClient
                  ? 'They will be able to read it as soon as you save'
                  : 'Leave it off to keep this a draft'}
              </span>
            </span>
          </label>
        </div>

        {/* Save, with Cancel and Remove beside it. They were behind a "…"
            for a moment, to make room for a sticky bar that then went; with
            the bar gone there is nothing to make room FOR, and a menu that
            hides three controls on a screen with space for them is a tap
            spent on nothing (Karl: "please put back into the notes"). */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              disabled={saving || polishing}
              className="flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-[13px] font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 sm:mr-auto"
              title="Remove this form from the session"
            >
              <Trash2 className="h-4 w-4 flex-shrink-0" strokeWidth={1.75} />
              Remove
            </button>
          )}
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} className="w-full sm:w-auto">
              Cancel
            </Button>
          )}
          <Button
            loading={saving || polishing}
            disabled={saving || polishing}
            onClick={() => handleSave(sendToClient, polishFirst)}
            className="w-full whitespace-nowrap sm:w-auto"
          >
            {sendToClient ? <Send className="h-4 w-4" /> : null}
            {sendToClient ? 'Save & send' : existing ? 'Save changes' : 'Save draft'}
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

// Full-height, borderless writing surface for the one-at-a-time write-up
// flow. Page-filling and chrome-less so it reads as "writing", not a field.
// The mic + image tools sit quietly underneath.
function ImmersiveText({
  value, onChange, imageUrls, onImagesChange, sessionId, placeholder = 'Start writing…', autoFocus = true,
}: {
  value: string
  onChange: (v: string) => void
  imageUrls?: string[]
  onImagesChange?: (urls: string[]) => void
  sessionId?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  return (
    <div>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="min-h-[55vh] w-full resize-none border-0 bg-transparent p-0 text-lg leading-relaxed text-slate-900 placeholder:text-slate-300 focus:outline-none focus:ring-0"
      />
      <div className="mt-1 flex items-center gap-2">
        <VoiceInput onAppend={t => onChange(appendSpoken(value, t))} />
        {onImagesChange && (
          <ImageUploadButton onUploaded={(added) => onImagesChange([...(imageUrls ?? []), ...added])} context={{ sessionId }} />
        )}
      </div>
      {onImagesChange && <ImageGallery urls={imageUrls ?? []} onChange={onImagesChange} className="mt-2" />}
    </div>
  )
}

function BasicQuestionInput({
  type,
  value,
  onChange,
  options,
  imageUrls,
  onImagesChange,
  sessionId,
  fill,
}: {
  type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5' | 'DROPDOWN' | 'RADIO' | 'CHECKBOX'
  value: string
  onChange: (v: string) => void
  // Option list for the choice types (dropdown / multiple choice / checkboxes).
  options?: string[]
  imageUrls?: string[]
  onImagesChange?: (urls: string[]) => void
  sessionId?: string
  // `fill` = the one-at-a-time write-up flow: render long text as a big,
  // borderless, page-filling writing area rather than a boxed textarea.
  fill?: boolean
}) {
  if (type === 'DROPDOWN') {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">Select…</option>
        {(options ?? []).map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }
  if (type === 'RADIO') {
    return (
      <div className="flex flex-col gap-2">
        {(options ?? []).map(opt => (
          <label key={opt} className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
            <input
              type="radio"
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="h-4 w-4 border-slate-300 text-accent focus:ring-accent"
            />
            {opt}
          </label>
        ))}
      </div>
    )
  }
  if (type === 'CHECKBOX') {
    const selected = parseChecks(value)
    return (
      <div className="flex flex-col gap-2">
        {(options ?? []).map(opt => {
          const checked = selected.includes(opt)
          return (
            <label key={opt} className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-accent has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(serializeChecks(
                  checked ? selected.filter(o => o !== opt) : [...selected, opt]
                ))}
                className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
              />
              {opt}
            </label>
          )
        })}
      </div>
    )
  }
  if (type === 'LONG_TEXT' && fill) {
    return <ImmersiveText value={value} onChange={onChange} imageUrls={imageUrls} onImagesChange={onImagesChange} sessionId={sessionId} />
  }
  // NUMBER + RATING don't get a mic or image uploader — neither makes sense
  // for a single numeric value.
  if (type === 'NUMBER') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
        className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    )
    : (
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
  fill,
}: {
  field: LinkedField
  value: string
  onChange: (v: string) => void
  imageUrls?: string[]
  onImagesChange?: (urls: string[]) => void
  sessionId?: string
  fill?: boolean
}) {
  if (field.type === 'NUMBER') {
    return (
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    )
  }
  if (field.type === 'DROPDOWN') {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      >
        <option value="">Select…</option>
        {field.options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    )
  }
  // TEXT-style linked field — immersive in the one-at-a-time flow, else a
  // standard boxed textarea (mic + upload stacked, gallery below).
  if (fill) {
    return <ImmersiveText value={value} onChange={onChange} imageUrls={imageUrls} onImagesChange={onImagesChange} sessionId={sessionId} />
  }
  return (
    <div>
      <div className="flex gap-2 items-start">
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={3}
          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
