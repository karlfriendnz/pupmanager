import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmbedFormEditor } from '../../forms-manager'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit embed form' }

export default async function EditEmbedFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { formId } = await params
  const [form, customFields] = await Promise.all([
    prisma.embedForm.findFirst({
      where: { id: formId, trainerId },
    }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
      select: { id: true, label: true, type: true, required: true, appliesTo: true },
    }),
  ])
  if (!form) notFound()

  return (
    <FormEditorPageChrome title="Edit embed form">
      <EmbedFormEditor
        initial={{
          id: form.id,
          title: form.title,
          description: form.description,
          fields: Array.isArray(form.fields) ? form.fields as { key: string; required: boolean }[] : [],
          customFieldIds: Array.isArray(form.customFieldIds) ? form.customFieldIds as string[] : [],
          thankYouTitle: form.thankYouTitle,
          thankYouMessage: form.thankYouMessage,
          isActive: form.isActive,
          showBorder: form.showBorder,
          buttonColor: form.buttonColor,
        }}
        customFields={customFields.map(f => ({
          id: f.id,
          label: f.label,
          type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
          required: f.required,
          appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
        }))}
      />
    </FormEditorPageChrome>
  )
}
