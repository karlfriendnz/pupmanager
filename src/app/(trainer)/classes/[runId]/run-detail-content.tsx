import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { RunDetail } from './run-detail'

// The shared run-detail loader. A ClassRun powers three offering sections —
// group classes, casual classes and doggy daycare — so the same detail screen
// is mounted under /classes, /casual-classes and /doggy-daycare. `basePath`
// keeps the back link, the post-delete redirect and the session links inside
// whichever section the trainer opened it from (so a casual-class run never
// bounces them to Group Classes or its add-on gate).
export async function ClassRunDetailContent({
  runId,
  basePath = '/classes',
  backLabel = 'Classes',
}: {
  runId: string
  basePath?: string
  backLabel?: string
}) {
  const session = await auth()
  if (!session) redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  // attendanceCount filters by classRunId === runId (the param), so it doesn't
  // depend on the run lookup — fan all of these out in parallel.
  const [run, attendanceCount, enrolmentInvoices, clients] = await Promise.all([
    prisma.classRun.findFirst({
      where: { id: runId, trainerId },
      include: {
        package: { select: { id: true, name: true, description: true, allowDropIn: true, allowWaitlist: true, priceCents: true, durationMins: true, bufferMins: true, sessionType: true, capacity: true, weeksBetween: true, sessionCount: true, defaultSessionFormId: true } },
        sessions: {
          orderBy: { sessionIndex: 'asc' },
          select: { id: true, title: true, scheduledAt: true, sessionIndex: true, status: true },
        },
        enrollments: {
          orderBy: [{ status: 'asc' }, { waitlistPosition: 'asc' }, { enrolledAt: 'asc' }],
          include: {
            client: { select: { id: true, user: { select: { name: true } } } },
            dog: { select: { id: true, name: true, photoUrl: true } },
            attendance: { select: { status: true } },
            // Which session a drop-in is for. A client can hold several, so
            // without this the roster shows the same name twice with nothing
            // to tell the two bookings apart.
            dropInSession: { select: { scheduledAt: true } },
            // Null on a class — only an event sells named ticket types.
            ticketTier: { select: { id: true, name: true, priceCents: true } },
          },
        },
        assignedTrainers: {
          include: { membership: { select: { id: true, title: true, user: { select: { name: true } } } } },
        },
      },
    }),
    prisma.sessionAttendance.count({ where: { session: { classRunId: runId } } }),
    // Invoice state per enrolment, so the roster can show who's been billed.
    // One query keyed by sourceId rather than a lookup per row.
    prisma.invoice.findMany({
      where: { trainerId, sourceType: 'CLASS_ENROLLMENT' },
      select: { sourceId: true, status: true, sentAt: true },
    }),
    prisma.clientProfile.findMany({
      where: { trainerId, status: 'ACTIVE' },
      select: {
        id: true,
        user: { select: { name: true } },
        dog: { select: { id: true, name: true } },
      },
      orderBy: { user: { name: 'asc' } },
    }),
  ])
  if (!run) notFound()

  // sourceId → invoice, for the roster's billed/sent indicator.
  const invoiceByEnrolment = new Map(enrolmentInvoices.map(i => [i.sourceId, i]))

  return (
    <RunDetail
      basePath={basePath}
      backLabel={backLabel}
      run={{
        id: run.id,
        packageId: run.package.id,
        name: run.name,
        scheduleNote: run.scheduleNote,
        location: run.location,
        description: run.package?.description ?? null,
        startDate: run.startDate.toISOString(),
        status: run.status,
        capacity: run.capacity ?? run.package.capacity ?? null,
        packageName: run.package.name,
        allowDropIn: run.package.allowDropIn,
        allowWaitlist: run.package.allowWaitlist,
        priceCents: run.package.priceCents,
        durationMins: run.package.durationMins,
        // Run-level override wins; null = inherit the class's package.
        bufferMins: run.bufferMins ?? run.package.bufferMins,
        sessionType: run.package.sessionType,
        weeksBetween: run.package.weeksBetween,
        sessionCount: run.package.sessionCount,
        defaultSessionFormId: run.package.defaultSessionFormId,
        hasAttendance: attendanceCount > 0,
        imageUrl: run.imageUrl,
        requirePayment: run.requirePayment,
        assignedMembershipIds: run.assignedTrainers.map(a => a.membershipId),
        assignedTrainers: run.assignedTrainers.map(a => ({
          membershipId: a.membershipId,
          name: a.membership.user.name ?? 'Team member',
          title: a.membership.title,
        })),
      }}
      sessions={run.sessions.map(s => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
        sessionIndex: s.sessionIndex,
        status: s.status,
      }))}
      enrollments={run.enrollments.map(e => {
        const attended = e.attendance.filter(a => a.status === 'PRESENT' || a.status === 'LATE' || a.status === 'MAKEUP').length
        const inv = invoiceByEnrolment.get(e.id)
        return {
          id: e.id,
          status: e.status,
          type: e.type,
          waitlistPosition: e.waitlistPosition,
          source: e.source,
          dropInSessionId: e.dropInSessionId,
          dropInSessionAt: e.dropInSession?.scheduledAt.toISOString() ?? null,
          dropInSessionIndex: e.joinedAtIndex,
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
          // null = no invoice raised at all; otherwise where it's got to.
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
