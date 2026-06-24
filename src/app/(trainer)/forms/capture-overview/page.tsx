import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CLIENT_FIELDS, resolveClientFieldConfig, type ClientFieldKey } from '@/lib/client-fields'
import { FormEditorPageChrome } from '../_editor-page-chrome'
import { CaptureOverview, type Row, type Cell } from '../capture-overview'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'What each form captures' }

// On the intake form only name/email/phone are captured as built-in (system)
// fields — all three always required. Dog attributes + address on intake come
// via custom fields, not the built-in columns.
const INTAKE_BUILTIN: Partial<Record<ClientFieldKey, Cell>> = {
  name: 'required', email: 'required', phone: 'required',
}

export default async function CaptureOverviewPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [tp, customFields] = await Promise.all([
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { clientFieldConfig: true } }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }],
      select: { id: true, label: true, required: true, inQuickAdd: true, appliesTo: true },
    }),
  ])
  const config = resolveClientFieldConfig(tp?.clientFieldConfig)

  const builtinRow = (key: ClientFieldKey, label: string): Row => ({
    label,
    isCustom: false,
    cells: {
      intake: INTAKE_BUILTIN[key] ?? 'no',
      full: config[key].required ? 'required' : 'optional',
      quick: config[key].quickAdd ? 'required' : 'no',
    },
  })
  const customRow = (cf: { label: string; required: boolean; inQuickAdd: boolean }): Row => ({
    label: cf.label,
    isCustom: true,
    cells: {
      intake: cf.required ? 'required' : 'optional',
      full: cf.required ? 'required' : 'optional',
      quick: cf.inQuickAdd ? 'required' : 'no',
    },
  })

  const clientRows: Row[] = [
    ...CLIENT_FIELDS.filter(f => f.scope === 'OWNER').map(f => builtinRow(f.key, f.label)),
    ...customFields.filter(c => c.appliesTo !== 'DOG').map(customRow),
  ]
  const dogRows: Row[] = [
    ...CLIENT_FIELDS.filter(f => f.scope === 'DOG').map(f => builtinRow(f.key, f.label)),
    ...customFields.filter(c => c.appliesTo === 'DOG').map(customRow),
  ]

  return (
    <FormEditorPageChrome title="What each form captures">
      <p className="text-sm text-slate-500 mb-5">
        Every field grouped by Client and Dog, against each client-facing form. Add a custom field here, or change
        required / quick-add on the <a href="/forms/client-fields" className="text-accent-strong font-medium hover:underline">Client capture fields</a> page.
      </p>
      <CaptureOverview clientRows={clientRows} dogRows={dogRows} />
    </FormEditorPageChrome>
  )
}
