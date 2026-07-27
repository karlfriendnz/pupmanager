'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import { FormRunner, type Answers, type LinkedField, type RunnableForm } from '@/components/shared/form-runner'

/**
 * A unified Form published as a public website enquiry form.
 *
 * The questions, pages and conditional logic are FormRunner's, shared with the
 * client intake gate. The one thing only this side needs is a real contact up
 * front: an enquiry the trainer can't reply to is worthless, and the authored
 * questions are otherwise entirely free-form.
 */
export function PublicUnifiedForm({
  form,
  linkedFields,
  businessName,
  trainerLogoUrl,
  showBorder,
  thankYouTitle,
  thankYouMessage,
}: {
  form: RunnableForm
  linkedFields: Record<string, LinkedField>
  businessName: string
  trainerLogoUrl: string | null
  showBorder: boolean
  thankYouTitle: string | null
  thankYouMessage: string | null
}) {
  const [contact, setContact] = useState({ name: '', email: '', phone: '' })
  const [done, setDone] = useState(false)

  function validateContact(): string | null {
    if (!contact.name.trim()) return 'Please enter your name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email.trim())) return 'Please enter a valid email address.'
    return null
  }

  async function submit(answers: Answers): Promise<string | null> {
    try {
      const res = await fetch(`/api/form/${encodeURIComponent(form.id)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact, answers }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        return typeof b.error === 'string' ? b.error : 'Could not send your details — please try again.'
      }
      setDone(true)
      return null
    } catch {
      return 'Could not send your details — please try again.'
    }
  }

  if (done) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 py-10">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent,#2563eb)]">
            <Check className="h-7 w-7 text-white" strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{thankYouTitle || 'Thank you!'}</h1>
          <p className="mt-2 text-sm text-slate-500">
            {thankYouMessage || `${businessName} has your details and will be in touch soon.`}
          </p>
        </div>
      </div>
    )
  }

  const inputClass =
    'h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent,#2563eb)]'

  return (
    <FormRunner
      form={form}
      linkedFields={linkedFields}
      businessName={businessName}
      trainerLogoUrl={trainerLogoUrl}
      heading={form.name}
      showBorder={showBorder}
      submitLabel="Send"
      validateFirstStep={validateContact}
      onSubmit={submit}
      contactBlock={
        <>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Your name<span className="ml-1 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={contact.name}
              onChange={e => setContact(c => ({ ...c, name: e.target.value }))}
              aria-label="Your name"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              Email<span className="ml-1 text-red-500">*</span>
            </label>
            <input
              type="email"
              value={contact.email}
              onChange={e => setContact(c => ({ ...c, email: e.target.value }))}
              aria-label="Email"
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
            <input
              type="tel"
              value={contact.phone}
              onChange={e => setContact(c => ({ ...c, phone: e.target.value }))}
              aria-label="Phone"
              className={inputClass}
            />
          </div>
        </>
      }
    />
  )
}
