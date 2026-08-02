import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ClientFormEditor } from '../client-form-editor'
import { FormEditorPageChrome } from '../../_editor-page-chrome'
import type { CustomFieldOption } from '@/lib/session-form-builder'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New client form' }

export default async function NewClientFormPage({
  searchParams,
}: {
  searchParams: Promise<{ use?: string }>
}) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [customFields, intakeForms] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
      // options too: the builder now EDITS a linked field, so a dropdown's
      // choices have to arrive with it, not just its name.
      select: { id: true, label: true, type: true, appliesTo: true, category: true, options: true },
    }),
    // The picker for "and then ask them" on a form that doesn't exist yet — so
    // a trainer can wire the run up as they build it, not on a second visit.
    prisma.form.findMany({
      where: { trainerId, usableAsIntake: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, isActive: true },
    }),
  ])

  // Which door on /forms/new they came through. Anything unrecognised falls
  // through to the intake default rather than erroring — a hand-typed URL should
  // still open a usable editor.
  const { use } = await searchParams
  const newFormUse = use === 'enquiry' ? 'enquiry' : 'intake'

  return (
    <FormEditorPageChrome title={newFormUse === 'enquiry' ? 'New enquiry form' : 'New intake form'}>
      <ClientFormEditor
        initial={null}
        newFormUse={newFormUse}
        intakeForms={intakeForms}
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
