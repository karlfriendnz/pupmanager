import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SessionFormEditor } from '../session-forms-manager'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New session form' }

export default async function NewSessionFormPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const customFields = await prisma.customField.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
    select: { id: true, label: true, type: true, appliesTo: true, category: true },
  })

  return (
    <FormEditorPageChrome title="New session form">
      <SessionFormEditor
        existing={null}
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
