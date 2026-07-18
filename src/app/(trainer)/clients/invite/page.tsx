import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CreateClientForm, type CustomField } from './create-client-form'
import { resolveClientFieldConfig } from '@/lib/client-fields'
import { trainerRegionCode } from '@/lib/country'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New client' }

export default async function NewClientPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [trainerProfile, customFields] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { businessName: true, inviteTemplate: true, clientFieldConfig: true, addressCountry: true, signupCountry: true },
    }),
    prisma.customField.findMany({
      where: { trainerId },
      orderBy: { order: 'asc' },
      select: { id: true, label: true, type: true, required: true, options: true, category: true, appliesTo: true },
    }),
  ])

  const defaultTemplate =
    trainerProfile?.inviteTemplate ??
    `Hi {{clientName}},

I'd like to invite you to join PupManager — an app I use to assign daily training exercises for {{dogName}} and track your progress between our sessions.

Click the link below to create your account and get started!

Looking forward to working with you,
${trainerProfile?.businessName ?? 'Your Trainer'}`

  const fields: CustomField[] = customFields.map(f => ({
    id: f.id,
    label: f.label,
    type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
    required: f.required,
    options: Array.isArray(f.options) ? (f.options as string[]) : [],
    category: f.category ?? null,
    appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
  }))

  return (
    <>
      <PageHeader title="New client" back={{ href: '/clients', label: 'Back to clients' }} />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
        <p className="text-sm text-slate-500 mb-6">
          Fill in the client&apos;s details. Add an email and we&apos;ll send them an invite to the app — or leave it blank to just record them.
        </p>
        <CreateClientForm
          config={resolveClientFieldConfig(trainerProfile?.clientFieldConfig)}
          customFields={fields}
          defaultTemplate={defaultTemplate}
          region={trainerProfile ? trainerRegionCode(trainerProfile) : undefined}
        />
      </div>
    </>
  )
}
