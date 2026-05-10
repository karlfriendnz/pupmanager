import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { IntakeFormEditor } from '../forms-manager'
import { FormEditorPageChrome } from '../_editor-page-chrome'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Intake form' }

export default async function IntakeFormPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [customFields, profile] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { intakeSectionOrder: true, intakeFormPublished: true, intakeSystemFieldSections: true },
    }),
  ])

  const initialFields = customFields.map(f => ({
    id: f.id,
    label: f.label,
    type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
    required: f.required,
    options: Array.isArray(f.options) ? f.options as string[] : [],
    category: f.category ?? null,
    appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
    order: f.order,
  }))

  // intakeSectionOrder may be the new shape ({name, description?}[]) or the
  // legacy plain string[] — normalise to the new shape for the editor.
  const rawOrder = Array.isArray(profile?.intakeSectionOrder) ? profile.intakeSectionOrder : []
  const initialSectionOrder = rawOrder.map(entry =>
    typeof entry === 'string'
      ? { name: entry, description: null }
      : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null }
  )

  const initialSystemFieldSections =
    (profile?.intakeSystemFieldSections as Partial<Record<'name' | 'email' | 'phone', string | null>> | null) ?? {}

  return (
    <FormEditorPageChrome title="Intake form">
      <IntakeFormEditor
        initialFields={initialFields}
        initialSectionOrder={initialSectionOrder}
        initialPublished={profile?.intakeFormPublished ?? false}
        initialSystemFieldSections={initialSystemFieldSections}
      />
    </FormEditorPageChrome>
  )
}
