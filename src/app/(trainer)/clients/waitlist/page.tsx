import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { PageHeader } from '@/components/shared/page-header'
import { WaitlistView } from '../waitlist-view'

export const metadata: Metadata = { title: 'Waitlist' }

// Waitlist — its own page under the Clients nav group (moved off the Clients
// page tabs).
export default async function WaitlistPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  const trainerId = ctx.companyId

  const [entries, activeClients, packages] = await Promise.all([
    prisma.waitlistEntry.findMany({
      where: { trainerId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      include: {
        client: { select: { id: true, user: { select: { name: true, email: true } } } },
        package: { select: { id: true, name: true } },
      },
    }),
    prisma.clientProfile.findMany({
      where: { trainerId, status: 'ACTIVE' },
      select: { id: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.package.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    }),
  ])

  const data = {
    entries: entries.map(e => ({
      id: e.id,
      clientId: e.clientId,
      name: e.client?.user.name ?? e.name,
      email: e.client?.user.email ?? e.email,
      phone: e.phone,
      packageId: e.packageId,
      packageName: e.package?.name ?? null,
      request: e.request,
      sessionType: e.sessionType,
      preferredDays: e.preferredDays,
      preferredTimeStart: e.preferredTimeStart,
      preferredTimeEnd: e.preferredTimeEnd,
      earliestStart: e.earliestStart ? e.earliestStart.toISOString().slice(0, 10) : null,
      notes: e.notes,
      status: e.status,
      contactedAt: e.contactedAt?.toISOString() ?? null,
      createdAt: e.createdAt.toISOString(),
    })),
    clients: activeClients.map(c => ({ id: c.id, name: c.user.name ?? 'Unnamed client' })),
    packages,
  }

  return (
    <>
      <PageHeader title="Waitlist" subtitle="People waiting for a spot" />
      <div className="p-4 md:p-8 w-full max-w-4xl xl:max-w-7xl mx-auto">
        <WaitlistView initialEntries={data.entries} clients={data.clients} packages={data.packages} />
      </div>
    </>
  )
}
