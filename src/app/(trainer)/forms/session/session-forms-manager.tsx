'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Alert } from '@/components/ui/alert'
import { Plus, Pencil, Trash2, X, FileText, GripVertical, ChevronUp, ChevronDown, Link2 } from 'lucide-react'

export type QuestionType = 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5' | 'CUSTOM_FIELD'

export type Question =
  | { id: string; type: 'SHORT_TEXT' | 'LONG_TEXT' | 'NUMBER' | 'RATING_1_5'; label: string; required: boolean }
  | { id: string; type: 'CUSTOM_FIELD'; customFieldId: string; required: boolean }

interface CustomFieldOption {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  appliesTo: 'OWNER' | 'DOG'
  category: string | null
}

interface FormRow {
  id: string
  name: string
  description: string | null
  introText: string | null
  closingText: string | null
  questions: Question[]
  responses: number
}

const TYPE_LABELS: Record<Exclude<QuestionType, 'CUSTOM_FIELD'>, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  NUMBER: 'Number',
  RATING_1_5: 'Rating 1–5',
}

export function SessionFormsManager({
  initialForms,
  customFields,
}: {
  initialForms: FormRow[]
  customFields: CustomFieldOption[]
}) {
  const [forms, setForms] = useState(initialForms)
  const [editing, setEditing] = useState<FormRow | null>(null)
  const [creating, setCreating] = useState(false)

  function upsert(f: FormRow, isNew: boolean) {
    setForms(prev => isNew ? [...prev, f] : prev.map(x => x.id === f.id ? f : x))
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this form? Existing responses on past sessions stay attached but you cannot edit them.')) return
    const res = await fetch(`/api/session-forms/${id}`, { method: 'DELETE' })
    if (res.ok) setForms(prev => prev.filter(f => f.id !== id))
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          Templates trainers can attach to a session to capture a structured report.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New form
        </Button>
      </div>

      {forms.length === 0 ? (
        <Card>
          <CardBody className="py-12 text-center text-slate-400">
            <FileText className="h-10 w-10 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No session forms yet. Create one to start filling in reports.</p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {forms.map(f => (
            <Card key={f.id} className="hover:border-blue-100 transition-colors">
              <CardBody className="py-4">
                <div className="flex items-start gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 flex-shrink-0">
                    <FileText className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900">{f.name}</p>
                    {f.description && <p className="text-sm text-slate-500 mt-0.5">{f.description}</p>}
                    <div className="flex items-center gap-3 text-xs text-slate-400 mt-1.5 flex-wrap">
                      <span>{f.questions.length} question{f.questions.length === 1 ? '' : 's'}</span>
                      {f.responses > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-blue-600">{f.responses} filled</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => setEditing(f)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(f.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <FormEditorModal
          existing={editing}
          customFields={customFields}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={(f, isNew) => { upsert(f, isNew); setCreating(false); setEditing(null) }}
        />
      )}
    </>
  )
}

function FormEditorModal({
  existing,
  customFields,
  onClose,
  onSaved,
}: {
  existing: FormRow | null
  customFields: CustomFieldOption[]
  onClose: () => void
  onSaved: (f: FormRow, isNew: boolean) => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [introText, setIntroText] = useState(existing?.introText ?? '')
  const [closingText, setClosingText] = useState(existing?.closingText ?? '')
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
        questions: questions.map(q =>
          q.type === 'CUSTOM_FIELD'
            ? { id: q.id, type: q.type, customFieldId: q.customFieldId, required: q.required }
            : { id: q.id, type: q.type, label: q.label.trim(), required: q.required }
        ),
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
      name: saved.name,
      description: saved.description,
      introText: saved.introText ?? null,
      closingText: saved.closingText ?? null,
      questions: saved.questions,
      responses: existing?.responses ?? 0,
    }, !existing)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
      <div className="relative z-50 bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-semibold text-slate-900">{existing ? 'Edit form' : 'New session form'}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
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

        <div className="flex justify-end gap-2 p-5 border-t border-slate-100 flex-shrink-0 bg-white">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
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
