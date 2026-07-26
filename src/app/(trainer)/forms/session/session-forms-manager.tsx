'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, GripVertical, Link2, X } from 'lucide-react'
import { ImageUploadButton } from '@/components/image-uploader'
import { ModalPortal } from '@/components/shared/modal-portal'
import { RichTextEditor } from '@/components/shared/rich-text-editor'
import { isRichTextEmpty } from '@/lib/rich-text'
import {
  FORM_INPUT, FORM_QUIET_ACTION, FORM_TEXTAREA,
  FormEditorSection, FormEditorShell, FormField,
} from '../_form-editor-shell'

// The question model + its pure helpers live in @/lib/session-form-builder
// (unit-tested there). Re-exported here so existing importers keep working.
export {
  isChoiceType,
  type ChoiceType,
  type CustomFieldOption,
  type Question,
  type QuestionType,
} from '@/lib/session-form-builder'
import {
  NEW_QUESTION_TYPES, TYPE_LABELS,
  addQuestion, createCustomFieldQuestion, createQuestion, hasOptions,
  newQuestionId, removeQuestion as removeQuestionFrom, reorderQuestions,
  serializeQuestions, updateQuestion, usedCustomFieldIds, validateForm,
} from '@/lib/session-form-builder'
import type { CustomFieldOption, Question, QuestionType } from '@/lib/session-form-builder'

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

// Note: the standalone SessionFormsManager has been removed — the unified
// FormsManager on /settings?tab=forms is the only entry point now, and editor
// pages live at /forms/session/new and /forms/session/[formId]. Both wear the
// same FormEditorShell as the lead-capture editor, so a trainer learns one
// screen no matter which kind of form they're building.

// ─── Options editor ──────────────────────────────────────────────────────────

// Editor for a choice question's option list. Each option is a text input with a
// remove button; an "Add option" link appends a blank.
function OptionsEditor({
  options,
  onChange,
}: {
  options: string[]
  onChange: (opts: string[]) => void
}) {
  return (
    <div className="mt-0.5 flex flex-col gap-1.5">
      {options.map((opt, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <span className="w-4 flex-shrink-0 text-center text-xs text-slate-300">{i + 1}.</span>
          <input
            type="text"
            value={opt}
            onChange={e => {
              const next = options.slice()
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder={`Option ${i + 1}`}
            aria-label={`Option ${i + 1}`}
            className="h-9 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
          />
          <button
            type="button"
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
            disabled={options.length <= 1}
            className="flex-shrink-0 p-1 text-slate-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
            aria-label={`Remove option ${i + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...options, ''])}
        className="self-start pl-5 text-xs font-medium text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
      >
        Add option
      </button>
    </div>
  )
}

// ─── One question ────────────────────────────────────────────────────────────

function QuestionCard({
  question,
  index,
  total,
  customFields,
  onPatch,
  onRemove,
}: {
  question: Question
  index: number
  total: number
  customFields: CustomFieldOption[]
  onPatch: (patch: Parameters<typeof updateQuestion>[2]) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  const linked = question.type === 'CUSTOM_FIELD'
    ? customFields.find(f => f.id === question.customFieldId)
    : undefined

  return (
    <div ref={setNodeRef} style={style} data-question-row className="flex gap-2 bg-white p-3">
      <button
        type="button"
        aria-label={`Reorder question ${index + 1} of ${total}`}
        {...attributes}
        {...listeners}
        className="mt-1.5 flex-shrink-0 cursor-grab text-slate-300 hover:text-slate-500"
      >
        <GripVertical className="h-4 w-4" strokeWidth={1.75} />
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {question.type === 'CUSTOM_FIELD' ? (
          <>
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
              <Link2 className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" strokeWidth={1.75} />
              <span className="truncate">{linked?.label ?? 'Unknown field'}</span>
            </div>
            <p className="text-xs text-slate-400">
              Linked to a {linked?.appliesTo === 'DOG' ? 'dog' : 'client'} field
              {linked?.category ? ` · ${linked.category}` : ''}. Filling it in syncs to their record.
            </p>
          </>
        ) : (
          <>
            <input
              type="text"
              value={question.label}
              onChange={e => onPatch({ label: e.target.value })}
              placeholder="Question text"
              aria-label={`Question ${index + 1}`}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
            <select
              value={question.type}
              onChange={e => onPatch({ type: e.target.value as Exclude<QuestionType, 'CUSTOM_FIELD'> })}
              aria-label={`Answer type for question ${index + 1}`}
              className="h-9 w-fit rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            >
              {NEW_QUESTION_TYPES.map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            {hasOptions(question) && (
              <OptionsEditor
                options={question.options ?? []}
                onChange={opts => onPatch({ options: opts })}
              />
            )}
          </>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={question.required}
              onChange={e => onPatch({ required: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
            />
            Required
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={!!question.isPrivate}
              onChange={e => onPatch({ isPrivate: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
            />
            Staff only
          </label>
        </div>
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={total === 1}
        className="flex-shrink-0 p-1 text-slate-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label={`Remove question ${index + 1}`}
      >
        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}

// ─── The editor ──────────────────────────────────────────────────────────────

// Page-style session form editor — same shell as the lead-capture editor.
// Save / delete redirect to /settings?tab=forms. Renders inside a route page
// that provides the chrome (back link / heading).
export function SessionFormEditor({
  existing,
  customFields,
}: {
  existing: FormRow | null
  customFields: CustomFieldOption[]
}) {
  const router = useRouter()
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
    existing?.questions ?? [createQuestion('LONG_TEXT', newQuestionId())]
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const used = usedCustomFieldIds(questions)

  function addStandardQuestion() {
    setQuestions(qs => addQuestion(qs, createQuestion('LONG_TEXT', newQuestionId())))
  }

  function addLinkedQuestion(field: CustomFieldOption) {
    setQuestions(qs => addQuestion(qs, createCustomFieldQuestion(field.id, newQuestionId())))
    setPickerOpen(false)
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setQuestions(qs => reorderQuestions(qs, String(active.id), String(over.id)))
  }

  async function handleSave() {
    const problem = validateForm(name, questions)
    if (problem) { setError(problem); return }
    setError(null)
    setSaving(true)

    const url = existing ? `/api/session-forms/${existing.id}` : '/api/session-forms'
    const res = await fetch(url, {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        description: description.trim() || null,
        introText: introText.trim() || null,
        closingText: closingText.trim() || null,
        backgroundColor: backgroundColor.trim() || null,
        backgroundUrl: backgroundUrl.trim() || null,
        questions: serializeQuestions(questions),
        // Use live state so toggling Published then clicking Save preserves it.
        isActive,
      }),
    })
    if (!res.ok) {
      setError('Could not save the form. Please try again.')
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
    <>
      <FormEditorShell
        status={existing ? { isActive, busy: togglingActive, onToggle: onToggleActive } : undefined}
        error={error}
        onDelete={existing ? onDelete : undefined}
        onCancel={() => router.push('/settings?tab=forms')}
        onSave={handleSave}
        saving={saving}
        saveLabel={existing ? 'Save changes' : 'Create form'}
      >
        <FormEditorSection title="Basics">
          <FormField label="Form name" required>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(null) }}
              placeholder="e.g. First session report"
              aria-label="Form name"
              className={FORM_INPUT}
            />
          </FormField>
          <FormField
            label="Description"
            hint="Optional — internal. Shown to you when picking the form, never to the client."
          >
            <RichTextEditor
              value={description}
              onChange={html => setDescription(isRichTextEmpty(html) ? '' : html)}
              minHeight={120}
              theme="light"
            />
          </FormField>
        </FormEditorSection>

        <FormEditorSection
          title="Questions"
          hint="Drag a question by its handle to reorder it."
          action={
            <>
              <button type="button" onClick={addStandardQuestion} className={FORM_QUIET_ACTION}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                Add question
              </button>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={customFields.length === 0}
                className={FORM_QUIET_ACTION}
                title={customFields.length === 0 ? 'No client fields defined yet' : 'Ask one of your client fields'}
              >
                <Link2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                Link a field
              </button>
            </>
          }
        >
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 [&>*+*]:border-t [&>*+*]:border-slate-200">
                {questions.map((q, i) => (
                  <QuestionCard
                    key={q.id}
                    question={q}
                    index={i}
                    total={questions.length}
                    customFields={customFields}
                    onPatch={patch => setQuestions(qs => updateQuestion(qs, q.id, patch))}
                    onRemove={() => setQuestions(qs => qs.length > 1 ? removeQuestionFrom(qs, q.id) : qs)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </FormEditorSection>

        <FormEditorSection title="What the client sees" hint="Both optional — top and tail of their report.">
          <FormField label="Welcome / intro text">
            <textarea
              value={introText}
              onChange={e => setIntroText(e.target.value)}
              rows={3}
              placeholder="e.g. Thanks for our session today, Sarah! Here's a summary of what we covered…"
              aria-label="Welcome / intro text"
              className={FORM_TEXTAREA}
            />
          </FormField>
          <FormField label="Closing text">
            <textarea
              value={closingText}
              onChange={e => setClosingText(e.target.value)}
              rows={3}
              placeholder="e.g. See you next time! Reach out anytime if questions come up."
              aria-label="Closing text"
              className={FORM_TEXTAREA}
            />
          </FormField>
        </FormEditorSection>

        {/* Report background — colour wins when both blank, image takes
            priority on the report when set. The trainer can upload (same
            /api/upload/image route as session photos) or paste a URL. */}
        <FormEditorSection
          title="Report background"
          hint="Optional. Shown across the client-facing report — an image overrides the colour."
        >
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="color"
              value={backgroundColor || '#ffffff'}
              onChange={e => setBackgroundColor(e.target.value)}
              aria-label="Background colour"
              className="h-10 w-12 cursor-pointer rounded-lg border border-slate-200"
            />
            <input
              type="text"
              value={backgroundColor}
              onChange={e => setBackgroundColor(e.target.value)}
              placeholder="#fef3c7 or blank"
              aria-label="Background colour hex"
              className="h-10 w-28 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
            <input
              type="url"
              value={backgroundUrl}
              onChange={e => setBackgroundUrl(e.target.value)}
              placeholder="https://… or upload"
              aria-label="Background image URL"
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
            <ImageUploadButton onUploaded={urls => urls[0] && setBackgroundUrl(urls[0])} />
          </div>
          {backgroundUrl && (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={backgroundUrl}
                alt=""
                className="h-16 w-24 rounded-lg border border-slate-200 object-cover"
              />
              <button
                type="button"
                onClick={() => setBackgroundUrl('')}
                className="text-xs font-medium text-slate-500 underline-offset-2 hover:text-red-500 hover:underline"
              >
                Remove image
              </button>
            </div>
          )}
        </FormEditorSection>
      </FormEditorShell>

      {pickerOpen && (
        <CustomFieldPicker
          customFields={customFields}
          used={used}
          onPick={addLinkedQuestion}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </>
  )
}

// ─── Link-a-field picker ─────────────────────────────────────────────────────

// A full screen, not a dropdown — there can be dozens of fields, and each row
// needs room to say what it is. Portaled to <body> (the header's backdrop-blur
// would otherwise become the containing block for `fixed`), and it locks body
// scroll so there's never a second scrollbar behind it.
function CustomFieldPicker({
  customFields,
  used,
  onPick,
  onClose,
}: {
  customFields: CustomFieldOption[]
  used: Set<string>
  onPick: (f: CustomFieldOption) => void
  onClose: () => void
}) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[70] flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Link a client field">
        <div className="flex flex-shrink-0 items-start gap-3 border-b border-slate-200 px-4 py-3.5">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900">Link a client field</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Answering the question updates the client&apos;s record too, so you only type it once.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 flex-shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          {customFields.length === 0 ? (
            <p className="text-sm text-slate-400">
              No client fields yet — add them on the Fields tab and they&apos;ll show up here.
            </p>
          ) : (
            <div className="mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-200 [&>*+*]:border-t [&>*+*]:border-slate-200">
              {customFields.map(f => {
                const already = used.has(f.id)
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={already}
                    onClick={() => onPick(f)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 disabled:opacity-50"
                  >
                    <Link2 className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{f.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">
                        {f.appliesTo === 'DOG' ? 'Dog' : 'Client'} · {f.type.toLowerCase()}
                        {f.category ? ` · ${f.category}` : ''}
                      </span>
                    </span>
                    {already && (
                      <span className="flex-shrink-0 text-xs font-medium text-slate-400">Added</span>
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  )
}
