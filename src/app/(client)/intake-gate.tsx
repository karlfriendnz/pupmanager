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

interface CoreContact {
  name: string
  email: string
  phone: string
}

type SystemFieldKey = 'name' | 'email' | 'phone'
type SystemFieldSections = Partial<Record<SystemFieldKey, string | null>>

interface Props {
  businessName: string
  /** The trainer's logo URL — displayed prominently above the form
   *  so the client sees their trainer's brand, not PupManager's. */
  trainerLogoUrl: string | null
  customFields: CustomField[]
  sectionMeta: SectionMeta[]
  dogs: Dog[]
  existingValues: Record<string, string>
  /** Current values for the client's core contact details (User.name,
   *  User.email, ClientProfile.phone). Email is shown read-only —
   *  the client signed in with it. */
  coreContact: CoreContact
  /** Where to render each of the three system fields. Each value is
   *  the name of a section in sectionMeta or null/missing for orphan
   *  (= rendered above the headless / first orphan step). The trainer
   *  configures this on /forms/intake. */
  systemFieldSections: SystemFieldSections
  // When true: don't POST to /api/my/field-values on submit, just show a
  // confirmation. Used by the trainer's preview page so they can walk through
  // the form without saving anything.
  preview?: boolean
  onPreviewExit?: () => void
}

// One stepped page in the intake flow. Either an owner-side section, or a
// dog-side section (scoped to a single dog), or a single mixed page when
// the trainer hasn't defined any sections at all. `valueKey` is how each
// field's answer is keyed in the values map (owner = fieldId, dog =
// `${fieldId}:${dogId}`). title=null = render the page without an
// eyebrow + heading (the "no sections" experience).
interface Step {
  id: string
  title: string | null
  subtitle: string | null
  description: string | null
  fields: { field: CustomField; valueKey: string }[]
}

// Group a slice of fields by section. ONLY sections the trainer has
// explicitly added to their intakeSectionOrder count — anything else
// (a leftover `category` value from before sections were added,
// stale seed data, etc.) collapses into a single trailing orphan
// bucket with `section: null`. The previous behaviour created a
// section per unique category which surprised trainers: their
// "Fields without a section" panel showed 36 fields, but the client
// saw 5 pages because of dormant category values.
function groupBySection(fields: CustomField[], sectionMeta: SectionMeta[]) {
  const result: { section: string | null; description: string | null; fields: CustomField[] }[] = []
  const definedNames = new Set(sectionMeta.map(s => s.name))

  for (const meta of sectionMeta) {
    const matching = fields.filter(f => f.category === meta.name)
    if (matching.length === 0) continue
    result.push({ section: meta.name, description: meta.description, fields: matching })
  }

  // Anything not in a defined section is an orphan, regardless of
  // whether it has a stale category value.
  const orphans = fields.filter(f => {
    const cat = f.category?.trim()
    return !cat || !definedNames.has(cat)
  })
  if (orphans.length > 0) {
    result.push({ section: null, description: null, fields: orphans })
  }
  return result
}

function buildSteps(customFields: CustomField[], dogs: Dog[], sectionMeta: SectionMeta[]): Step[] {
  const ownerFields = customFields.filter(f => f.appliesTo === 'OWNER')
  const dogFields = customFields.filter(f => f.appliesTo === 'DOG')

  // No sections defined → ONE big headless page with every field on
  // it (owner first, then dog fields per dog). Matches the trainer's
  // mental model: "if I haven't put fields in sections, my client
  // sees one form."
  if (sectionMeta.length === 0) {
    const fields = [
      ...ownerFields.map(f => ({ field: f, valueKey: f.id })),
      ...dogs.flatMap(dog => dogFields.map(f => ({ field: f, valueKey: `${f.id}:${dog.id}` }))),
    ]
    if (fields.length === 0) return []
    return [{
      id: 'all',
      title: null,
      subtitle: null,
      description: null,
      fields,
    }]
  }

  // Sections defined → one step per (scope × section). Orphan fields
  // (category not in any defined section) get their own trailing
  // headless step so they're not dropped on the floor.
  const steps: Step[] = []

  for (const group of groupBySection(ownerFields, sectionMeta)) {
    steps.push({
      id: `owner:${group.section ?? '__orphans__'}`,
      title: group.section,
      subtitle: group.section ? 'About you' : null,
      description: group.description,
      fields: group.fields.map(f => ({ field: f, valueKey: f.id })),
    })
  }

  for (const dog of dogs) {
    for (const group of groupBySection(dogFields, sectionMeta)) {
      steps.push({
        id: `dog:${dog.id}:${group.section ?? '__orphans__'}`,
        title: group.section,
        subtitle: group.section ? `About ${dog.name}` : null,
        description: group.description,
        fields: group.fields.map(f => ({ field: f, valueKey: `${f.id}:${dog.id}` })),
      })
    }
  }

  return steps
}

export function IntakeGate({ businessName, trainerLogoUrl, customFields, sectionMeta, dogs, existingValues, coreContact, systemFieldSections, preview = false, onPreviewExit }: Props) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(existingValues)
  const [contact, setContact] = useState<CoreContact>(coreContact)
  const [stepIndex, setStepIndex] = useState(0)
  const [saving, setSaving] = useState(false)
  const [previewDone, setPreviewDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const steps = useMemo(() => buildSteps(customFields, dogs, sectionMeta), [customFields, dogs, sectionMeta])
  // Build the list of system fields to slot into THIS step. A system
  // field assigned to section "About you" appears in the owner-step
  // for that section; an unassigned (orphan) system field appears in
  // the first step.
  // If the trainer has no custom fields at all, we still need a
  // one-step experience so the client can submit their contact
  // details — synthesise a single headless contact-only step.
  const effectiveSteps: Step[] = steps.length > 0 ? steps : [{
    id: 'contact-only',
    title: null,
    subtitle: null,
    description: null,
    fields: [],
  }]
  const totalSteps = effectiveSteps.length
  const currentStep = effectiveSteps[stepIndex]
  const isLast = stepIndex === totalSteps - 1
  const isFirst = stepIndex === 0

  // Decide which (if any) system fields render on the current step.
  // A system field's section is matched against its step's title;
  // unassigned system fields fall to the first step. If a trainer has
  // assigned a system field to a section that no longer exists, treat
  // it as orphan (first step) so the client never loses access to a
  // required field.
  const systemFieldsOnThisStep = useMemo(() => {
    const sectionExists = (name: string | null | undefined) =>
      !!name && sectionMeta.some(s => s.name === name)
    function targetStepIndex(key: SystemFieldKey): number {
      const assigned = systemFieldSections[key] ?? null
      if (!sectionExists(assigned)) return 0 // orphan
      return effectiveSteps.findIndex(s => s.title === assigned) ?? 0
    }
    const keys: SystemFieldKey[] = ['name', 'email', 'phone']
    return keys.filter(k => {
      const idx = targetStepIndex(k)
      return (idx === -1 ? 0 : idx) === stepIndex
    })
  }, [systemFieldSections, sectionMeta, effectiveSteps, stepIndex])
  const showContactOnThisStep = systemFieldsOnThisStep.length > 0

  function setValue(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  // Required-field check scoped to the current step only. Skipped in
  // preview — the trainer is just walking through their form, not
  // submitting answers, so making them fill every required field
  // before they can advance is friction with no payoff.
  function validateCurrentStep(): string | null {
    if (preview) return null
    const missing: string[] = []
    for (const k of systemFieldsOnThisStep) {
      if (k === 'email') continue // read-only, always populated
      if (!contact[k].trim()) missing.push(k === 'name' ? 'Name' : 'Phone')
    }
    if (currentStep) {
      for (const { field, valueKey } of currentStep.fields) {
        if (field.required && !values[valueKey]?.trim()) missing.push(field.label)
      }
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

    // Save core contact (User.name + ClientProfile.phone) first so a
    // partial failure leaves the trainer with at least a reachable
    // client. Email is read-only here — the client signed in with it.
    const contactRes = await fetch('/api/my/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: contact.name.trim(), phone: contact.phone.trim() || null }),
    })
    if (!contactRes.ok) {
      setError('Something went wrong saving your details. Please try again.')
      setSaving(false)
      return
    }

    const payload = Object.entries(values)
      .filter(([, v]) => v.trim())
      .map(([key, value]) => {
        const [fieldId, dogId] = key.split(':')
        return { fieldId, value, dogId: dogId ?? null }
      })

    if (payload.length > 0) {
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
    }
    router.refresh()
  }

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
        {/* Header — trainer logo big and centred above the title. The
            page is unbranded by PupManager (no top nav, no bottom
            bar), so the trainer's logo is the first thing the client
            sees, framing the whole form as theirs. */}
        <div className="text-center mb-6">
          {trainerLogoUrl && (
            // No crop, no border. Trainer logos can be wordmarks /
            // non-square brand marks; forcing object-cover into a
            // square hacks them off. Bound the height + max width and
            // let the image keep its real aspect.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={trainerLogoUrl}
              alt={businessName}
              className="mx-auto mb-4 h-24 w-auto max-w-[280px] object-contain"
            />
          )}
          <p className="text-sm font-medium text-blue-600 mb-2">{businessName}</p>
          <h1 className="text-2xl font-bold text-slate-900">Before you get started</h1>
        </div>

        {/* Progress: dots + label. Hidden when there's only one
            step — single-page experience reads cleanest without a
            "Step 1 of 1" indicator. */}
        {totalSteps > 1 && (
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
        )}

        {/* Current section card. Headless step (no title) — typically
            the single-page "no sections" experience or a trailing
            orphan bucket — renders without the eyebrow/heading/
            description so the form just looks like a clean list of
            fields without manufactured chrome. */}
        {currentStep && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-4">
            {currentStep.subtitle && (
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                {currentStep.subtitle}
              </p>
            )}
            {currentStep.title && (
              <h2 className="font-semibold text-slate-900 text-lg -mt-2">{currentStep.title}</h2>
            )}
            {currentStep.description && (
              <p className="text-sm text-slate-500 -mt-1 leading-relaxed">{currentStep.description}</p>
            )}
            {/* System fields (name/email/phone) — only the ones the
                trainer assigned to THIS step's section render here.
                Email is read-only because the client signed in with
                it; name + phone write back to User.name +
                ClientProfile.phone via /api/my/profile on submit. */}
            {systemFieldsOnThisStep.includes('name') && (
              <ContactField
                label="Name"
                required
                value={contact.name}
                onChange={v => setContact(c => ({ ...c, name: v }))}
                placeholder="Your full name"
              />
            )}
            {systemFieldsOnThisStep.includes('email') && (
              <ContactField
                label="Email"
                required
                readOnly
                value={contact.email}
                onChange={() => {}}
                type="email"
              />
            )}
            {systemFieldsOnThisStep.includes('phone') && (
              <ContactField
                label="Phone"
                required
                value={contact.phone}
                onChange={v => setContact(c => ({ ...c, phone: v }))}
                type="tel"
                placeholder="So your trainer can reach you"
              />
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

function ContactField({
  label,
  value,
  onChange,
  required = false,
  readOnly = false,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  readOnly?: boolean
  type?: 'text' | 'email' | 'tel'
  placeholder?: string
}) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={e => onChange(e.target.value)}
        className={
          readOnly
            ? 'h-12 w-full rounded-xl border border-slate-200 bg-slate-50 text-slate-500 px-3 text-sm'
            : 'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
        }
        placeholder={placeholder}
      />
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
