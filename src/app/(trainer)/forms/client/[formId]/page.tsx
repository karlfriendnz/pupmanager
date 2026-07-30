import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClientFormEditor } from '../client-form-editor'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { CustomFieldOption, FormStep, Question } from '@/lib/session-form-builder'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit client form' }

export default async function EditClientFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { formId } = await params
  const [form, customFields] = await Promise.all([
    // findFirst with trainerId (not findUnique on id) so another trainer's form
    // 404s rather than rendering.
    prisma.form.findFirst({ where: { id: formId, trainerId } }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
      // options too: the builder now EDITS a linked field, so a dropdown's
      // choices have to arrive with it, not just its name.
      select: { id: true, label: true, type: true, appliesTo: true, category: true, options: true },
    }),
  ])
  if (!form) notFound()

  return (
    <FormEditorPageChrome title="Edit client form">
      <ClientFormEditor
        initial={{
          id: form.id,
          name: form.name,
          description: form.description,
          usableAsIntake: form.usableAsIntake,
          usableAsEnquiry: form.usableAsEnquiry,
          questions: (Array.isArray(form.questions) ? form.questions : []) as unknown as Question[],
          steps: (Array.isArray(form.steps) ? form.steps : []) as unknown as FormStep[],
          thankYouTitle: form.thankYouTitle,
          thankYouMessage: form.thankYouMessage,
          inviteSubject: form.inviteSubject,
          inviteBody: form.inviteBody,
          inviteShowDiaryButton: form.inviteShowDiaryButton,
          inviteButtonLabel: form.inviteButtonLabel,
          isActive: form.isActive,
        }}
        customFields={customFields.map((f): CustomFieldOption => ({
          id: f.id,
          label: f.label,
          type: f.type as CustomFieldOption['type'],
          appliesTo: (f.appliesTo ?? 'OWNER') as CustomFieldOption['appliesTo'],
          category: f.category,
          options: Array.isArray(f.options) ? (f.options as string[]) : [],
        }))}
      />
    </FormEditorPageChrome>
  )
}
