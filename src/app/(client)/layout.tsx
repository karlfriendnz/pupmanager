import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { AppShell } from '@/components/shared/app-shell'
import { IntakeGate } from './intake-gate'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session || session.user.role !== 'CLIENT') redirect('/login')

  const clientProfile = await prisma.clientProfile.findUnique({
    where: { userId: session.user.id },
    include: {
      trainer: { select: { id: true, businessName: true, logoUrl: true } },
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

  const appShell = (
    <AppShell
      role="CLIENT"
      userName={session.user.name ?? ''}
      userEmail={session.user.email ?? ''}
      trainerLogo={clientProfile.trainer.logoUrl}
      businessName={clientProfile.trainer.businessName}
    >
      {children}
    </AppShell>
  )

  // If required fields are missing and there are any custom fields, show intake gate
  if (hasMissingRequired && customFields.length > 0) {
    return (
      <AppShell
        role="CLIENT"
        userName={session.user.name ?? ''}
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
          dogs={allDogs}
          existingValues={existingValues}
        />
      </AppShell>
    )
  }

  return appShell
}
