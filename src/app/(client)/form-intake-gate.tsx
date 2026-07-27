'use client'

import { useRouter } from 'next/navigation'
import { FormRunner, type Answers, type LinkedField, type RunnableForm } from '@/components/shared/form-runner'

/**
 * The gate a client meets when their trainer assigned them a client form at
 * invite time. Takes priority over the field-library intake gate — a trainer
 * who built a form meant it to be asked instead of the flat field list.
 *
 * All the rendering lives in FormRunner, shared with the public enquiry form:
 * same questions, same pages, same conditional logic, so the same component.
 */
export function FormIntakeGate({
  businessName,
  trainerLogoUrl,
  form,
  linkedFields,
}: {
  businessName: string
  trainerLogoUrl: string | null
  form: RunnableForm
  linkedFields: Record<string, LinkedField>
}) {
  const router = useRouter()

  async function submit(answers: Answers): Promise<string | null> {
    try {
      const res = await fetch('/api/my/intake-form/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formId: form.id, answers }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => ({}))
        return typeof b.error === 'string' ? b.error : 'Could not save your answers — please try again.'
      }
      // The gate lives in the layout and is driven by intakeCompletedAt, so a
      // refresh is what lets the client through — there is nowhere to push to.
      router.refresh()
      return null
    } catch {
      return 'Could not save your answers — please try again.'
    }
  }

  return (
    <FormRunner
      form={form}
      linkedFields={linkedFields}
      businessName={businessName}
      trainerLogoUrl={trainerLogoUrl}
      heading="Before you get started"
      submitLabel="Save and continue"
      onSubmit={submit}
    />
  )
}
