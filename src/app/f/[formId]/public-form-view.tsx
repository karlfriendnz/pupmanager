'use client'

import { useState } from 'react'

type Field = {
  id: string
  type: 'TEXT' | 'MULTIPLE_CHOICE' | 'DROPDOWN'
  label: string
  required: boolean
  options: unknown
  order: number
}

type Section = {
  id: string
  title: string
  order: number
  fields: Field[]
}

type Form = {
  id: string
  name: string
  description: string | null
  sections: Section[]
  trainer: { businessName: string; logoUrl: string | null }
}

export function PublicFormView({ form }: { form: Form }) {
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setValue(fieldId: string, value: string | string[]) {
    setAnswers(prev => ({ ...prev, [fieldId]: value }))
  }

  function toggleOption(fieldId: string, option: string) {
    const current = (answers[fieldId] as string[]) ?? []
    const next = current.includes(option)
      ? current.filter(o => o !== option)
      : [...current, option]
    setValue(fieldId, next)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    // Build answers array
    const allFields = form.sections.flatMap(s => s.fields)
    const answersArr = allFields.map(f => ({
      fieldId: f.id,
      value: answers[f.id] ?? '',
    }))

    // Simple heuristic: try to extract name/email/dogName from answers
    let name: string | undefined
    let email: string | undefined
    let dogName: string | undefined

    for (const f of allFields) {
      const val = answers[f.id]
      if (!val || typeof val !== 'string') continue
      const lower = f.label.toLowerCase()
      if (!name && (lower.includes('name') && !lower.includes('dog'))) name = val
      if (!email && lower.includes('email')) email = val
      if (!dogName && lower.includes('dog')) dogName = val
    }

    const res = await fetch(`/api/forms/${form.id}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersArr, name, email, dogName }),
    })

    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Something went wrong. Please try again.')
      setSubmitting(false)
      return
    }

    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-8 max-w-md w-full text-center">
          <div className="text-5xl mb-4">🐾</div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Thanks for your enquiry!</h2>
          <p className="text-slate-500 text-sm">We&apos;ll be in touch soon.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          {form.trainer.logoUrl && (
            <img src={form.trainer.logoUrl} alt={form.trainer.businessName} className="h-12 w-12 rounded-xl object-cover mx-auto mb-3" />
          )}
          <h1 className="text-2xl font-bold text-slate-900">{form.name}</h1>
          {form.description && <p className="text-slate-500 text-sm mt-1">{form.description}</p>}
          <p className="text-xs text-slate-400 mt-1">by {form.trainer.businessName}</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {form.sections.map(section => (
            <div key={section.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <h2 className="font-semibold text-slate-800 mb-4">{section.title}</h2>
              <div className="flex flex-col gap-5">
                {section.fields.map(field => {
                  const options = Array.isArray(field.options) ? field.options as string[] : []
                  return (
                    <div key={field.id}>
                      <label className="block text-sm font-medium text-slate-700 mb-1.5">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                      </label>

                      {field.type === 'TEXT' && (
                        <input
                          type="text"
                          value={(answers[field.id] as string) ?? ''}
                          onChange={e => setValue(field.id, e.target.value)}
                          required={field.required}
                          className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      )}

                      {field.type === 'DROPDOWN' && (
                        <select
                          value={(answers[field.id] as string) ?? ''}
                          onChange={e => setValue(field.id, e.target.value)}
                          required={field.required}
                          className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                          <option value="">Select an option...</option>
                          {options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      )}

                      {field.type === 'MULTIPLE_CHOICE' && (
                        <div className="flex flex-col gap-2">
                          {options.map(opt => {
                            const selected = ((answers[field.id] as string[]) ?? []).includes(opt)
                            return (
                              <label key={opt} className="flex items-center gap-3 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={() => toggleOption(field.id, opt)}
                                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-slate-700">{opt}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : 'Submit enquiry'}
          </button>
        </form>
      </div>
    </div>
  )
}
