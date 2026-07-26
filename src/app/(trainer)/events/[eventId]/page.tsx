import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasAddon } from '@/lib/billing'
import { isOneOffEventPackage } from '@/lib/class-runs'
import { EventDetail } from './event-detail'

export const metadata: Metadata = { title: 'Event' }

// An event's own screen. It is a ClassRun underneath — same roster, capacity and
// invoicing machinery — but it is NOT a class to the trainer: it happens once,
// it sells named tickets rather than carrying a single course price, and it has
// no course of sessions to step through. It used to be shown by the group-class
// screen at /classes/[runId], which is why the price read wrong (one figure for
// an offering with several) and why the sidebar lit up Group Classes.
//
// A run that isn't an event 404s here rather than rendering as one; the reverse
// direction (an event at /classes/[runId]) redirects in, so old links keep working.
export default async function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')
  if (!(await hasAddon(trainerId, 'events'))) redirect('/settings?tab=addons')

  const { eventId } = await params

  const [run, enrolmentInvoices, clients] = await Promise.all([
    prisma.classRun.findFirst({
      where: { id: eventId, trainerId },
      include: {
        package: {
          select: {
            id: true, name: true, description: true, capacity: true, durationMins: true,
            sessionType: true, priceCents: true, specialPriceCents: true,
            allowWaitlist: true, allowDropIn: true, isGroup: true,
            sessionCount: true, recurrenceRule: true,
            ticketTiers: {
              orderBy: { order: 'asc' },
              select: { id: true, name: true, priceCents: true, capacity: true },
            },
          },
        },
        // An event is a single occasion, so its one session is only ever used
        // for WHEN it happens — there's no session list on this screen.
        sessions: { orderBy: { scheduledAt: 'asc' }, take: 1, select: { id: true, scheduledAt: true, status: true } },
        enrollments: {
          orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { enrolledAt: 'asc' }],
          include: {
            client: { select: { id: true, user: { select: { name: true } } } },
            dog: { select: { id: true, name: true, photoUrl: true } },
            attendance: { select: { status: true } },
            ticketTier: { select: { id: true, name: true, priceCents: true } },
          },
        },
        assignedTrainers: {
          include: { membership: { select: { id: true, title: true, user: { select: { name: true } } } } },
        },
      },
    }),
    // Invoice state per enrolment, so the guest list can show who's been billed.
    prisma.invoice.findMany({
      where: { trainerId, sourceType: 'CLASS_ENROLLMENT' },
      select: { sourceId: true, status: true, sentAt: true },
    }),
    prisma.clientProfile.findMany({
      where: { trainerId, status: 'ACTIVE' },
      select: { id: true, user: { select: { name: true } }, dog: { select: { id: true, name: true } } },
      orderBy: { user: { name: 'asc' } },
    }),
  ])
  if (!run) notFound()
  // A group class opened at an /events URL is not an event — don't render it as
  // one (its sessions and single price would silently go missing).
  if (!isOneOffEventPackage(run.package)) notFound()

  const bySourceId = new Map(enrolmentInvoices.map(i => [i.sourceId, i]))
  // Several ticket types bought in one action are several enrolment rows on ONE
  // invoice, which hangs off the first row of the group. Without this the other
  // rows would read "No invoice" and offer to raise a duplicate.
  const byTicketGroup = new Map<string, (typeof enrolmentInvoices)[number]>()
  for (const e of run.enrollments) {
    if (!e.ticketGroupId) continue
    const inv = bySourceId.get(e.id)
    if (inv) byTicketGroup.set(e.ticketGroupId, inv)
  }
  const invoiceFor = (e: { id: string; ticketGroupId: string | null }) =>
    bySourceId.get(e.id) ?? (e.ticketGroupId ? byTicketGroup.get(e.ticketGroupId) : undefined)

  // Places already taken per ticket type, so the enrol flow can say "3 left"
  // and refuse a sold-out one before the trainer fills the rest of the form.
  const soldByTier = new Map<string, number>()
  for (const e of run.enrollments) {
    if (e.status !== 'ENROLLED' || !e.ticketTierId) continue
    soldByTier.set(e.ticketTierId, (soldByTier.get(e.ticketTierId) ?? 0) + e.quantity)
  }

  const at = run.sessions[0]?.scheduledAt ?? run.startDate

  return (
    <EventDetail
      event={{
        id: run.id,
        packageId: run.package.id,
        name: run.name,
        description: run.package.description,
        startsAt: at.toISOString(),
        location: run.location,
        status: run.status,
        capacity: run.capacity ?? run.package.capacity ?? null,
        durationMins: run.package.durationMins,
        sessionType: run.package.sessionType,
        allowWaitlist: run.package.allowWaitlist,
        imageUrl: run.imageUrl,
        // The flat offering price. Only shown when the event sells no ticket
        // types — otherwise the tickets ARE the price, and quoting this
        // alongside them is exactly the mismatch that got reported.
        priceCents: run.package.specialPriceCents ?? run.package.priceCents,
        assignedTrainers: run.assignedTrainers.map(a => ({
          membershipId: a.membershipId,
          name: a.membership.user.name ?? 'Team member',
          title: a.membership.title,
        })),
      }}
      tiers={run.package.ticketTiers.map(t => ({
        id: t.id,
        name: t.name,
        priceCents: t.priceCents,
        capacity: t.capacity,
        sold: soldByTier.get(t.id) ?? 0,
      }))}
      enrollments={run.enrollments.map(e => {
        const attended = e.attendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'MAKEUP').length
        const inv = invoiceFor(e)
        return {
          id: e.id,
          status: e.status,
          type: e.type,
          waitlistPosition: e.waitlistPosition,
          source: e.source,
          dropInSessionId: null,
          dropInSessionAt: null,
          dropInSessionIndex: null,
          clientId: e.client.id,
          clientName: e.client.user.name ?? 'Unnamed client',
          dogName: e.dog?.name ?? null,
          dogPhotoUrl: e.dog?.photoUrl ?? null,
          attendedCount: attended,
          markedCount: e.attendance.length,
          ticketTierId: e.ticketTier?.id ?? null,
          ticketName: e.ticketTier?.name ?? null,
          ticketPriceCents: e.ticketTier?.priceCents ?? null,
          quantity: e.quantity,
          invoiceState: !inv ? null
            : inv.status === 'PAID' ? 'PAID'
            : inv.status === 'CANCELLED' ? 'CANCELLED'
            : inv.sentAt ? 'SENT' : 'UNSENT',
        }
      })}
      clients={clients.map(c => ({
        id: c.id,
        name: c.user.name ?? 'Unnamed client',
        dogId: c.dog?.id ?? null,
        dogName: c.dog?.name ?? null,
      }))}
    />
  )
}
