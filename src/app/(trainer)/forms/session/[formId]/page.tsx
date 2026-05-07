import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SessionFormEditor, type Question } from '../session-forms-manager'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit session form' }

export default async function EditSessionFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const { formId } = await params
  const [form, customFields] = await Promise.all([
    prisma.sessionForm.findFirst({
      where: { id: formId, trainerId },
      include: { _count: { select: { responses: true } } },
    }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
      select: { id: true, label: true, type: true, appliesTo: true, category: true },
    }),
  ])
  if (!form) notFound()

  return (
    <FormEditorPageChrome title="Edit session form">
      <SessionFormEditor
        existing={{
          id: form.id,
          name: form.name,
          description: form.description,
          introText: form.introText,
          closingText: form.closingText,
          backgroundColor: form.backgroundColor,
          backgroundUrl: form.backgroundUrl,
          questions: Array.isArray(form.questions) ? form.questions as unknown as Question[] : [],
          responses: form._count.responses,
          isActive: form.isActive,
        }}
        customFields={customFields.map(f => ({
          id: f.id,
          label: f.label,
          type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
          appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
          category: f.category,
        }))}
      />
    </FormEditorPageChrome>
  )
}
