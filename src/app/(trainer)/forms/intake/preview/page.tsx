import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { IntakeGatePreview } from './intake-gate-preview'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Intake form preview' }

// Trainer preview of the stepped intake form. Mirrors the data the client would
// receive in IntakeGate, plus a sample dog so DOG-scoped sections render. No
// values are persisted on submit — preview just confirms completion.
export default async function IntakeFormPreviewPage() {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [profile, customFields] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { businessName: true, intakeSectionOrder: true },
    }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
    }),
  ])
  if (!profile) redirect('/login')

  const sectionMeta = (Array.isArray(profile.intakeSectionOrder) ? profile.intakeSectionOrder : []).map(entry =>
    typeof entry === 'string'
      ? { name: entry, description: null }
      : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null }
  )

  return (
    <IntakeGatePreview
      businessName={profile.businessName || 'Your business'}
      customFields={customFields.map(f => ({
        id: f.id,
        label: f.label,
        type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
        required: f.required,
        options: Array.isArray(f.options) ? f.options as string[] : [],
        category: f.category,
        appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
      }))}
      sectionMeta={sectionMeta}
    />
  )
}
