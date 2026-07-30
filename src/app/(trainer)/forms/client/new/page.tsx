import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClientFormEditor } from '../client-form-editor'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { CustomFieldOption } from '@/lib/session-form-builder'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New client form' }

export default async function NewClientFormPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const customFields = await prisma.customField.findMany({
    where: { trainerId },
    orderBy: { order: 'asc' },
    // options too: the builder now EDITS a linked field, so a dropdown's
      // choices have to arrive with it, not just its name.
      select: { id: true, label: true, type: true, appliesTo: true, category: true, options: true },
  })

  return (
    <FormEditorPageChrome title="New client form">
      <ClientFormEditor
        initial={null}
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
