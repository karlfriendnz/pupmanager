'use client'

import { useEffect, useState } from 'react'
import {
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core'
import { DndArea } from '@/components/shared/dnd-area'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus, Trash2, GripVertical, Link2, X, Copy, UserSquare } from 'lucide-react'
import { ModalPortal } from '@/components/shared/modal-portal'
import {
  NEW_QUESTION_TYPES,
  SAVED_FIELD_TYPES,
  TYPE_LABELS,
  addQuestion,
  createCustomFieldQuestion,
  createClientFieldQuestion,
  createFieldQuestion,
  createQuestion,
  fieldSpecFor,
  duplicateQuestion,
  hasLabel,
  hasOptions,
  newQuestionId,
  removeQuestion as removeQuestionFrom,
  reorderQuestions,
  updateQuestion,
  usedCustomFieldIds,
} from '@/lib/session-form-builder'
import { isChoiceType as isChoiceAnswer } from '@/lib/session-form-builder'
import { CLIENT_FIELDS, clientFieldLabel, clientFieldIsDogDetail } from '@/lib/client-fields'
import type { CustomFieldOption, Question, QuestionType, ShowIf } from '@/lib/session-form-builder'
import { FORM_QUIET_ACTION, FormEditorSection } from './_form-editor-shell'

/**
 * The one question editor.
 *
 * A trainer authors questions in two places — session forms (filled in by the
 * trainer after a session, becoming the client's report) and client forms
 * (filled in by the client: intake and public website enquiry). Both run on the
 * same `Question[]` engine, so both use this list rather than each growing its
 * own. Drag to reorder (never chevron buttons — AGENTS.md), flat rows with
 * hairline dividers, no tinted cards.
 *
 * The two differences between the callers are props, not layouts:
 *   showPrivateToggle — "Team only" only means something on a session form.
 *   allowConditional  — only a client-filled form can branch on an answer;
 *                       a trainer filling in a report sees every question.
 *   steps             — client forms can be split across pages.
 */

// ─── Options editor ──────────────────────────────────────────────────────────

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

// ─── Conditional visibility ──────────────────────────────────────────────────

// "Only ask this when…" — two selects on one line, in plain words. Only
// questions with a fixed option list can be branched on, because the rule has
// to offer the trainer a value to match rather than a free-text box.
function ConditionRow({
  question,
  sources,
  labelFor,
  onChange,
}: {
  question: Question
  sources: Question[]
  labelFor: (q: Question) => string
  onChange: (showIf: ShowIf | undefined) => void
}) {
  if (sources.length === 0) return null
  const src = sources.find(s => s.id === question.showIf?.questionId)
  const options = src && hasOptions(src) ? src.options.filter(Boolean) : []
  const selectCls =
    'h-9 min-w-0 max-w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]'

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-slate-400">Only ask this when</span>
      <select
        value={question.showIf?.questionId ?? ''}
        onChange={e => onChange(e.target.value ? { questionId: e.target.value, equals: '' } : undefined)}
        aria-label="Only ask this question when"
        className={selectCls}
      >
        <option value="">always ask it</option>
        {sources.map(s => (
          <option key={s.id} value={s.id}>{labelFor(s)}</option>
        ))}
      </select>
      {question.showIf && (
        <>
          <span className="text-xs text-slate-400">is</span>
          <select
            value={question.showIf.equals}
            onChange={e => onChange({ questionId: question.showIf!.questionId, equals: e.target.value })}
            aria-label="Answer that reveals this question"
            className={selectCls}
          >
            <option value="">choose an answer…</option>
            {options.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

// ─── One question ────────────────────────────────────────────────────────────

function QuestionCard({
  question,
  index,
  total,
  customFields,
  showPrivateToggle,
  conditionSources,
  labelFor,
  onPatch,
  onShowIf,
  onDuplicate,
  onRemove,
  canRemove,
}: {
  question: Question
  index: number
  total: number
  customFields: CustomFieldOption[]
  showPrivateToggle: boolean
  conditionSources: Question[] | null
  labelFor: (q: Question) => string
  onPatch: (patch: Parameters<typeof updateQuestion>[2]) => void
  onShowIf: (showIf: ShowIf | undefined) => void
  onDuplicate: () => void
  onRemove: () => void
  canRemove: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: question.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }
  // What a saved-to-record question is asking. For a field being created here
  // that's the draft on the question; for an existing link it's read off the
  // field itself, so a link is EDITABLE rather than a read-only chip.
  const spec = question.type === 'CUSTOM_FIELD' ? fieldSpecFor(question, customFields) : null

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
          spec === null ? (
            // The field it points at is gone. Said plainly rather than shown as a
            // blank editor that would recreate it under a new id on save.
            <p className="text-sm text-slate-500">
              This question pointed at a field that no longer exists. Remove it.
            </p>
          ) : (
          <>
            <input
              type="text"
              value={spec.label}
              onChange={e => onPatch({ field: { ...spec, label: e.target.value } })}
              placeholder="Question text"
              aria-label={`Question ${index + 1}`}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={spec.answerType}
                onChange={e => onPatch({ field: { ...spec, answerType: e.target.value as Exclude<QuestionType, 'CUSTOM_FIELD'> } })}
                aria-label={`Answer type for question ${index + 1}`}
                className="h-9 w-fit rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              >
                {SAVED_FIELD_TYPES.map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
              {/* Whose record it lands on. Two choices, so a segmented pair rather
                  than a dropdown — and it's the one thing about a saved field a
                  trainer can't work out from the question text. */}
              <select
                value={spec.appliesTo}
                onChange={e => onPatch({ field: { ...spec, appliesTo: e.target.value as 'OWNER' | 'DOG' } })}
                aria-label={`Saved against for question ${index + 1}`}
                className="h-9 w-fit rounded-lg border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              >
                <option value="OWNER">Saved on the client</option>
                <option value="DOG">Saved on the dog</option>
              </select>
            </div>
            {isChoiceAnswer(spec.answerType) && (
              <OptionsEditor
                options={spec.options ?? []}
                onChange={opts => onPatch({ field: { ...spec, options: opts } })}
              />
            )}
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Link2 className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} />
              {question.customFieldId
                ? 'Kept on their record — editing this changes it everywhere it appears.'
                : 'Kept on their record, so it shows on their profile and in your lists.'}
            </p>
          </>
          )
        ) : question.type === 'CLIENT_FIELD' ? (
          <>
            <div className="flex items-center gap-1.5 text-sm font-medium text-slate-900">
              <UserSquare className="h-3.5 w-3.5 flex-shrink-0 text-slate-500" strokeWidth={1.75} />
              <span className="truncate">{clientFieldLabel(question.fieldKey)}</span>
            </div>
            {/* Nothing to type: it asks for a detail the app already knows the
                shape of, and the answer goes straight onto their record rather
                than into this form's answers. */}
            <p className="text-xs text-slate-400">
              {clientFieldIsDogDetail(question.fieldKey)
                ? 'Saved on their dog’s record.'
                : 'Saved on their record.'}
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
              // Only authored questions reach this branch; the two labelless kinds
              // are handled above and have no type to choose.
              value={hasLabel(question) ? question.type : 'SHORT_TEXT'}
              onChange={e => onPatch({ type: e.target.value as Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'> })}
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
          {showPrivateToggle && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={!!question.isPrivate}
                onChange={e => onPatch({ isPrivate: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              Team only
            </label>
          )}
        </div>

        {conditionSources && (
          <ConditionRow
            question={question}
            sources={conditionSources}
            labelFor={labelFor}
            onChange={onShowIf}
          />
        )}
      </div>

      <div className="flex flex-shrink-0 flex-col items-center gap-1">
        <button
          type="button"
          onClick={onDuplicate}
          className="p-1 text-slate-300 hover:text-slate-600"
          aria-label={`Duplicate question ${index + 1}`}
        >
          <Copy className="h-4 w-4" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="p-1 text-slate-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label={`Remove question ${index + 1}`}
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

// ─── The list ────────────────────────────────────────────────────────────────

export function QuestionList({
  questions,
  onChange,
  customFields,
  showPrivateToggle = false,
  allowConditional = false,
  minQuestions = 0,
  /** When set, only questions on this step are shown and new ones join it. */
  activeStep = null,
  stepFallback = null,
}: {
  questions: Question[]
  onChange: (next: Question[]) => void
  customFields: CustomFieldOption[]
  showPrivateToggle?: boolean
  allowConditional?: boolean
  minQuestions?: number
  activeStep?: string | null
  stepFallback?: string | null
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function labelFor(q: Question): string {
    if (q.type === 'CUSTOM_FIELD') {
      return customFields.find(f => f.id === q.customFieldId)?.label ?? 'Linked field'
    }
    if (q.type === 'CLIENT_FIELD') return clientFieldLabel(q.fieldKey)
    return q.label || TYPE_LABELS[q.type]
  }

  // On a multi-step form only this page's questions are listed. A question with
  // no step belongs to the first page, so it isn't stranded on a form that
  // gained its steps after the questions were written.
  const visible = activeStep === null
    ? questions
    : questions.filter(q => (q.step ?? stepFallback) === activeStep)

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    onChange(reorderQuestions(questions, String(active.id), String(over.id)))
  }

  if (visible.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
        No questions on this page yet.
      </p>
    )
  }

  return (
    <DndArea sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={visible.map(q => q.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 [&>*+*]:border-t [&>*+*]:border-slate-200">
          {visible.map((q, i) => (
            <QuestionCard
              key={q.id}
              question={q}
              index={i}
              total={visible.length}
              customFields={customFields}
              showPrivateToggle={showPrivateToggle}
              labelFor={labelFor}
              // A rule can only key on a question that comes EARLIER and has a
              // fixed option list — anything else either can't be matched or
              // hasn't been answered yet when this one renders.
              conditionSources={
                allowConditional
                  ? questions.slice(0, questions.findIndex(x => x.id === q.id)).filter(hasOptions)
                  : null
              }
              onPatch={patch => onChange(updateQuestion(questions, q.id, patch))}
              onShowIf={showIf =>
                onChange(questions.map(x => (x.id === q.id ? ({ ...x, showIf } as Question) : x)))
              }
              onDuplicate={() => onChange(duplicateQuestion(questions, q.id).questions)}
              onRemove={() =>
                onChange(questions.length > minQuestions ? removeQuestionFrom(questions, q.id) : questions)
              }
              canRemove={questions.length > minQuestions}
            />
          ))}
        </div>
      </SortableContext>
    </DndArea>
  )
}

/**
 * The Questions section with its two actions, so neither editor re-derives the
 * header. `onAdd` receives a ready-made question; the caller stamps the current
 * step on it before appending.
 */
export function QuestionsSection({
  questions,
  onChange,
  customFields,
  title = 'Questions',
  hint = 'Drag a question by its handle to reorder it.',
  extraActions,
  activeStep = null,
  stepFallback = null,
  ...listProps
}: {
  questions: Question[]
  onChange: (next: Question[]) => void
  customFields: CustomFieldOption[]
  title?: string
  hint?: string
  extraActions?: React.ReactNode
  showPrivateToggle?: boolean
  allowConditional?: boolean
  minQuestions?: number
  activeStep?: string | null
  stepFallback?: string | null
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [detailPickerOpen, setDetailPickerOpen] = useState(false)
  const used = usedCustomFieldIds(questions)

  // A new question joins the page you're looking at, so it doesn't silently
  // land on page one while you're editing page three.
  function withStep(q: Question): Question {
    return activeStep ? ({ ...q, step: activeStep } as Question) : q
  }

  return (
    <>
      <FormEditorSection
        title={title}
        hint={hint}
        action={
          <>
            <button
              type="button"
              onClick={() => onChange(addQuestion(questions, withStep(createQuestion('LONG_TEXT', newQuestionId()))))}
              className={FORM_QUIET_ACTION}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Add question
            </button>
            {/* The built-in details, as questions. They used to be configured on
                their own screen — but "the system fields are just a result of the
                forms" (Karl), so the form is what says they're asked for. */}
            <button
              type="button"
              onClick={() => setDetailPickerOpen(true)}
              className={FORM_QUIET_ACTION}
              title="Ask for their name, phone, dog's breed…"
            >
              <UserSquare className="h-3.5 w-3.5" strokeWidth={1.75} />
              Add a client detail
            </button>
            {/* Making a field used to mean leaving the builder, creating it on
                another screen, and coming back to link it. */}
            <button
              type="button"
              onClick={() => onChange(addQuestion(questions, withStep(createFieldQuestion(newQuestionId()))))}
              className={FORM_QUIET_ACTION}
              title="Ask something and keep the answer on their record"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              Add a saved field
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
            {extraActions}
          </>
        }
      >
        <QuestionList
          questions={questions}
          onChange={onChange}
          customFields={customFields}
          activeStep={activeStep}
          stepFallback={stepFallback}
          {...listProps}
        />
      </FormEditorSection>

      {pickerOpen && (
        <CustomFieldPicker
          customFields={customFields}
          used={used}
          onPick={f => {
            onChange(addQuestion(questions, withStep(createCustomFieldQuestion(f.id, newQuestionId()))))
            setPickerOpen(false)
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {detailPickerOpen && (
        <ClientDetailPicker
          used={new Set(questions.filter(q => q.type === 'CLIENT_FIELD').map(q => q.fieldKey))}
          onPick={key => {
            onChange(addQuestion(questions, withStep(createClientFieldQuestion(key, newQuestionId()))))
            setDetailPickerOpen(false)
          }}
          onClose={() => setDetailPickerOpen(false)}
        />
      )}
    </>
  )
}

// ─── Client-detail picker ────────────────────────────────────────────────────

/**
 * The built-in details a form can ask for.
 *
 * A full screen for the same reason the field picker is one: nine rows, each
 * needing to say whether it's about the owner or the dog. Already-asked details
 * are shown as taken rather than hidden, so it's obvious the form has them rather
 * than that they don't exist.
 */
function ClientDetailPicker({
  used,
  onPick,
  onClose,
}: {
  used: Set<string>
  onPick: (fieldKey: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ModalPortal>
      <div role="dialog" aria-modal="true" aria-label="Add a client detail" className="fixed inset-0 z-[90] flex flex-col bg-slate-50">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 pt-[env(safe-area-inset-top)]">
          <div className="min-w-0 flex-1 py-3.5">
            <p className="truncate text-[15px] font-semibold text-slate-900">Add a client detail</p>
            <p className="mt-0.5 truncate text-[13px] text-slate-500">Saved straight onto their record</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 flex-shrink-0 p-2 text-slate-400 active:text-slate-700">
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="no-scrollbar flex-1 overflow-y-auto p-4">
          <div className="mx-auto w-full max-w-lg rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {CLIENT_FIELDS.map(f => {
              const taken = used.has(f.key)
              return (
                <button
                  key={f.key}
                  type="button"
                  disabled={taken}
                  onClick={() => onPick(f.key)}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left disabled:opacity-40 active:bg-slate-50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-slate-900">{f.label}</span>
                    <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                      {f.scope === 'DOG' ? 'About their dog' : 'About the owner'}
                      {f.alwaysRequired ? ' · always required' : ''}
                    </span>
                  </span>
                  {taken && <span className="flex-shrink-0 text-[13px] text-slate-400">Already asked</span>}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}

// ─── Link-a-field picker ─────────────────────────────────────────────────────

// A full screen, not a dropdown — there can be dozens of fields, and each row
// needs room to say what it is. Portaled to <body> (the header's backdrop-blur
// would otherwise become the containing block for `fixed`), and it locks body
// scroll so there's never a second scrollbar behind it.
export function CustomFieldPicker({
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
