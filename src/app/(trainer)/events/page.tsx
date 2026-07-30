import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { EVENT_PACKAGE } from '@/lib/class-runs'
import { formatDate } from '@/lib/utils'
import { EventsView } from './events-view'
import { addonSettingsHref } from '@/lib/configurable-features'

export const metadata: Metadata = { title: 'Events' }

// Events — one-off things clients buy a ticket to (workshops, seminars,
// meet-ups). An add-on: trainers without it are sent to the Add-ons tab (the
// nav shows a locked "turn it on" row until then). Creating an event runs
// through the shared offering form with the "one-off event" kind preselected.
//
// An event IS a ClassRun, off a package that runs once and doesn't repeat —
// same cohort/roster/capacity machinery as a class, just a single session. That
// keeps enrolments, invoicing and the client booking wizard working for events
// without a parallel system.
export default async function EventsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'events'))) redirect(addonSettingsHref('events'))

  const runs = await prisma.classRun.findMany({
    where: { trainerId, package: EVENT_PACKAGE },
    // Trainer's arranged order first; date breaks ties (and is the whole order
    // until anything has been dragged).
    orderBy: [{ order: 'asc' }, { startDate: 'asc' }],
    include: {
      package: {
        select: {
          id: true, name: true, description: true, capacity: true, durationMins: true,
          priceCents: true, specialPriceCents: true,
          ticketTiers: { orderBy: { order: 'asc' }, select: { id: true, name: true, priceCents: true, capacity: true } },
        },
      },
      sessions: { orderBy: { scheduledAt: 'asc' }, take: 1, select: { scheduledAt: true } },
      // quantity, because one ticket booking can be several places — counting
      // rows would show "6 of 30 booked" for an event that has sold 14.
      enrollments: { where: { status: 'ENROLLED' }, select: { id: true, quantity: true } },
    },
  })

  const now = new Date()

  return (
    <EventsView
      events={runs.map(r => {
        const at = r.sessions[0]?.scheduledAt ?? r.startDate
        return {
          id: r.id,
          packageId: r.package.id,
          name: r.name,
          description: r.package.description,
          durationMins: r.package.durationMins,
          whenLabel: formatDate(at),
          location: r.location,
          imageUrl: r.imageUrl,
          status: r.status,
          capacity: r.capacity ?? r.package.capacity ?? null,
          booked: r.enrollments.reduce((n, e) => n + Math.max(1, e.quantity), 0),
          priceCents: r.package.specialPriceCents ?? r.package.priceCents,
          tiers: r.package.ticketTiers.map(t => ({
            id: t.id, name: t.name, priceCents: t.priceCents, capacity: t.capacity,
          })),
          // An event is done once its date has been, or it was closed off.
          isPast: r.status === 'COMPLETED' || r.status === 'CANCELLED' || at.getTime() < now.getTime(),
        }
      })}
      currency={(await prisma.trainerProfile.findUnique({
        where: { id: trainerId },
        select: { payoutCurrency: true },
      }))?.payoutCurrency ?? 'NZD'}
    />
  )
}
