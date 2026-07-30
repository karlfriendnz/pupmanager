import { prisma } from '@/lib/prisma'
import type { FormStep, Question } from '@/lib/session-form-builder'
import type { LinkedField, RunnableForm } from '@/components/shared/form-runner'

/**
 * Turn a stored Form row into what FormRunner needs: the questions and pages
 * as real types (they live as Json), plus a lookup of the CustomFields any
 * CUSTOM_FIELD question links to.
 *
 * Shared by the client intake gate and the public enquiry page so the two
 * can't drift — in particular the linked-field lookup is scoped to the form's
 * OWN trainer, which is what stops a question that references another
 * trainer's field id from rendering that trainer's label and options.
 */
export async function renderUnifiedForm(form: {
  id: string
  trainerId: string
  name: string
  description: string | null
  questions: unknown
  steps: unknown
}): Promise<{ runnable: RunnableForm; linkedFields: Record<string, LinkedField> }> {
  const questions = (Array.isArray(form.questions) ? form.questions : []) as unknown as Question[]
  const steps = (Array.isArray(form.steps) ? form.steps : []) as unknown as FormStep[]

  const linkedIds = questions
    .filter((q): q is Extract<Question, { type: 'CUSTOM_FIELD' }> => q.type === 'CUSTOM_FIELD')
    // A saved question always carries its id (the server normalises the link on
    // write), so one without it is a stale row with no field to look up.
    .map(q => q.customFieldId)
    .filter((id): id is string => !!id)

  const linked = linkedIds.length
    ? await prisma.customField.findMany({
        where: { id: { in: linkedIds }, trainerId: form.trainerId },
        select: { id: true, label: true, type: true, options: true },
      })
    : []

  const linkedFields: Record<string, LinkedField> = Object.fromEntries(
    linked.map(f => [
      f.id,
      {
        label: f.label,
        type: (f.type ?? 'TEXT') as LinkedField['type'],
        options: Array.isArray(f.options) ? (f.options as string[]) : [],
      },
    ]),
  )

  return {
    runnable: {
      id: form.id,
      name: form.name,
      description: form.description,
      questions,
      steps,
    },
    linkedFields,
  }
}
