'use client'

import { useRef, useState } from 'react'
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
import {
  AlignLeft, Check, ChevronLeft, Copy, Eye, GripVertical, Hash, List, Lock,
  Plus, Star, Trash2, Type as TypeIcon, CircleDot, CheckSquare, Link2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  NEW_QUESTION_TYPES, TYPE_LABELS, addQuestion, createCustomFieldQuestion,
  createQuestion, duplicateQuestion, hasOptions, removeQuestion,
  reorderQuestions, serializeQuestions, updateQuestion, usedCustomFieldIds,
  validateForm,
  type CustomFieldOption, type Question, type QuestionType,
} from '@/lib/session-form-builder'

// ─────────────────────────────────────────────────────────────────────────────
// Session form builder — a full-screen two-pane modal.
//
//   LEFT   a stack navigator: the palette (your fields + new question types)
//          swaps to the question editor when a question is selected.
//   RIGHT  a live "as the client sees it" form card. Real inputs, but
//          pointer-events-none, so a click selects the question instead of
//          typing into it.
//
// Questions are added by clicking a palette row or dragging it onto the canvas
// (native HTML5 drag); reordering on the canvas uses @dnd-kit/sortable.
// ─────────────────────────────────────────────────────────────────────────────

const DRAG_MIME = 'application/x-pm-question'

const TYPE_ICONS: Record<Exclude<QuestionType, 'CUSTOM_FIELD'>, typeof TypeIcon> = {
  SHORT_TEXT: TypeIcon,
  LONG_TEXT: AlignLeft,
  NUMBER: Hash,
  RATING_1_5: Star,
  DROPDOWN: List,
  RADIO: CircleDot,
  CHECKBOX: CheckSquare,
}

const FIELD_ICONS: Record<CustomFieldOption['type'], typeof TypeIcon> = {
  TEXT: TypeIcon,
  NUMBER: Hash,
  DROPDOWN: List,
}

type DragPayload =
  | { kind: 'type'; type: Exclude<QuestionType, 'CUSTOM_FIELD'> }
  | { kind: 'field'; customFieldId: string }

export interface SessionFormBuilderProps {
  /** Trainer's field library — the "Your fields" palette group. */
  customFields: CustomFieldOption[]
  onClose: () => void
}

export function SessionFormBuilderModal({ customFields, onClose }: SessionFormBuilderProps) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [questions, setQuestions] = useState<Question[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Small screens only: the left pane lives in a bottom sheet.
  const [sheetOpen, setSheetOpen] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  const selected = questions.find(q => q.id === selectedId) ?? null
  const used = usedCustomFieldIds(questions)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  function select(id: string | null) {
    setSelectedId(id)
    if (id) setSheetOpen(true)
  }

  function insert(payload: DragPayload, index?: number) {
    const q = payload.kind === 'type'
      ? createQuestion(payload.type)
      : createCustomFieldQuestion(payload.customFieldId)
    setQuestions(qs => addQuestion(qs, q, index))
    setError(null)
    // Newly added questions auto-select, flipping the left pane to the editor.
    select(q.id)
  }

  function patch(id: string, p: Parameters<typeof updateQuestion>[2]) {
    setQuestions(qs => updateQuestion(qs, id, p))
  }

  function onDuplicate(id: string) {
    const res = duplicateQuestion(questions, id)
    setQuestions(res.questions)
    if (res.newId) select(res.newId)
  }

  function onDelete(id: string) {
    setQuestions(qs => removeQuestion(qs, id))
    if (selectedId === id) setSelectedId(null)
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setQuestions(qs => reorderQuestions(qs, String(active.id), String(over.id)))
  }

  // ─── Palette → canvas (native HTML5 drag) ─────────────────────────────────

  function computeDropIndex(clientY: number): number {
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-question-row]')
    if (!rows || rows.length === 0) return 0
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return i
    }
    return rows.length
  }

  function onCanvasDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDropIndex(computeDropIndex(e.clientY))
  }

  function onCanvasDrop(e: React.DragEvent) {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    e.preventDefault()
    const at = dropIndex ?? questions.length
    setDropIndex(null)
    try {
      insert(JSON.parse(raw) as DragPayload, at)
    } catch {
      /* malformed payload — ignore */
    }
  }

  async function save() {
    const problem = validateForm(name, questions)
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    const res = await fetch('/api/session-forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        questions: serializeQuestions(questions),
      }),
    })
    if (!res.ok) {
      setError('Could not save the form. Please try again.')
      setSaving(false)
      return
    }
    router.refresh()
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[70] flex" role="dialog" aria-modal="true" aria-label="Session form builder">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-[71] m-0 sm:m-4 lg:m-8 flex flex-1 flex-col overflow-hidden bg-white sm:rounded-2xl shadow-2xl">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header className="flex flex-shrink-0 items-center gap-2 border-b border-slate-200 px-3 sm:px-5 py-3">
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError(null) }}
            placeholder="Untitled session form"
            aria-label="Form name"
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-base sm:text-lg font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 hover:border-slate-200 focus:border-transparent focus:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
          />
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" loading={saving} onClick={save}>Save</Button>
        </header>

        {error && (
          <p className="flex-shrink-0 border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>
        )}

        {/* ── Panes ──────────────────────────────────────────────────────── */}
        <div className="relative flex min-h-0 flex-1">
          {/* Mobile scrim behind the sheet. */}
          {sheetOpen && (
            <div className="absolute inset-0 z-10 bg-slate-900/20 sm:hidden" onClick={() => setSheetOpen(false)} />
          )}

          {/* LEFT — palette / question editor. Static sidebar from `sm` up,
              a bottom sheet below it (one DOM node, not two). */}
          <aside
            className={[
              'flex flex-col bg-white',
              'fixed inset-x-0 bottom-0 z-20 max-h-[72vh] rounded-t-2xl border-t border-slate-200 shadow-2xl transition-transform duration-200',
              sheetOpen ? 'translate-y-0' : 'translate-y-full',
              'sm:static sm:z-auto sm:w-[380px] lg:w-[400px] sm:max-h-none sm:flex-shrink-0 sm:translate-y-0 sm:rounded-none sm:border-t-0 sm:border-r sm:border-slate-200 sm:shadow-none',
            ].join(' ')}
          >
            <div className="mx-auto mt-2 h-1 w-10 flex-shrink-0 rounded-full bg-slate-200 sm:hidden" />
            {selected ? (
              <QuestionEditor
                question={selected}
                customFields={customFields}
                onBack={() => setSelectedId(null)}
                onPatch={p => patch(selected.id, p)}
                onDuplicate={() => onDuplicate(selected.id)}
                onDelete={() => onDelete(selected.id)}
              />
            ) : (
              <Palette
                customFields={customFields}
                used={used}
                onAddType={t => insert({ kind: 'type', type: t })}
                onAddField={id => insert({ kind: 'field', customFieldId: id })}
              />
            )}
          </aside>

          {/* RIGHT — the canvas. */}
          <div
            className="min-w-0 flex-1 overflow-y-auto bg-slate-100 p-4 pb-24 sm:p-8 sm:pb-8"
            onDragOver={onCanvasDragOver}
            onDragLeave={() => setDropIndex(null)}
            onDrop={onCanvasDrop}
          >
            <div className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-8">
              <h2 className="mb-1 text-xl font-semibold text-slate-900">
                {name.trim() || 'Untitled session form'}
              </h2>
              <p className="mb-5 text-sm text-slate-400">This is how the report will look to your client.</p>

              {questions.length === 0 ? (
                <div className={`flex min-h-[180px] items-center justify-center rounded-xl border-2 border-dashed px-4 text-center text-sm transition-colors ${
                  dropIndex !== null ? 'border-[var(--pm-brand-500)] bg-[var(--pm-brand-50)] text-[var(--pm-brand-700)]' : 'border-slate-200 text-slate-400'
                }`}>
                  Drag questions here, or click + on the left
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                  <SortableContext items={questions.map(q => q.id)} strategy={verticalListSortingStrategy}>
                    <div ref={listRef} className="flex flex-col gap-2">
                      {questions.map((q, i) => (
                        <div key={q.id}>
                          {dropIndex === i && <DropLine />}
                          <SortableQuestion
                            question={q}
                            customFields={customFields}
                            selected={q.id === selectedId}
                            onSelect={() => select(q.id)}
                          />
                        </div>
                      ))}
                      {dropIndex === questions.length && <DropLine />}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </div>

          {/* Mobile-only: open the palette. */}
          {!sheetOpen && (
            <button
              type="button"
              onClick={() => { setSelectedId(null); setSheetOpen(true) }}
              className="absolute inset-x-4 bottom-4 z-20 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[var(--pm-brand-600)] text-sm font-semibold text-white shadow-lg sm:hidden"
            >
              <Plus className="h-4 w-4" /> Add question
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function DropLine() {
  return <div className="my-1 h-0.5 rounded-full bg-[var(--pm-brand-500)]" />
}

// ─── Left pane: palette ──────────────────────────────────────────────────────

function Palette({
  customFields,
  used,
  onAddType,
  onAddField,
}: {
  customFields: CustomFieldOption[]
  used: Set<string>
  onAddType: (t: Exclude<QuestionType, 'CUSTOM_FIELD'>) => void
  onAddField: (id: string) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <p className="mb-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Click to add to the end of the form, or drag onto it to drop it exactly where you want.
      </p>
      <GroupHeading>Your fields</GroupHeading>
      {customFields.length === 0 ? (
        <p className="mb-5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-400">
          No client fields yet. Add them on the Fields tab and they&apos;ll show up here.
        </p>
      ) : (
        <div className="mb-5 flex flex-col gap-1">
          {customFields.map(f => {
            const Icon = FIELD_ICONS[f.type]
            const added = used.has(f.id)
            return (
              <button
                key={f.id}
                type="button"
                disabled={added}
                draggable={!added}
                onDragStart={e => {
                  e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'field', customFieldId: f.id } satisfies DragPayload))
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onAddField(f.id)}
                aria-label={added ? `${f.label} (added)` : `Add field ${f.label}`}
                className={`group flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  added
                    ? 'cursor-not-allowed border-slate-100 bg-slate-50 opacity-60'
                    : 'cursor-grab border-slate-200 hover:border-[var(--pm-brand-500)] hover:bg-[var(--pm-brand-50)]'
                }`}
              >
                <Icon className="h-4 w-4 flex-shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{f.label}</span>
                {added ? (
                  <span className="flex-shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Added
                  </span>
                ) : (
                  <Plus className="h-4 w-4 flex-shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" />
                )}
              </button>
            )
          })}
        </div>
      )}

      <GroupHeading>New question</GroupHeading>
      <div className="grid grid-cols-2 gap-2">
        {NEW_QUESTION_TYPES.map(t => {
          const Icon = TYPE_ICONS[t]
          return (
            <button
              key={t}
              type="button"
              draggable
              onDragStart={e => {
                e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ kind: 'type', type: t } satisfies DragPayload))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onClick={() => onAddType(t)}
              aria-label={`Add ${TYPE_LABELS[t]}`}
              className="group flex cursor-grab flex-col items-start gap-2 rounded-xl border border-slate-200 p-3 transition-colors hover:border-[var(--pm-brand-500)] hover:bg-[var(--pm-brand-50)]"
            >
              <span className="flex w-full items-center justify-between">
                <Icon className="h-4 w-4 text-slate-400 group-hover:text-[var(--pm-brand-600)]" />
                <Plus className="h-4 w-4 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100" />
              </span>
              <span className="text-sm font-medium text-slate-700">{TYPE_LABELS[t]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</p>
  )
}

// ─── Left pane: question editor ──────────────────────────────────────────────

function QuestionEditor({
  question,
  customFields,
  onBack,
  onPatch,
  onDuplicate,
  onDelete,
}: {
  question: Question
  customFields: CustomFieldOption[]
  onBack: () => void
  onPatch: (p: Parameters<typeof updateQuestion>[2]) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const linked = question.type === 'CUSTOM_FIELD'
    ? customFields.find(f => f.id === question.customFieldId)
    : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-shrink-0 items-center gap-1 border-b border-slate-100 px-3 py-2.5">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to palette"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          {question.type === 'CUSTOM_FIELD' ? (linked?.label ?? 'Linked field') : TYPE_LABELS[question.type]}
        </p>
        <button
          type="button"
          onClick={onDuplicate}
          aria-label="Duplicate question"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <Copy className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete question"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {question.type === 'CUSTOM_FIELD' ? (
          <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3">
            <Link2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
            <p className="text-xs text-emerald-800">
              Linked to your <strong>{linked?.label ?? 'field'}</strong>{' '}
              {linked?.appliesTo === 'DOG' ? 'dog' : 'client'} field. Filling it in syncs to the client&apos;s record.
            </p>
          </div>
        ) : (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Question</span>
              <input
                value={question.label}
                onChange={e => onPatch({ label: e.target.value })}
                placeholder="e.g. How did the session go?"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Type</span>
              <select
                value={question.type}
                onChange={e => onPatch({ type: e.target.value as Exclude<QuestionType, 'CUSTOM_FIELD'> })}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
              >
                {NEW_QUESTION_TYPES.map(t => (
                  <option key={t} value={t}>{TYPE_LABELS[t]}</option>
                ))}
              </select>
            </label>
          </>
        )}

        <ToggleRow
          icon={<Check className="h-4 w-4" />}
          label="Required"
          hint="The question must be answered before the report can be sent."
          checked={question.required}
          onChange={v => onPatch({ required: v })}
        />
        <ToggleRow
          icon={question.isPrivate ? <Lock className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          label="Private"
          hint={question.isPrivate
            ? 'Trainer-only — hidden from the client’s report.'
            : 'Shown to the client on their report.'}
          checked={!!question.isPrivate}
          onChange={v => onPatch({ isPrivate: v })}
        />

        {hasOptions(question) && (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700">Options</span>
            <p className="text-xs text-slate-400">One per line.</p>
            <textarea
              value={question.options.join('\n')}
              onChange={e => onPatch({ options: e.target.value.split('\n') })}
              rows={5}
              aria-label="Options"
              placeholder={'Great\nGood\nNeeds work'}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--pm-brand-500)]"
            />
          </div>
        )}
      </div>
    </div>
  )
}

function ToggleRow({
  icon, label, hint, checked, onChange,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
        checked ? 'border-[var(--pm-brand-500)] bg-[var(--pm-brand-50)]' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className={`mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg ${
        checked ? 'bg-[var(--pm-brand-600)] text-white' : 'bg-slate-100 text-slate-400'
      }`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
      <span className={`mt-1 h-5 w-9 flex-shrink-0 rounded-full p-0.5 transition-colors ${checked ? 'bg-[var(--pm-brand-600)]' : 'bg-slate-200'}`}>
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  )
}

// ─── Right pane: canvas ──────────────────────────────────────────────────────

function SortableQuestion({
  question,
  customFields,
  selected,
  onSelect,
}: {
  question: Question
  customFields: CustomFieldOption[]
  selected: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: question.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const linked = question.type === 'CUSTOM_FIELD'
    ? customFields.find(f => f.id === question.customFieldId)
    : undefined
  const label = question.type === 'CUSTOM_FIELD'
    ? (linked?.label ?? 'Linked field')
    : (question.label.trim() || TYPE_LABELS[question.type])
  const untitled = question.type !== 'CUSTOM_FIELD' && !question.label.trim()

  return (
    <div ref={setNodeRef} style={style} data-question-row>
      {/* The whole row selects the question — the preview inputs below are
          pointer-events-none so a click lands here, not in the field. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect() } }}
        aria-label={`Edit question: ${label}`}
        className={`group relative cursor-pointer rounded-xl p-3 transition-shadow ${
          selected
            ? 'bg-[var(--pm-brand-50)] ring-2 ring-[var(--pm-brand-500)]'
            : 'ring-1 ring-transparent hover:bg-slate-50 hover:ring-slate-200'
        }`}
      >
        <button
          type="button"
          aria-label="Reorder question"
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          className={`absolute right-2 top-2 cursor-grab rounded-lg p-1 text-slate-300 transition-opacity hover:text-slate-500 ${
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
          }`}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <div className="mb-1.5 flex items-center gap-1.5 pr-8">
          <span className={`text-sm font-medium ${untitled ? 'text-slate-300' : 'text-slate-800'}`}>{label}</span>
          {question.required && <span className="text-red-500">*</span>}
          {question.isPrivate && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
              <Lock className="h-2.5 w-2.5" /> Private
            </span>
          )}
        </div>
        <div className="pointer-events-none select-none">
          <QuestionPreview question={question} linked={linked} />
        </div>
      </div>
    </div>
  )
}

const inputCls = 'h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 px-3 text-sm text-slate-400'

function QuestionPreview({ question, linked }: { question: Question; linked?: CustomFieldOption }) {
  const type = question.type === 'CUSTOM_FIELD'
    ? ({ TEXT: 'SHORT_TEXT', NUMBER: 'NUMBER', DROPDOWN: 'DROPDOWN' } as const)[linked?.type ?? 'TEXT']
    : question.type
  const options: string[] = hasOptions(question) ? question.options : []

  switch (type) {
    case 'LONG_TEXT':
      return <div className={`${inputCls} h-20 py-2`}>Their answer…</div>
    case 'NUMBER':
      return <div className={`${inputCls} max-w-[140px]`}>0</div>
    case 'RATING_1_5':
      return (
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map(i => (
            <Star key={i} className="h-6 w-6 text-slate-200" />
          ))}
        </div>
      )
    case 'DROPDOWN':
      return (
        <div className={`${inputCls} flex items-center justify-between`}>
          <span>{options.find(o => o.trim()) ?? 'Choose one…'}</span>
          <List className="h-4 w-4 text-slate-300" />
        </div>
      )
    case 'RADIO':
    case 'CHECKBOX':
      return (
        <div className="flex flex-col gap-1.5">
          {(options.length > 0 ? options : ['Option 1', 'Option 2']).map((o, i) => (
            <span key={i} className="flex items-center gap-2 text-sm text-slate-400">
              <span className={`h-4 w-4 flex-shrink-0 border border-slate-300 bg-white ${type === 'RADIO' ? 'rounded-full' : 'rounded'}`} />
              {o.trim() || `Option ${i + 1}`}
            </span>
          ))}
        </div>
      )
    default:
      return <div className={inputCls}>Their answer…</div>
  }
}
