'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'

interface CustomField {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  required: boolean
  options: string[]
  category: string | null
  appliesTo: 'OWNER' | 'DOG'
}

interface Dog {
  id: string
  name: string
}

interface SectionMeta {
  name: string
  description: string | null
}

interface Props {
  businessName: string
  customFields: CustomField[]
  sectionMeta: SectionMeta[]
  dogs: Dog[]
  existingValues: Record<string, string>
  // When true: don't POST to /api/my/field-values on submit, just show a
  // confirmation. Used by the trainer's preview page so they can walk through
  // the form without saving anything.
  preview?: boolean
  onPreviewExit?: () => void
}

// One stepped page in the intake flow. Either an owner-side section, or a
// dog-side section (scoped to a single dog). `valueKey` is how each field's
// answer is keyed in the values map (owner = fieldId, dog = `${fieldId}:${dogId}`).
interface Step {
  id: string
  title: string
  subtitle: string | null
  description: string | null
  fields: { field: CustomField; valueKey: string }[]
}

const DEFAULT_SECTION = 'General'

function groupBySection(fields: CustomField[], sectionMeta: SectionMeta[]) {
  // Build a section list ordered by the trainer's sectionMeta, then append
  // any sections present in field categories but missing from sectionMeta
  // (legacy data) — and finally a "General" bucket for orphan fields.
  const orderedNames = sectionMeta.map(s => s.name)
  const seen = new Set<string>()
  const result: { section: string; description: string | null; fields: CustomField[] }[] = []

  for (const meta of sectionMeta) {
    const matching = fields.filter(f => f.category === meta.name)
    if (matching.length === 0) continue
    seen.add(meta.name)
    result.push({ section: meta.name, description: meta.description, fields: matching })
  }
  for (const f of fields) {
    const key = f.category?.trim()
    if (key && !seen.has(key) && !orderedNames.includes(key)) {
      seen.add(key)
      result.push({ section: key, description: null, fields: fields.filter(x => x.category === key) })
    }
  }
  const orphans = fields.filter(f => !f.category?.trim())
  if (orphans.length > 0) {
    result.push({ section: DEFAULT_SECTION, description: null, fields: orphans })
  }
  return result
}

function buildSteps(customFields: CustomField[], dogs: Dog[], sectionMeta: SectionMeta[]): Step[] {
  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields = customFields.filter(f => f.appliesTo === 'DOG')

  const steps: Step[] = []

  for (const group of groupBySection(ownerFields, sectionMeta)) {
    steps.push({
      id: `owner:${group.section}`,
      title: group.section,
      subtitle: 'About you',
      description: group.description,
      fields: group.fields.map(f => ({ field: f, valueKey: f.id })),
    })
  }

  for (const dog of dogs) {
    for (const group of groupBySection(dogFields, sectionMeta)) {
      steps.push({
        id: `dog:${dog.id}:${group.section}`,
        title: group.section,
        subtitle: `About ${dog.name}`,
        description: group.description,
        fields: group.fields.map(f => ({ field: f, valueKey: `${f.id}:${dog.id}` })),
      })
    }
  }

  return steps
}

export function IntakeGate({ businessName, customFields, sectionMeta, dogs, existingValues, preview = false, onPreviewExit }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(existingValues)
  const [stepIndex, setStepIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [previewDone, setPreviewDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = useMemo(() => buildSteps(customFields, dogs, sectionMeta), [customFields, dogs, sectionMeta])
  const totalSteps = steps.length
  const currentStep = steps[stepIndex]
  const isLast = stepIndex === totalSteps - 1
  const isFirst = stepIndex === 0

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  // Required-field check scoped to the current step only.
  function validateCurrentStep(): string | null {
    if (!currentStep) return null
    const missing: string[] = []
    for (const { field, valueKey } of currentStep.fields) {
      if (field.required && !values[valueKey]?.trim()) missing.push(field.label)
    }
    return missing.length > 0 ? `Please fill in: ${missing.join(', ')}` : null
  }

  function handleNext() {
    const validationError = validateCurrentStep()
    if (validationError) { setError(validationError); return }
    setError(null)
    setStepIndex(i => Math.min(i + 1, totalSteps - 1))
  }

  function handleBack() {
    setError(null)
    setStepIndex(i => Math.max(i - 1, 0))
  }

  async function handleSubmit() {
    const validationError = validateCurrentStep()
    if (validationError) { setError(validationError); return }
    if (preview) {
      setPreviewDone(true)
      return
    }
    setSaving(true)
    setError(null)

    const payload = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([key, value]) => {
        const [fieldId, dogId] = key.split(':')
        return { fieldId, value, dogId: dogId ?? null }
      })

    const res = await fetch('/api/my/field-values', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: payload }),
    })

    if (!res.ok) {
      setError('Something went wrong. Please try again.')
      setSaving(false)
      return
    }
    router.refresh()
  }

  if (totalSteps === 0) return null

  if (preview && previewDone) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center py-12 px-4">
        <div className="w-full max-w-md text-center bg-white rounded-2xl border border-slate-200 p-8">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
            <Check className="h-7 w-7" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">All sections complete</h2>
          <p className="text-sm text-slate-500 mt-2">
            This is what your client would see at the end of your intake form.
          </p>
          {onPreviewExit && (
            <Button size="sm" className="mt-5" onClick={onPreviewExit}>Back to editor</Button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-start py-12 px-4">
      <div className="w-full max-w-xl">
        {preview && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-2.5">
            <p className="text-xs font-semibold text-amber-700">
              PREVIEW · this is how clients will see your intake form
            </p>
            {onPreviewExit && (
              <button
                type="button"
                onClick={onPreviewExit}
                className="text-xs font-medium text-amber-800 hover:underline"
              >
                Exit preview
              </button>
            )}
          </div>
        )}
        {/* Header */}
        <div className="text-center mb-6">
          <p className="text-sm font-medium text-blue-600 mb-2">{businessName}</p>
          <h1 className="text-2xl font-bold text-slate-900">Before you get started</h1>
          <p className="text-slate-500 mt-2 text-sm">
            Your trainer has a few questions to help them support you and your dog better.
          </p>
        </div>

        {/* Progress: dots + label */}
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <div
                key={s.id}
                aria-hidden
                className={
                  i < stepIndex ? 'h-1.5 w-6 rounded-full bg-emerald-500'
                  : i === stepIndex ? 'h-1.5 w-8 rounded-full bg-blue-600'
                  : 'h-1.5 w-6 rounded-full bg-slate-200'
                }
              />
            ))}
          </div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
            Step {stepIndex + 1} of {totalSteps}
          </p>
        </div>

        {/* Current section card */}
        {currentStep && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4">
            {currentStep.subtitle && (
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                {currentStep.subtitle}
              </p>
            )}
            <h2 className="font-semibold text-slate-900 text-lg -mt-2">{currentStep.title}</h2>
            {currentStep.description && (
              <p className="text-sm text-slate-500 -mt-1 leading-relaxed">{currentStep.description}</p>
            )}
            {currentStep.fields.map(({ field, valueKey }) => (
              <FieldInput
                key={valueKey}
                field={field}
                value={values[valueKey] ?? ''}
                onChange={v => setValue(valueKey, v)}
              />
            ))}
          </div>
        )}

        {error && (
          <p className="mt-4 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            {error}
          </p>
        )}

        {/* Navigation */}
        <div className="mt-6 flex items-center gap-3">
          {!isFirst && (
            <Button variant="ghost" size="lg" onClick={handleBack} disabled={saving}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
          {isLast ? (
            <Button size="lg" className="flex-1" onClick={handleSubmit} loading={saving}>
              <Check className="h-4 w-4" />
              Save and continue
            </Button>
          ) : (
            <Button size="lg" className="flex-1" onClick={handleNext}>
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">
        {field.label}
        {field.required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {field.type === 'DROPDOWN' ? (
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Select...</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      ) : (
        <input
          type={field.type === 'NUMBER' ? 'number' : 'text'}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder={field.required ? 'Required' : 'Optional'}
        />
      )}
    </div>
  )
}
