import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { EditClientForm } from './edit-client-form'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit client' }

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId } = await params

  const access = await getClientAccess(clientId, session.user.id)
  if (!access) notFound()
  if (!access.canEdit) redirect(`/clients/${clientId}`)

  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      phone: true,
      user: { select: { name: true, email: true } },
      dog: { select: { id: true, name: true, breed: true, weight: true, dob: true, notes: true, photoUrl: true } },
      dogs: { select: { id: true, name: true, breed: true, weight: true, dob: true, notes: true, photoUrl: true } },
    },
  })

  if (!client) notFound()

  const [customFields, fieldValues] = await Promise.all([
    prisma.customField.findMany({
      where: { trainerId: access.client.trainerId },
      orderBy: { order: 'asc' },
    }),
    prisma.customFieldValue.findMany({ where: { clientId } }),
  ])

  function dogToForm(d: { id: string; name: string; breed: string | null; weight: number | null; dob: Date | null; notes: string | null; photoUrl: string | null }, isPrimary: boolean) {
    return {
      id: d.id,
      name: d.name,
      breed: d.breed ?? '',
      weight: d.weight?.toString() ?? '',
      dob: d.dob ? d.dob.toISOString().split('T')[0] : '',
      notes: d.notes ?? '',
      photoUrl: d.photoUrl,
      isPrimary,
    }
  }

  const initialDogs = [
    ...(client.dog ? [dogToForm(client.dog, true)] : []),
    ...client.dogs.map(d => dogToForm(d, false)),
  ]

  return (
    <>
      <PageHeader
        title={`Edit ${client.user.name ?? client.user.email}`}
        back={{ href: `/clients/${clientId}`, label: 'Back to profile' }}
      />
      <div className="p-4 md:p-8 w-full max-w-5xl mx-auto">

      <EditClientForm
        clientId={clientId}
        initialName={client.user.name ?? ''}
        initialEmail={client.user.email ?? ''}
        initialPhone={client.phone ?? ''}
        // Email is the client's login credential — only the primary
        // trainer can change it (co-managers see the field disabled).
        canEditEmail={access.client.trainerId === access.trainerId}
        initialDogs={initialDogs}
        customFields={customFields.map(f => ({
          id: f.id,
          label: f.label,
          type: f.type as 'TEXT' | 'NUMBER' | 'DROPDOWN',
          required: f.required,
          options: Array.isArray(f.options) ? f.options as string[] : [],
          category: f.category ?? null,
          appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
        }))}
        initialFieldValues={Object.fromEntries(fieldValues.map(v => [
          v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId,
          v.value,
        ]))}
      />
      </div>
    </>
  )
}
