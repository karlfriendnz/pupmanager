import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { CreateClientForm, type CustomField } from './create-client-form'
import { trainerRegionCode } from '@/lib/country'
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
      select: { businessName: true, inviteTemplate: true, addressCountry: true, signupCountry: true },
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

  // No PageHeader and no intro copy: CreateClientForm is an overlay with its
  // own title row, close button and tab strip — the whole viewport on a phone,
  // a centred panel on desktop. A header underneath would only be a second
  // title, and on desktop it would show through the dimmed backdrop saying the
  // same thing twice.
  //
  // The overlay IS this route rather than something the Clients list opens, so
  // /clients/invite keeps working typed, bookmarked or followed from an email —
  // and the three places that open it (the Clients empty state, the top-bar "+"
  // and the floating "+") keep pushing the same URL and need no change.
  return (
    <CreateClientForm
      customFields={fields}
      defaultTemplate={defaultTemplate}
      region={trainerProfile ? trainerRegionCode(trainerProfile) : undefined}
    />
  )
}
