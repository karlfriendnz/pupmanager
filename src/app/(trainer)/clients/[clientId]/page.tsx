import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getClientAccess } from '@/lib/trainer-access'
import { formatDate } from '@/lib/utils'
import { ClientProfileTabs } from './client-profile-tabs'
import { ClientActionsMenu } from './client-actions-menu'
import { PageHeader } from '@/components/shared/page-header'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Client profile' }

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { clientId } = await params

  const access = await getClientAccess(clientId, session.user.id)
  if (!access) notFound()

  const { client: clientAccess, canEdit } = access
  const isPrimaryTrainer = clientAccess.trainerId === access.trainerId

  const client = await prisma.clientProfile.findUnique({
    where: { id: clientId },
    include: {
      user: { select: { name: true, email: true, emailVerified: true, createdAt: true } },
      dog: true,
      dogs: true,
      diaryEntries: {
        orderBy: { date: 'desc' },
        take: 20,
        include: { completion: true },
      },
      customFieldValues: true,
    },
  })

  if (!client) notFound()

  const trainingSessions = await prisma.trainingSession.findMany({
    where: { clientId },
    orderBy: { scheduledAt: 'desc' },
    include: {
      dog: { select: { name: true } },
    },
  })

  // Fetch custom fields from the client's primary trainer
  const customFields = await prisma.customField.findMany({
    where: { trainerId: clientAccess.trainerId },
    orderBy: { order: 'asc' },
  })

  // Packages owned by the *current* trainer (so co-managers see their own packages)
  const packages = canEdit
    ? await prisma.package.findMany({
        where: { trainerId: access.trainerId },
        orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      })
    : []

  const availabilitySlots = canEdit
    ? await prisma.availabilitySlot.findMany({
        where: { trainerId: access.trainerId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      })
    : []

  // Products from the client's primary trainer (their effective shop) — used
  // to populate the "Add to next session" picker on the overview tab.
  const products = canEdit
    ? await prisma.product.findMany({
        where: { trainerId: clientAccess.trainerId, active: true },
        orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true, name: true, kind: true, priceCents: true,
          imageUrl: true, category: true,
        },
      })
    : []

  const pendingProductRequests = await prisma.productRequest.findMany({
    where: { clientId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      note: true,
      product: { select: { id: true, name: true, kind: true, imageUrl: true } },
    },
  })

  const fieldValueMap = Object.fromEntries(client.customFieldValues.map(v => [
    v.dogId ? `${v.fieldId}:${v.dogId}` : v.fieldId,
    v.value,
  ]))

  const completedTasks = client.diaryEntries.filter(t => t.completion).length
  const complianceRate = client.diaryEntries.length > 0
    ? Math.round((completedTasks / client.diaryEntries.length) * 100)
    : null

  const allDogs = [...(client.dog ? [client.dog] : []), ...client.dogs]
  const dogNames = Object.fromEntries(allDogs.map(d => [d.id, d.name]))

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <PageHeader
        title={client.user.name ?? client.user.email ?? 'Client'}
        subtitle={!isPrimaryTrainer ? 'Co-managed' : undefined}
        back={{ href: '/clients', label: 'Back to clients' }}
        actions={
          <ClientActionsMenu
            clientId={client.id}
            clientName={client.user.name ?? client.user.email}
            clientEmail={client.user.email ?? ''}
            canEdit={canEdit}
            isPrimaryTrainer={isPrimaryTrainer}
            needsInvite={!client.user.emailVerified}
            dogs={allDogs.map(d => ({ id: d.id, name: d.name }))}
            packages={packages.map(p => ({
              id: p.id,
              name: p.name,
              description: p.description,
              sessionCount: p.sessionCount,
              weeksBetween: p.weeksBetween,
              durationMins: p.durationMins,
              sessionType: p.sessionType,
            }))}
            availability={availabilitySlots.map(s => ({
              id: s.id,
              dayOfWeek: s.dayOfWeek,
              date: s.date ? s.date.toISOString().split('T')[0] : null,
              startTime: s.startTime,
              endTime: s.endTime,
            }))}
          />
        }
      />

      {/* Tabbed content */}
      <ClientProfileTabs
        clientId={client.id}
        canEdit={canEdit}
        stats={{
          complianceRate,
          completedTasks,
          totalTasks: client.diaryEntries.length,
        }}
        dogs={allDogs.map(d => ({
          id: d.id,
          name: d.name,
          breed: d.breed,
          weight: d.weight,
          dob: d.dob ? d.dob.toISOString() : null,
          notes: d.notes,
        }))}
        products={products.map(p => ({
          id: p.id,
          name: p.name,
          kind: p.kind as 'PHYSICAL' | 'DIGITAL',
          priceCents: p.priceCents,
          imageUrl: p.imageUrl,
          category: p.category,
        }))}
        pendingProductRequests={pendingProductRequests.map(r => ({
          id: r.id,
          note: r.note,
          product: {
            id: r.product.id,
            name: r.product.name,
            kind: r.product.kind as 'PHYSICAL' | 'DIGITAL',
            imageUrl: r.product.imageUrl,
          },
        }))}
        tasks={client.diaryEntries.map(t => ({
          id: t.id,
          title: t.title,
          date: t.date.toISOString(),
          dogId: t.dogId,
          completed: !!t.completion,
        }))}
        sessions={trainingSessions.map(s => ({
          id: s.id,
          title: s.title,
          scheduledAt: s.scheduledAt.toISOString(),
          durationMins: s.durationMins,
          sessionType: s.sessionType,
          status: s.status,
          invoicedAt: s.invoicedAt?.toISOString() ?? null,
          location: s.location,
          virtualLink: s.virtualLink,
          description: s.description,
          dogName: s.dog?.name ?? null,
        }))}
        customFields={customFields.map(f => ({
          id: f.id,
          label: f.label,
          appliesTo: (f.appliesTo ?? 'OWNER') as 'OWNER' | 'DOG',
          category: f.category,
        }))}
        fieldValueMap={fieldValueMap}
        dogNames={dogNames}
        contact={{
          email: client.user.email,
          phone: client.phone,
          clientSince: formatDate(client.user.createdAt),
        }}
        status={client.status}
      />
    </div>
  )
}
