'use client'

import { useState, type ReactNode } from 'react'
import {
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  AlignLeft, CheckSquare, CircleDot, Hash, Link2, List, Plus, Star,
  Type as TypeIcon, UserSquare,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DndArea } from '@/components/shared/dnd-area'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { SectionLabel } from '@/components/shared/flat-list'
import {
  NEW_QUESTION_TYPES,
  TYPE_LABELS,
  addQuestion,
  createClientFieldQuestion,
  createCustomFieldQuestion,
  createFieldQuestion,
  createQuestion,
  newQuestionId,
  reorderQuestions,
  usedCustomFieldIds,
} from '@/lib/session-form-builder'
import type { CustomFieldOption, Question, QuestionType } from '@/lib/session-form-builder'
import {
  FORM_QUIET_ACTION,
  FormEditorSection,
  FormEditorShell,
  FormSegmented,
  type FormEditorStatus,
} from './_form-editor-shell'
import { ClientDetailPicker, CustomFieldPicker, QuestionList } from './_question-list'

/**
 * The ONE form builder.
 *
 * Karl, 2026-08-02: "The [intake] form functionality should be exactly the same
 * as the [enquiry] form functionality with the same interface so that you can
 * drag on fields, set up your settings, control all the different things you
 * need to from that one interface. There should not be 2 different interfaces."
 * And: "I want this to have the fields on the left hand side, the form on the
 * right hand side, and an option to configure some settings for the form, and to
 * make it super easy to add fields."
 *
 * That shape existed once — `forms/session/session-form-builder-modal.tsx`, a
 * palette-left / form-right modal (eb362fb) — and was thrown away in 4649a1d
 * when every editor was flattened onto one long single-column page so the three
 * screens would at least MATCH. Matching was the right instinct; losing the
 * palette was not. This puts the palette back and gives it to every kind of form
 * at once, instead of only session forms:
 *
 *   LEFT     the fields you can add — question types, the built-in client
 *            details, and your own saved fields. Click one, or drag it onto the
 *            form to drop it exactly where you want it.
 *   RIGHT    the form itself: its basics, its pages, and its questions, each
 *            editable in place (this is `_question-list.tsx`, unchanged, so a
 *            fix to a question row still fixes it everywhere).
 *   SETTINGS a second tab for everything that is about what happens AFTER the
 *            form — the success page, the emails, the report background.
 *
 * PHONE — a 240px rail beside a form does not fit 390px, so there is no rail.
 * The palette is the same component rendered inside a FullScreenSheet off the
 * "Add a field" button in the Questions header: full screen, body scroll locked,
 * one column, tap to add. Dragging FROM that sheet ONTO the form underneath is
 * not possible and is not offered — on a phone every palette row is a tap, and
 * reordering is still the drag handle on each question row.
 */

// ─── The palette's payload ───────────────────────────────────────────────────

type PalettePayload =
  | { kind: 'type'; type: Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'> }
  | { kind: 'newField' }
  | { kind: 'savedField'; customFieldId: string }
  | { kind: 'clientDetail'; fieldKey: string }

function makeQuestion(payload: PalettePayload): Question {
  switch (payload.kind) {
    case 'type': return createQuestion(payload.type, newQuestionId())
    case 'newField': return createFieldQuestion(newQuestionId())
    case 'savedField': return createCustomFieldQuestion(payload.customFieldId, newQuestionId())
    case 'clientDetail': return createClientFieldQuestion(payload.fieldKey, newQuestionId())
  }
}

const TYPE_ICONS: Record<Exclude<QuestionType, 'CUSTOM_FIELD' | 'CLIENT_FIELD'>, LucideIcon> = {
  SHORT_TEXT: TypeIcon,
  LONG_TEXT: AlignLeft,
  NUMBER: Hash,
  RATING_1_5: Star,
  DROPDOWN: List,
  RADIO: CircleDot,
  CHECKBOX: CheckSquare,
}

/** The whole form is a drop target, so a palette row dropped past the last
 *  question appends rather than falling on the floor. */
const CANVAS_ID = '__form-canvas__'

/**
 * A question always wins a collision with the canvas.
 *
 * closestCenter compares droppable CENTRES, and the canvas — being the tallest
 * box on screen — can be nearer to the pointer than the short row you are
 * actually hovering. So the canvas is only ever the answer when nothing else is
 * under you, which is exactly "you dropped it below the last question".
 */
const questionsWinCollision: CollisionDetection = args => {
  const hits = closestCenter(args)
  const overAQuestion = hits.filter(h => h.id !== CANVAS_ID)
  return overAQuestion.length > 0 ? overAQuestion : hits
}

// ─── One palette row ─────────────────────────────────────────────────────────

function PaletteItem({
  dragId,
  payload,
  icon: Icon,
  label,
  hint,
  ariaLabel,
  disabled,
  disabledNote,
  onClick,
}: {
  dragId: string
  /** Omitted for a row that opens a picker — there is nothing to drop yet. */
  payload?: PalettePayload
  icon: LucideIcon
  label: string
  hint?: string
  ariaLabel: string
  disabled?: boolean
  disabledNote?: string
  onClick: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: dragId,
    data: { palette: payload },
    disabled: disabled || !payload,
  })

  return (
    <button
      ref={setNodeRef}
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      {...attributes}
      {...listeners}
      // dnd-kit stamps aria-disabled on anything it can't drag, and the two rows
      // that OPEN a picker have nothing to drag yet — so they announced
      // themselves as disabled to a screen reader while clicking fine. Only a
      // row that is genuinely unavailable (already on the form) is disabled.
      aria-disabled={disabled || undefined}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined}
      className={`relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left ${
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-grab active:bg-slate-50 hover:bg-slate-50'
      } ${isDragging ? 'bg-white shadow-lg ring-1 ring-slate-200' : ''}`}
    >
      <Icon className="h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{label}</span>
        {hint && <span className="mt-0.5 block truncate text-xs text-slate-400">{hint}</span>}
      </span>
      {disabled && disabledNote && (
        <span className="flex-shrink-0 text-xs text-slate-400">{disabledNote}</span>
      )}
    </button>
  )
}

/** One bordered block of palette rows, hairline-divided — the house shape. */
function PaletteGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-100">
        {children}
      </div>
    </div>
  )
}

// How many saved fields get their own palette row before the rest move behind
// the picker. A trainer with sixty fields would otherwise own a rail taller than
// the form — the picker is a full screen with room to read them.
const PALETTE_FIELD_LIMIT = 8

function Palette({
  customFields,
  usedFields,
  onAdd,
  onOpenDetailPicker,
  onOpenFieldPicker,
  /** Suffix so the sheet's copy of the palette can't collide drag ids with the rail's. */
  idScope,
}: {
  customFields: CustomFieldOption[]
  usedFields: Set<string>
  onAdd: (payload: PalettePayload) => void
  onOpenDetailPicker: () => void
  onOpenFieldPicker: () => void
  idScope: string
}) {
  const shown = customFields.slice(0, PALETTE_FIELD_LIMIT)

  return (
    <div className="flex flex-col gap-4">
      <PaletteGroup title="Ask something new">
        {NEW_QUESTION_TYPES.map(t => (
          <PaletteItem
            key={t}
            dragId={`${idScope}:type:${t}`}
            payload={{ kind: 'type', type: t }}
            icon={TYPE_ICONS[t]}
            label={TYPE_LABELS[t]}
            // Deliberately NOT "Add question …" — the Questions header owns that
            // exact name (and one Playwright locator), so these must not collide.
            ariaLabel={`Add ${TYPE_LABELS[t]}`}
            onClick={() => onAdd({ kind: 'type', type: t })}
          />
        ))}
      </PaletteGroup>

      <PaletteGroup title="Keep it on their record">
        {/* The built-in details, as questions. They used to be configured on
            their own screen — but "the system fields are just a result of the
            forms" (Karl), so the form is what says they're asked for. */}
        <PaletteItem
          dragId={`${idScope}:detail-picker`}
          icon={UserSquare}
          label="Add a client detail"
          hint="Their name, phone, dog's breed…"
          ariaLabel="Add a client detail"
          onClick={onOpenDetailPicker}
        />
        {/* Making a field used to mean leaving the builder, creating it on
            another screen, and coming back to link it. */}
        <PaletteItem
          dragId={`${idScope}:new-field`}
          payload={{ kind: 'newField' }}
          icon={Plus}
          label="Add a saved field"
          hint="The answer sticks to their record"
          ariaLabel="Add a saved field"
          onClick={() => onAdd({ kind: 'newField' })}
        />
      </PaletteGroup>

      {customFields.length > 0 && (
        <PaletteGroup title="Your fields">
          {shown.map(f => {
            const already = usedFields.has(f.id)
            return (
              <PaletteItem
                key={f.id}
                dragId={`${idScope}:field:${f.id}`}
                payload={{ kind: 'savedField', customFieldId: f.id }}
                icon={Link2}
                label={f.label}
                hint={`${f.appliesTo === 'DOG' ? 'Dog' : 'Client'} · ${f.type.toLowerCase()}`}
                ariaLabel={`Add field ${f.label}`}
                disabled={already}
                disabledNote="Added"
                onClick={() => onAdd({ kind: 'savedField', customFieldId: f.id })}
              />
            )
          })}
          {/* Always offered, not just past the limit: the picker says what each
              field is about and which are already on the form. */}
          <PaletteItem
            dragId={`${idScope}:field-picker`}
            icon={Link2}
            label="Link a field"
            hint={customFields.length > PALETTE_FIELD_LIMIT
              ? `All ${customFields.length} of your fields`
              : 'Browse your saved fields'}
            ariaLabel="Link a field"
            onClick={onOpenFieldPicker}
          />
        </PaletteGroup>
      )}
    </div>
  )
}

// ─── The builder ─────────────────────────────────────────────────────────────

export function FormBuilder({
  // — the shell around it (status strip, error, Delete / Cancel / Save) —
  status,
  statusActions,
  error,
  onDelete,
  onCancel,
  onSave,
  saving,
  saveLabel,
  // — the questions —
  questions,
  onChange,
  customFields,
  showPrivateToggle = false,
  allowConditional = false,
  minQuestions = 0,
  activeStep = null,
  stepFallback = null,
  questionsTitle = 'Questions',
  questionsHint = 'Drag a question by its handle to reorder it.',
  // — the two panels —
  above,
  settings,
  wizard = false,
  settingsLabel = 'Settings',
}: {
  status?: FormEditorStatus
  statusActions?: ReactNode
  error?: string | null
  onDelete?: () => Promise<void> | void
  onCancel: () => void
  onSave: () => Promise<void> | void
  saving?: boolean
  saveLabel: string
  questions: Question[]
  onChange: (next: Question[]) => void
  customFields: CustomFieldOption[]
  showPrivateToggle?: boolean
  allowConditional?: boolean
  minQuestions?: number
  activeStep?: string | null
  stepFallback?: string | null
  questionsTitle?: string
  questionsHint?: string
  /** The form's own sections — name, where it's used, pages. Above the questions. */
  above?: ReactNode
  /**
   * Walk it in numbered steps instead of two tabs: the basics, then the
   * questions, then what happens afterwards.
   *
   * The rail is CLICKABLE, deliberately. A wizard that makes you pass through
   * four screens to change the invitation email is worse than the tabs it
   * replaced — this keeps the order for someone building their first form and
   * stays one click deep for someone fixing a typo in their tenth.
   */
  wizard?: boolean
  /** What happens after it is filled in. Omit for a form with nothing to configure. */
  settings?: ReactNode
  settingsLabel?: string
}) {
  const [tab, setTab] = useState<'build' | 'settings'>('build')
  // Wizard mode. 'after' only exists when there is something to configure.
  const wizardKeys: ('basics' | 'questions' | 'after')[] = [
    'basics', 'questions', ...(settings ? ['after' as const] : []),
  ]
  const [wstep, setWstep] = useState(0)
  const step = Math.min(wstep, wizardKeys.length - 1)
  const stepKey = wizardKeys[step]

  // What each mode shows. Non-wizard behaviour is exactly what it always was.
  const showAbove = wizard ? stepKey === 'basics' : tab === 'build'
  const showQuestions = wizard ? stepKey === 'questions' : tab === 'build'
  const showSettings = wizard ? stepKey === 'after' : tab === 'settings'
  const [paletteSheetOpen, setPaletteSheetOpen] = useState(false)
  const [fieldPickerOpen, setFieldPickerOpen] = useState(false)
  const [detailPickerOpen, setDetailPickerOpen] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const usedFields = usedCustomFieldIds(questions)
  const usedDetails = new Set(
    questions.filter(q => q.type === 'CLIENT_FIELD').map(q => (q as { fieldKey: string }).fieldKey)
  )

  // A new question joins the page you're looking at, so it doesn't silently
  // land on page one while you're editing page three.
  function withStep(q: Question): Question {
    return activeStep ? ({ ...q, step: activeStep } as Question) : q
  }

  function add(payload: PalettePayload, index?: number) {
    onChange(addQuestion(questions, withStep(makeQuestion(payload)), index))
    setPaletteSheetOpen(false)
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over) return
    const payload = active.data.current?.palette as PalettePayload | undefined
    if (payload) {
      // Dropped ON a question means "put it here"; dropped anywhere else on the
      // form means "put it at the end".
      const at = questions.findIndex(q => q.id === String(over.id))
      add(payload, at === -1 ? undefined : at)
      return
    }
    if (active.id === over.id || over.id === CANVAS_ID) return
    onChange(reorderQuestions(questions, String(active.id), String(over.id)))
  }

  const palette = (idScope: string) => (
    <Palette
      idScope={idScope}
      customFields={customFields}
      usedFields={usedFields}
      onAdd={add}
      onOpenDetailPicker={() => { setPaletteSheetOpen(false); setDetailPickerOpen(true) }}
      onOpenFieldPicker={() => { setPaletteSheetOpen(false); setFieldPickerOpen(true) }}
    />
  )

  return (
    <DndArea sensors={sensors} collisionDetection={questionsWinCollision} onDragEnd={onDragEnd}>
      {/* Which panel a review pin was made on — without this every pin on this
          screen collapses onto one indistinguishable page key (AGENTS.md). */}
      {/* The page chrome already centres this in a max-w-5xl column, so there is
          nothing to add here — what the wizard needed was the empty palette
          column GONE (see holdSidebarColumn), not another wrapper. */}
      <div
        data-review-scope={`Form builder: ${wizard ? WIZARD_LABELS[stepKey] : tab === 'build' ? 'Build' : settingsLabel}`}
      >
        {wizard && (
          <div className="mb-4 flex items-center gap-1.5 px-1">
            {wizardKeys.map((k, i) => (
              <div key={k} className="flex flex-1 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWstep(i)}
                  aria-current={i === step ? 'step' : undefined}
                  className="flex items-center gap-2 text-left"
                >
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    i < step ? 'bg-accent text-white'
                    : i === step ? 'bg-accent text-white ring-4 ring-accent/15'
                    : 'bg-slate-100 text-slate-400'
                  }`}>{i + 1}</span>
                  <span className={`hidden text-sm font-medium sm:block ${i === step ? 'text-slate-900' : 'text-slate-400'}`}>
                    {WIZARD_LABELS[k]}
                  </span>
                </button>
                {i < wizardKeys.length - 1 && (
                  <span className={`h-0.5 flex-1 rounded ${i < step ? 'bg-accent' : 'bg-slate-200'}`} />
                )}
              </div>
            ))}
          </div>
        )}
        {settings && !wizard && (
          <div className="mb-3 px-1">
            <FormSegmented
              ariaLabel="Form builder panel"
              value={tab}
              onChange={setTab}
              options={[
                { id: 'build' as const, label: 'Build' },
                { id: 'settings' as const, label: settingsLabel },
              ]}
            />
          </div>
        )}

        <FormEditorShell
          status={status}
          statusActions={statusActions}
          error={error}
          onDelete={onDelete}
          onCancel={onCancel}
          onSave={onSave}
          saving={saving}
          saveLabel={saveLabel}
          // The rail belongs to the form, not to its settings — there is nothing
          // on the Settings panel to drag a field onto.
          sidebar={showQuestions ? palette('rail') : undefined}
          // A wizard step with no palette should not sit beside a column-shaped
          // hole — see the prop's own note.
          holdSidebarColumn={!wizard}
        >
          {(showQuestions || showAbove) ? (
            <>
              {showAbove && above}
              {showQuestions && (
              <FormEditorSection
                title={questionsTitle}
                hint={questionsHint}
                action={
                  <>
                    {/* Append-to-the-end, sitting with the list it appends to.
                        The rail's rows are "add THIS kind, HERE"; this is the
                        no-decision one. */}
                    <button
                      type="button"
                      onClick={() => add({ kind: 'type', type: 'LONG_TEXT' })}
                      className={FORM_QUIET_ACTION}
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Add question
                    </button>
                    {/* Phones have no rail, so this is where the palette lives. */}
                    <button
                      type="button"
                      onClick={() => setPaletteSheetOpen(true)}
                      className={`${FORM_QUIET_ACTION} lg:hidden`}
                    >
                      <List className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Add a field
                    </button>
                  </>
                }
              >
                <FormCanvas>
                  <QuestionList
                    questions={questions}
                    onChange={onChange}
                    customFields={customFields}
                    showPrivateToggle={showPrivateToggle}
                    allowConditional={allowConditional}
                    minQuestions={minQuestions}
                    activeStep={activeStep}
                    stepFallback={stepFallback}
                  />
                </FormCanvas>
              </FormEditorSection>
              )}
            </>
          ) : null}
          {showSettings && settings}

          {wizard && (
            <div className="md:col-span-2 mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setWstep(s => Math.max(0, s - 1))}
                disabled={step === 0}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
              >
                Back
              </button>
              {step < wizardKeys.length - 1 ? (
                <button
                  type="button"
                  onClick={() => setWstep(s => Math.min(wizardKeys.length - 1, s + 1))}
                  className="rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                >
                  Next: {WIZARD_LABELS[wizardKeys[step + 1]]}
                </button>
              ) : (
                // Save lives in the shell's action bar and is reachable from
                // every step, so the last one does not need its own.
                <span className="text-sm text-slate-400">That's everything — Save when you're ready.</span>
              )}
            </div>
          )}
        </FormEditorShell>
      </div>

      {paletteSheetOpen && (
        <FullScreenSheet
          title="Add a field"
          sub="Tap one to add it to the end of your form"
          onClose={() => setPaletteSheetOpen(false)}
        >
          {palette('sheet')}
        </FullScreenSheet>
      )}

      {fieldPickerOpen && (
        <CustomFieldPicker
          customFields={customFields}
          used={usedFields}
          onPick={f => {
            add({ kind: 'savedField', customFieldId: f.id })
            setFieldPickerOpen(false)
          }}
          onClose={() => setFieldPickerOpen(false)}
        />
      )}

      {detailPickerOpen && (
        <ClientDetailPicker
          used={usedDetails}
          onPick={key => {
            add({ kind: 'clientDetail', fieldKey: key })
            setDetailPickerOpen(false)
          }}
          onClose={() => setDetailPickerOpen(false)}
        />
      )}
    </DndArea>
  )
}

/** The drop target of last resort — see CANVAS_ID. */
/** What each step is called, in the rail and to the review widget. */
const WIZARD_LABELS: Record<'basics' | 'questions' | 'after', string> = {
  basics: 'The basics',
  questions: 'The questions',
  after: 'What happens next',
}

function FormCanvas({ children }: { children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: CANVAS_ID })
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl transition-colors ${isOver ? 'bg-[var(--pm-brand-50)]' : ''}`}
    >
      {children}
    </div>
  )
}
