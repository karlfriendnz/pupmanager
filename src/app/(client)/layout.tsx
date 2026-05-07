import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getActiveClient } from '@/lib/client-context'
import { AppShell } from '@/components/shared/app-shell'
import { IntakeGate } from './intake-gate'
import { PreviewBanner } from './preview-banner'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const active = await getActiveClient()
  if (!active) redirect('/login')

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    include: {
      user: { select: { name: true, email: true } },
      trainer: { select: { id: true, businessName: true, logoUrl: true, intakeSectionOrder: true } },
      dog: { select: { id: true, name: true } },
      dogs: { select: { id: true, name: true } },
      customFieldValues: { select: { fieldId: true, dogId: true, value: true } },
    },
  })

  if (!clientProfile) redirect('/login')

  // Fetch all custom fields defined by this trainer
  const customFields = await prisma.customField.findMany({
    where: { trainerId: clientProfile.trainer.id },
    orderBy: { order: 'asc' },
  })

  // Check if any required fields are missing values
  const allDogs = [
    ...(clientProfile.dog ? [clientProfile.dog] : []),
    ...clientProfile.dogs,
  ]

  const existingValues = Object.fromEntries(
    clientProfile.customFieldValues.map(v => [
      v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId,
      v.value,
    ])
  )

  let hasMissingRequired = false
  for (const field of customFields) {
    if (!field.required) continue
    if (field.appliesTo === 'OWNER') {
      if (!existingValues[field.id]?.trim()) { hasMissingRequired = true; break }
    } else {
      // DOG field — check each dog
      for (const dog of allDogs) {
        if (!existingValues[`${field.id}:${dog.id}`]?.trim()) { hasMissingRequired = true; break }
      }
      if (hasMissingRequired) break
    }
  }

  const clientDisplayName = clientProfile.user.name ?? clientProfile.user.email ?? 'Client'

  // Trainer in preview should see the actual app, not the intake gate — the
  // gate would force them through the client's data-entry flow which would
  // write as the client. The banner already telegraphs that this is a view.
  const showIntakeGate = !active.isPreview && hasMissingRequired && customFields.length > 0

  const banner = active.isPreview
    ? <PreviewBanner clientName={clientDisplayName} />
    : null

  if (showIntakeGate) {
    return (
      <>
        {banner}
        <AppShell
          role="CLIENT"
          userName={clientDisplayName}
          trainerLogo={clientProfile.trainer.logoUrl}
          businessName={clientProfile.trainer.businessName}
        >
          <IntakeGate
            businessName={clientProfile.trainer.businessName}
            customFields={customFields.map(f => ({
              id: f.id,
              label: f.label,
              type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
              required: f.required,
              options: Array.isArray(f.options) ? f.options as string[] : [],
              category: f.category,
              appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
            }))}
            // Normalise the JSON column — handles both legacy string[] and new
            // {name, description?}[] shapes.
            sectionMeta={(Array.isArray(clientProfile.trainer.intakeSectionOrder)
              ? clientProfile.trainer.intakeSectionOrder
              : []
            ).map(entry =>
              typeof entry === 'string'
                ? { name: entry, description: null }
                : { name: (entry as { name: string }).name, description: (entry as { description?: string | null }).description ?? null }
            )}
            dogs={allDogs}
            existingValues={existingValues}
          />
        </AppShell>
      </>
    )
  }

  return (
    <>
      {banner}
      <AppShell
        role="CLIENT"
        userName={clientDisplayName}
        userEmail={clientProfile.user.email ?? ''}
        trainerLogo={clientProfile.trainer.logoUrl}
        businessName={clientProfile.trainer.businessName}
      >
        {children}
      </AppShell>
    </>
  )
}
