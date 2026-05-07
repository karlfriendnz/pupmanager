'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Plus, Trash2, GripVertical, ChevronUp, ChevronDown, Link2 } from 'lucide-react'
import { ImageUploadButton } from '@/components/image-uploader'

export type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5' | 'CUSTOM_FIELD'

export type Question =
  | { id: string; type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'; label: string; required: boolean; isPrivate?: boolean }
  | { id: string; type: 'CUSTOM_FIELD'; customFieldId: string; required: boolean; isPrivate?: boolean }

export interface CustomFieldOption {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  appliesTo: 'OWNER' | 'DOG'
  category: string | null
}

export interface FormRow {
  id: string
  name: string
  description: string | null
  introText: string | null
  closingText: string | null
  backgroundColor: string | null
  backgroundUrl: string | null
  questions: Question[]
  responses: number
  isActive: boolean
}

const TYPE_LABELS: Record<Exclude<QuestionType, 'CUSTOM_FIELD'>, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  NUMBER: 'Number',
  RATING_1_5: 'Rating 1–5',
}

// Note: the standalone SessionFormsManager has been removed — the unified
// FormsManager on /settings?tab=forms is the only entry point now, and editor
// pages live at /forms/session/new and /forms/session/[formId].

// Inline pill that switches a question between public (trainer + client) and
// private (trainer only). Click cycles between the two.
function PrivacyToggle({ isPrivate, onChange }: { isPrivate: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!isPrivate)}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-colors ${
        isPrivate
          ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
          : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
      }`}
      title={isPrivate ? 'Click to make this question visible to clients' : 'Click to keep this question trainer-only'}
    >
      {isPrivate ? '🔒 Private' : '👁 Public'}
    </button>
  )
}

// Page-style session form editor. Save / delete redirect to /settings?tab=forms.
// Renders inside a route page that provides the chrome (back link / heading).
export function SessionFormEditor({
  existing,
  customFields,
}: {
  existing: FormRow | null
  customFields: CustomFieldOption[]
}) {
  const router = useRouter()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Local mirror of isActive so the toggle can update without a refresh
  // round-trip. New (no `existing`) forms default to active.
  const [isActive, setIsActive] = useState(existing?.isActive ?? true)
  const [togglingActive, setTogglingActive] = useState(false)
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [introText, setIntroText] = useState(existing?.introText ?? '')
  const [closingText, setClosingText] = useState(existing?.closingText ?? '')
  const [backgroundColor, setBackgroundColor] = useState(existing?.backgroundColor ?? '')
  const [backgroundUrl, setBackgroundUrl] = useState(existing?.backgroundUrl ?? '')
  const [questions, setQuestions] = useState<Question[]>(
    existing?.questions ?? [{ id: cryptoId(), type: 'LONG_TEXT', label: '', required: false }]
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [linkPickerForId, setLinkPickerForId] = useState<string | null>(null)

  function addStandardQuestion() {
    setQuestions(qs => [...qs, { id: cryptoId(), type: 'LONG_TEXT', label: '', required: false }])
  }

  function addLinkedQuestion(field: CustomFieldOption) {
    setQuestions(qs => [...qs, {
      id: cryptoId(),
      type: 'CUSTOM_FIELD',
      customFieldId: field.id,
      required: false,
    }])
    setLinkPickerForId(null)
  }

  function updateQuestion(id: string, patch: Partial<Question>) {
    setQuestions(qs => qs.map(q => q.id === id ? { ...q, ...patch } as Question : q))
  }

  function removeQuestion(id: string) {
    setQuestions(qs => qs.length > 1 ? qs.filter(q => q.id !== id) : qs)
  }

  function move(id: string, dir: -1 | 1) {
    setQuestions(qs => {
      const idx = qs.findIndex(q => q.id === id)
      const target = idx + dir
      if (idx === -1 || target < 0 || target >= qs.length) return qs
      const next = qs.slice()
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    if (questions.length === 0) { setError('Add at least one question'); return }

    // Validate per-type
    for (const q of questions) {
      if (q.type === 'CUSTOM_FIELD') {
        if (!q.customFieldId) { setError('A linked-field question is missing its field'); return }
      } else if (!q.label.trim()) {
        setError('All questions need a label')
        return
      }
    }

    setSaving(true)
    const url = existing ? `/api/session-forms/${existing.id}` : '/api/session-forms'
    const method = existing ? 'PATCH' : 'POST'
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        introText: introText.trim() || null,
        closingText: closingText.trim() || null,
        backgroundColor: backgroundColor.trim() || null,
        backgroundUrl: backgroundUrl.trim() || null,
        questions: questions.map(q =>
          q.type === 'CUSTOM_FIELD'
            ? { id: q.id, type: q.type, customFieldId: q.customFieldId, required: q.required, isPrivate: !!q.isPrivate }
            : { id: q.id, type: q.type, label: q.label.trim(), required: q.required, isPrivate: !!q.isPrivate }
        ),
        // Use live state so toggling Published then clicking Save preserves it.
        isActive,
      }),
    })
    if (!res.ok) {
      setError('Failed to save')
      setSaving(false)
      return
    }
    router.push('/settings?tab=forms')
    router.refresh()
  }

  async function onToggleActive() {
    if (!existing) return
    setTogglingActive(true)
    try {
      const res = await fetch(`/api/session-forms/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !isActive }),
      })
      if (res.ok) setIsActive(v => !v)
    } finally {
      setTogglingActive(false)
    }
  }

  async function onDelete() {
    if (!existing) return
    const res = await fetch(`/api/session-forms/${existing.id}`, { method: 'DELETE' })
    if (!res.ok) return
    router.push('/settings?tab=forms')
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Action bar — publish toggle (existing forms only). */}
      {existing && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleActive}
            disabled={togglingActive}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-100 disabled:opacity-50"
            title={isActive ? 'Unpublish' : 'Publish'}
          >
            <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-amber-400'}`} />
            <span className={isActive ? 'text-green-700' : 'text-amber-700'}>
              {isActive ? 'Published' : 'Draft'}
            </span>
          </button>
          <span className="text-xs text-slate-400">Click to {isActive ? 'unpublish' : 'publish'}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl flex flex-col">
        <div className="p-5 flex flex-col gap-4">
          {error && <Alert variant="error">{error}</Alert>}

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Form name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. First session report"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Description (optional)</label>
            <p className="text-[11px] text-slate-400 mb-1.5">Internal — shown to you when picking the form. Not seen by the client.</p>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Welcome / intro text (optional)</label>
            <p className="text-[11px] text-slate-400 mb-1.5">Shown to the client at the top of the report.</p>
            <textarea
              value={introText}
              onChange={e => setIntroText(e.target.value)}
              rows={3}
              placeholder="e.g. Thanks for our session today, Sarah! Here&rsquo;s a summary of what we covered…"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Closing text (optional)</label>
            <p className="text-[11px] text-slate-400 mb-1.5">Shown to the client at the bottom of the report.</p>
            <textarea
              value={closingText}
              onChange={e => setClosingText(e.target.value)}
              rows={3}
              placeholder="e.g. See you next time! Reach out anytime if questions come up."
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Report background — colour wins when both blank, image takes
              priority on the report when set. Trainer can either upload an
              image (uses the same /api/upload/image route as session photos)
              or paste a URL of their own. */}
          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1.5">Report background (optional)</label>
            <p className="text-[11px] text-slate-400 mb-1.5">Shown across the client-facing report. Image overrides colour when both are set.</p>
            <div className="flex gap-2 items-center">
              <input
                type="color"
                value={backgroundColor || '#ffffff'}
                onChange={e => setBackgroundColor(e.target.value)}
                aria-label="Background colour"
                className="h-10 w-12 rounded-lg border border-slate-200 cursor-pointer"
              />
              <input
                type="text"
                value={backgroundColor}
                onChange={e => setBackgroundColor(e.target.value)}
                placeholder="#fef3c7 or blank"
                className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="url"
                value={backgroundUrl}
                onChange={e => setBackgroundUrl(e.target.value)}
                placeholder="https://… or upload"
                className="h-10 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <ImageUploadButton
                onUploaded={(urls) => urls[0] && setBackgroundUrl(urls[0])}
              />
            </div>
            {backgroundUrl && (
              <div className="mt-2 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={backgroundUrl}
                  alt=""
                  className="h-16 w-24 rounded-lg object-cover border border-slate-200"
                />
                <button
                  type="button"
                  onClick={() => setBackgroundUrl('')}
                  className="text-xs font-medium text-slate-500 hover:text-red-500"
                >
                  Remove image
                </button>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-slate-700">Questions</label>
              <div className="flex items-center gap-2">
                <button
                  onClick={addStandardQuestion}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Add question
                </button>
                <button
                  onClick={() => setLinkPickerForId('__new__')}
                  disabled={customFields.length === 0}
                  className="text-xs font-medium text-blue-600 hover:text-blue-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                  title={customFields.length === 0 ? 'No custom fields defined' : 'Add a question linked to a client field'}
                >
                  <Link2 className="h-3 w-3" /> Link client field
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {questions.map((q, idx) => {
                const linked = q.type === 'CUSTOM_FIELD'
                  ? customFields.find(f => f.id === q.customFieldId)
                  : undefined
                return (
                  <div key={q.id} className={`flex gap-2 items-start p-3 rounded-xl ${linked ? 'bg-emerald-50' : 'bg-slate-50'}`}>
                    <div className="flex flex-col items-center gap-0.5 mt-1.5 text-slate-300 flex-shrink-0">
                      <button onClick={() => move(q.id, -1)} disabled={idx === 0} className="hover:text-blue-600 disabled:opacity-30">
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <GripVertical className="h-3.5 w-3.5" />
                      <button onClick={() => move(q.id, 1)} disabled={idx === questions.length - 1} className="hover:text-blue-600 disabled:opacity-30">
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex-1 flex flex-col gap-2">
                      {q.type === 'CUSTOM_FIELD' ? (
                        <>
                          <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
                            <Link2 className="h-3.5 w-3.5 text-emerald-600 flex-shrink-0" />
                            <span className="truncate">{linked?.label ?? 'Unknown field'}</span>
                          </div>
                          <p className="text-[11px] text-emerald-700">
                            Linked to {linked?.appliesTo === 'DOG' ? 'dog' : 'client'} field
                            {linked?.category ? ` · ${linked.category}` : ''}
                            . Filling syncs to the client&apos;s record.
                          </p>
                          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={q.required}
                              onChange={e => updateQuestion(q.id, { required: e.target.checked })}
                              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            Required
                          </label>
                          <PrivacyToggle
                            isPrivate={!!q.isPrivate}
                            onChange={v => updateQuestion(q.id, { isPrivate: v })}
                          />
                        </>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={q.label}
                            onChange={e => updateQuestion(q.id, { label: e.target.value })}
                            placeholder="Question text"
                            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <div className="flex items-center gap-2 flex-wrap">
                            <select
                              value={q.type}
                              onChange={e => updateQuestion(q.id, { type: e.target.value as Exclude<QuestionType, 'CUSTOM_FIELD'> })}
                              className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map(t => (
                                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                              ))}
                            </select>
                            <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={q.required}
                                onChange={e => updateQuestion(q.id, { required: e.target.checked })}
                                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              Required
                            </label>
                            <PrivacyToggle
                              isPrivate={!!q.isPrivate}
                              onChange={v => updateQuestion(q.id, { isPrivate: v })}
                            />
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      onClick={() => removeQuestion(q.id)}
                      disabled={questions.length === 1}
                      className="p-1 text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                      aria-label="Remove question"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 p-5 border-t border-slate-100 flex-shrink-0 bg-white">
          {existing && onDelete && (
            confirmDelete ? (
              <div className="flex items-center gap-1 mr-auto">
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    setDeleting(true)
                    try { await onDelete() } finally { setDeleting(false) }
                  }}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting…' : 'Confirm delete'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="mr-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            )
          )}
          <Button variant="ghost" size="sm" onClick={() => router.push('/settings?tab=forms')}>Cancel</Button>
          <Button size="sm" loading={saving} onClick={handleSave}>
            {existing ? 'Save changes' : 'Create form'}
          </Button>
        </div>
      </div>

      {linkPickerForId && (
        <CustomFieldPicker
          customFields={customFields}
          onPick={addLinkedQuestion}
          onClose={() => setLinkPickerForId(null)}
        />
      )}
    </div>
  )
}

function CustomFieldPicker({
  customFields,
  onPick,
  onClose,
}: {
  customFields: CustomFieldOption[]
  onPick: (f: CustomFieldOption) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-[61] bg-white rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-100 flex-shrink-0">
          <h3 className="font-semibold text-slate-900">Link a client field</h3>
          <p className="text-xs text-slate-500 mt-0.5">Filling this question will update the client&apos;s record.</p>
        </div>
        <div className="overflow-y-auto p-2">
          {customFields.map(f => (
            <button
              key={f.id}
              onClick={() => onPick(f)}
              className="w-full text-left p-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <p className="text-sm font-medium text-slate-900">{f.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {f.appliesTo === 'DOG' ? '🐕 Dog' : '👤 Client'} · {f.type.toLowerCase()}
                {f.category ? ` · ${f.category}` : ''}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function cryptoId(): string {
  return Math.random().toString(36).slice(2, 10)
}
