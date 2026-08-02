'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RichText } from '@/components/shared/rich-text'
import { clientFieldLabel, clientFieldInputType } from '@/lib/client-fields'
import { hasOptions, isQuestionVisible } from '@/lib/session-form-builder'
import type { FormStep, Question } from '@/lib/session-form-builder'
import { PublicFormShell } from '@/components/shared/public-form-shell'

/**
 * The one renderer for a unified Form, wherever a person fills it in.
 *
 * A Form meets a person in exactly two places — as a client's intake gate
 * after they're invited, and as a public enquiry form on the trainer's own
 * site. They are the same questions, the same pages and the same conditional
 * logic, so they are the same component. The only difference is that the
 * public one has to collect a real contact up front (an enquiry is worthless
 * without a name and an email to reply to), which is `contactBlock`.
 *
 * Styled to match the existing client-facing forms — `rounded-2xl border
 * border-slate-200`, the shared `Button`, and the trainer's brand carried in
 * via the `--accent` custom property by the page that renders this.
 */

export interface LinkedField {
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  options: string[]
}

export type Answer = string | string[]
export type Answers = Record<string, Answer>

export interface RunnableForm {
  id: string
  name: string
  description: string | null
  questions: Question[]
  steps: FormStep[]
}

const INPUT_CLASS =
  'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent,#2563eb)]'

export function FormRunner({
  form,
  linkedFields,
  businessName,
  trainerLogoUrl,
  heading,
  showBorder = true,
  submitLabel = 'Submit',
  contactBlock,
  validateFirstStep,
  onSubmit,
}: {
  form: RunnableForm
  /** CustomField id → its label/type/options, for CUSTOM_FIELD questions. */
  linkedFields: Record<string, LinkedField>
  businessName: string
  trainerLogoUrl: string | null
  heading: string
  showBorder?: boolean
  submitLabel?: string
  /** Rendered above the questions on the first page (the enquiry contact). */
  contactBlock?: React.ReactNode
  /** Extra validation for the first page — returns an error, or null. */
  validateFirstStep?: () => string | null
  /** Resolve to an error string to show it; resolve to null on success. */
  onSubmit: (answers: Answers) => Promise<string | null>
}) {
  const [answers, setAnswers] = useState<Answers>({})
  const [stepIndex, setStepIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const steps = form.steps.length ? form.steps : [{ id: '__single', title: form.name }]
  const activeStepId = form.steps.length ? steps[stepIndex].id : null
  const isFirst = stepIndex === 0
  const isLast = stepIndex >= steps.length - 1

  // Questions on this page that the answers so far have revealed. A question
  // with no `step` belongs to page one, so a form that gained its pages after
  // its questions doesn't strand them.
  const visible = useMemo(
    () =>
      form.questions.filter(q => {
        const onStep = form.steps.length ? (q.step ?? form.steps[0]?.id) === activeStepId : true
        return onStep && isQuestionVisible(q, answers)
      }),
    [form.questions, form.steps, activeStepId, answers],
  )

  // A linked question is looked up by its field id. A saved form always has one
  // (the server normalises the link on write); the `?? ''` is only so an
  // in-flight builder question can't index with undefined.
  function label(q: Question): string {
    if (q.type === 'CUSTOM_FIELD') return linkedFields[q.customFieldId ?? '']?.label ?? 'Field'
    // A built-in detail is named by the app, not by the trainer — the same words
    // wherever it's asked for.
    if (q.type === 'CLIENT_FIELD') return clientFieldLabel(q.fieldKey)
    return q.label
  }
  function optionsFor(q: Question): string[] {
    if (q.type === 'CUSTOM_FIELD') return linkedFields[q.customFieldId ?? '']?.options ?? []
    return hasOptions(q) ? q.options : []
  }
  function typeOf(q: Question): string {
    if (q.type === 'CUSTOM_FIELD') return linkedFields[q.customFieldId ?? '']?.type ?? 'TEXT'
    // Its input shape comes from the detail itself: an email box for an email, a
    // date picker for a birthday.
    if (q.type === 'CLIENT_FIELD') return clientFieldInputType(q.fieldKey)
    return q.type
  }
  function set(id: string, v: Answer) {
    setAnswers(a => ({ ...a, [id]: v }))
    setError(null)
  }

  function isAnswered(q: Question): boolean {
    const v = answers[q.id]
    if (Array.isArray(v)) return v.length > 0
    return !!(v && String(v).trim())
  }

  // Only what's ON SCREEN is validated — a required question hidden by its own
  // condition must never block the form, or an unanswerable question would
  // trap the person filling it in.
  function validateStep(): boolean {
    if (isFirst && validateFirstStep) {
      const problem = validateFirstStep()
      if (problem) { setError(problem); return false }
    }
    for (const q of visible) {
      if (q.required && !isAnswered(q)) { setError(`Please answer: ${label(q)}`); return false }
    }
    return true
  }

  async function next() {
    if (!validateStep()) return
    if (!isLast) {
      setStepIndex(i => i + 1)
      window.scrollTo(0, 0)
      return
    }
    setSubmitting(true)
    const problem = await onSubmit(answers)
    if (problem) {
      setError(problem)
      setSubmitting(false)
    }
  }

  const cardClass = showBorder
    ? 'bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-5'
    : 'flex flex-col gap-5'

  return (
    <PublicFormShell
      businessName={businessName}
      trainerLogoUrl={trainerLogoUrl}
      heading={heading}
      // Progress — hidden on a single-page form, where "Step 1 of 1" is noise.
      progress={{ index: stepIndex, total: steps.length }}
      reviewScope={`Step ${stepIndex + 1} of ${steps.length} · ${steps[stepIndex].title}`}
    >
      <>

        <div className={cardClass}>
          {steps.length > 1 && (
            <h2 className="-mb-1 text-lg font-semibold text-slate-900">{steps[stepIndex].title}</h2>
          )}
          {isFirst && form.description && (
            <RichText html={form.description} className="-mt-1 text-sm leading-relaxed text-slate-500" />
          )}

          {isFirst && contactBlock}

          {visible.map(q => (
            <div key={q.id}>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {label(q)}
                {q.required && <span className="ml-1 text-red-500">*</span>}
              </label>
              <AnswerInput
                type={typeOf(q)}
                options={optionsFor(q)}
                value={answers[q.id]}
                onChange={v => set(q.id, v)}
                ariaLabel={label(q)}
              />
            </div>
          ))}

          {visible.length === 0 && !contactBlock && (
            <p className="text-sm text-slate-400">Nothing to fill in on this page.</p>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center gap-3">
          {!isFirst && (
            <Button
              variant="ghost"
              size="lg"
              onClick={() => { setStepIndex(i => i - 1); setError(null) }}
              disabled={submitting}
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          <Button size="lg" className="flex-1" onClick={next} loading={submitting}>
            {isLast ? <Check className="h-4 w-4" /> : null}
            {isLast ? submitLabel : 'Next'}
            {!isLast && <ArrowRight className="h-4 w-4" />}
          </Button>
        </div>
      </>
    </PublicFormShell>
  )
}

/** One answer control. `type` is a QuestionType, or a CustomField type. */
export function AnswerInput({
  type,
  options,
  value,
  onChange,
  ariaLabel,
}: {
  type: string
  options: string[]
  value: Answer | undefined
  onChange: (v: Answer) => void
  ariaLabel?: string
}) {
  const s = typeof value === 'string' ? value : ''

  switch (type) {
    case 'LONG_TEXT':
      return (
        <textarea
          value={s}
          onChange={e => onChange(e.target.value)}
          rows={3}
          aria-label={ariaLabel}
          className={`${INPUT_CLASS} h-auto py-2.5`}
        />
      )
    case 'NUMBER':
      return (
        <input type="number" value={s} onChange={e => onChange(e.target.value)} aria-label={ariaLabel} className={INPUT_CLASS} />
      )
    case 'RATING_1_5':
      return (
        <div className="flex gap-1.5" role="radiogroup" aria-label={ariaLabel}>
          {[1, 2, 3, 4, 5].map(n => {
            const on = s === String(n)
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(String(n))}
                className={`h-12 w-12 rounded-xl border text-sm font-semibold ${
                  on
                    ? 'border-[var(--accent,#2563eb)] bg-[var(--accent,#2563eb)] text-white'
                    : 'border-slate-200 bg-white text-slate-600'
                }`}
              >
                {n}
              </button>
            )
          })}
        </div>
      )
    case 'DROPDOWN':
      return (
        <select value={s} onChange={e => onChange(e.target.value)} aria-label={ariaLabel} className={INPUT_CLASS}>
          <option value="">Select…</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    case 'RADIO':
      return (
        <div className="flex flex-col gap-1.5">
          {options.map(o => (
            <label
              key={o}
              className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
                s === o ? 'border-[var(--accent,#2563eb)] bg-white' : 'border-slate-200 bg-white'
              }`}
            >
              <input type="radio" checked={s === o} onChange={() => onChange(o)} className="h-4 w-4" />
              {o}
            </label>
          ))}
        </div>
      )
    case 'CHECKBOX': {
      const arr = Array.isArray(value) ? value : []
      return (
        <div className="flex flex-col gap-1.5">
          {options.map(o => {
            const on = arr.includes(o)
            return (
              <label
                key={o}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-3 text-sm ${
                  on ? 'border-[var(--accent,#2563eb)] bg-white' : 'border-slate-200 bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onChange(on ? arr.filter(x => x !== o) : [...arr, o])}
                  className="h-4 w-4"
                />
                {o}
              </label>
            )
          })}
        </div>
      )
    }
    default:
      return (
        <input type="text" value={s} onChange={e => onChange(e.target.value)} aria-label={ariaLabel} className={INPUT_CLASS} />
      )
  }
}
