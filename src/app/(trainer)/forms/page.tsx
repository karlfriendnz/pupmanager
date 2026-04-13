import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { FormsManager } from './forms-manager'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Embed Forms' }

export default async function FormsPage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainer = await prisma.trainerProfile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!trainer) redirect('/onboarding')

  const [forms, customFields] = await Promise.all([
    prisma.embedForm.findMany({
      where: { trainerId: trainer.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customField.findMany({
      where: { trainerId: trainer.id },
      orderBy: { order: 'asc' },
    }),
  ])

  return (
    <FormsManager
      initialForms={forms.map(f => ({
        id: f.id,
        title: f.title,
        description: f.description,
        fields: Array.isArray(f.fields) ? f.fields as { key: string; required: boolean }[] : [],
        customFieldIds: Array.isArray(f.customFieldIds) ? f.customFieldIds as string[] : [],
        thankYouMessage: f.thankYouMessage,
        isActive: f.isActive,
      }))}
      customFields={customFields.map(f => ({
        id: f.id,
        label: f.label,
        type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
        required: f.required,
        appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
      }))}
    />
  )
}
