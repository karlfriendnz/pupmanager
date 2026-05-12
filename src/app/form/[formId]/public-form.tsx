'use client'

import { useState } from 'react'
import { CheckCircle, AlertCircle } from 'lucide-react'

interface CustomField {
  id: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DROPDOWN'
  required: boolean
  options: string[]
}

interface Props {
  formId: string
  description: string | null
  thankYouTitle: string | null
  thankYouMessage: string | null
  /** Trainer-controlled: draw a slate-200 border around the field
   *  groups. Off when the trainer's site already provides framing. */
  showBorder: boolean
  /** Hex string override for the submit button. null → platform blue. */
  buttonColor: string | null
  fields: { key: string; required: boolean }[]
  customFields: CustomField[]
}

const DEFAULT_BUTTON_COLOR = '#2563eb'

const FIELD_LABELS: Record<string, string> = {
  phone: 'Phone number',
  message: 'Message',
}

export function PublicForm({
  formId,
  description,
  thankYouTitle,
  thankYouMessage,
  showBorder,
  buttonColor,
  fields,
  customFields,
}: Props) {
  // Border classes are computed once so both field-group cards stay in
  // sync. When the trainer turns the border off, drop the background +
  // padding too so the page bleed-through looks intentional.
  const cardClass = showBorder
    ? 'bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4'
    : 'flex flex-col gap-4'
  const submitColor = buttonColor ?? DEFAULT_BUTTON_COLOR
  const [values, setValues] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set(key: string, val: string) {
    setValues(prev => ({ ...prev, [key]: val }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Client-side required validation
    if (!values.name?.trim()) { setError('Full name is required.'); return }
    if (!values.email?.trim()) { setError('Email address is required.'); return }
    for (const f of fields) {
      if (f.required && !values[f.key]?.trim()) {
        setError(`${FIELD_LABELS[f.key] ?? f.key} is required.`)
        return
      }
    }
    for (const cf of customFields) {
      if (cf.required && !values[`cf_${cf.id}`]?.trim()) {
        setError(`${cf.label} is required.`)
        return
      }
    }

    setSubmitting(true)

    const customFieldValues: Record<string, string> = {}
    for (const cf of customFields) {
      const val = values[`cf_${cf.id}`]
      if (val?.trim()) customFieldValues[cf.id] = val.trim()
    }

    const res = await fetch(`/api/form/${formId}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name?.trim(),
        email: values.email?.trim(),
        phone: values.phone?.trim() || null,
        message: values.message?.trim() || null,
        customFields: Object.keys(customFieldValues).length > 0 ? customFieldValues : undefined,
      }),
    })

    if (!res.ok) {
      const body = await res.json()
      setError(body.error ?? 'Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    setSubmitted(true)
  }

  // Strip any legacy dog* keys that might still be in saved form configs from
  // before those were removed as standard fields.
  const otherFields = fields.filter(f => f.key !== 'dogName' && f.key !== 'dogBreed' && f.key !== 'dogWeight' && f.key !== 'dogDob')

  if (submitted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="p-8 max-w-md w-full text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 mx-auto mb-4">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">{thankYouTitle || `You're registered!`}</h2>
          <p className="text-slate-500 text-sm">
            {thankYouMessage || `Thanks for registering. Check your email — we've sent you a link to access your training diary.`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-start py-10 px-4">
      <div className="w-full max-w-lg">
        {description && (
          <p className="text-slate-500 text-sm mb-6">{description}</p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Always-shown fields */}
          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Your details</h2>
            <Field label="Full name" required>
              <input
                type="text"
                value={values.name ?? ''}
                onChange={e => set('name', e.target.value)}
                placeholder="Jane Smith"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            <Field label="Email address" required>
              <input
                type="email"
                value={values.email ?? ''}
                onChange={e => set('email', e.target.value)}
                placeholder="jane@example.com"
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </Field>
            {otherFields.map(f => (
              <Field key={f.key} label={FIELD_LABELS[f.key]} required={f.required}>
                {f.key === 'message' ? (
                  <textarea
                    value={values[f.key] ?? ''}
                    onChange={e => set(f.key, e.target.value)}
                    rows={3}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    placeholder={f.required ? 'Required' : 'Optional'}
                  />
                ) : (
                  <input
                    type={f.key === 'phone' ? 'tel' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={e => set(f.key, e.target.value)}
                    placeholder={f.required ? 'Required' : 'Optional'}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
              </Field>
            ))}
          </div>

          {/* Custom fields */}
          {customFields.length > 0 && (
            <div className={cardClass}>
              <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Additional information</h2>
              {customFields.map(cf => (
                <Field key={cf.id} label={cf.label} required={cf.required}>
                  {cf.type === 'DROPDOWN' ? (
                    <select
                      value={values[`cf_${cf.id}`] ?? ''}
                      onChange={e => set(`cf_${cf.id}`, e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Select…</option>
                      {cf.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                    </select>
                  ) : (
                    <input
                      type={cf.type === 'NUMBER' ? 'number' : 'text'}
                      value={values[`cf_${cf.id}`] ?? ''}
                      onChange={e => set(`cf_${cf.id}`, e.target.value)}
                      placeholder={cf.required ? 'Required' : 'Optional'}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </Field>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-600">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            // Inline background so trainer-picked hex colours work
            // without precompiling a Tailwind class. Hover darkens via
            // a subtle CSS filter so any colour gets a sensible hover
            // state without needing a paired hover hex.
            style={{ backgroundColor: submitColor }}
            className="h-12 w-full rounded-xl text-white font-semibold disabled:opacity-60 transition-[filter,opacity] hover:brightness-90 text-sm"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-slate-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
