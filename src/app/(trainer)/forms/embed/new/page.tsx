import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmbedFormEditor } from '../../forms-manager'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New embed form' }

export default async function NewEmbedFormPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const customFields = await prisma.customField.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
    select: { id: true, label: true, type: true, required: true, appliesTo: true },
  })

  return (
    <FormEditorPageChrome title="New embed form">
      <EmbedFormEditor
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
