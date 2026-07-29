import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { wholeRunPriceCents } from '@/lib/class-runs'
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
  // The curriculum, if this class runs one, and the homework each step hands
  // out. Both are keyed off the same 1-based session number — a step and its
  // homework join on that number, they are not two lists to keep aligned — so
  // they're read together and folded into one row per step below.
  //
  // Fetched by RUN id rather than package id so it can go in the same parallel
  // wave as everything else instead of waiting on the run lookup.
  const [run, attendanceCount, enrolmentInvoices, clients, plans, homework] = await Promise.all([
    prisma.classRun.findFirst({
      where: { id: runId, trainerId },
      include: {
        package: { select: { id: true, name: true, description: true, allowDropIn: true, allowWaitlist: true, priceCents: true, dropInPriceCents: true, durationMins: true, bufferMins: true, sessionType: true, capacity: true, weeksBetween: true, sessionCount: true, defaultSessionFormId: true } },
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
        dog: { select: { id: true, name: true, deceasedAt: true } },
      },
      orderBy: { user: { name: 'asc' } },
    }),
    prisma.packageSessionPlan.findMany({
      where: { package: { classRuns: { some: { id: runId, trainerId } } } },
      orderBy: { sessionIndex: 'asc' },
      select: { id: true, sessionIndex: true, title: true, description: true },
    }),
    // Only the numbered rows: an "every session" default (sessionIndex null)
    // isn't part of any one step, and listing it under all of them would read
    // as the same homework being set six times.
    prisma.packageDefaultTask.findMany({
      where: {
        package: { classRuns: { some: { id: runId, trainerId } } },
        sessionIndex: { not: null },
      },
      orderBy: [{ sessionIndex: 'asc' }, { order: 'asc' }],
      select: { id: true, sessionIndex: true, title: true, libraryTask: { select: { title: true } } },
    }),
  ])
  if (!run) notFound()

  // A library-backed default reads its title through to the item, the same way
  // the session screen resolves it — so renaming a library task renames it here.
  const steps = plans.map(p => ({
    id: p.id,
    sessionIndex: p.sessionIndex,
    title: p.title,
    description: p.description,
    homework: homework
      .filter(h => h.sessionIndex === p.sessionIndex)
      .map(h => h.libraryTask?.title ?? h.title ?? '')
      .filter(t => t.length > 0),
  }))

  // sourceId → invoice, for the roster's billed/sent indicator.
  const invoiceByEnrolment = new Map(enrolmentInvoices.map(i => [i.sourceId, i]))

  return (
    <RunDetail
      basePath={basePath}
      backLabel={backLabel}
      steps={steps}
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
        // What a FULL seat actually costs, worked out the same way the invoice
        // works it out — every session in the run at its own price. On a casual
        // class there is no headline price to show instead, and the trainer was
        // enrolling someone onto a full run with no idea of the total until the
        // invoice landed.
        fullRunPriceCents: await wholeRunPriceCents(runId, run.package),
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
      // A deceased dog can't be enrolled, so the client comes through the
      // picker with no dog attached rather than dropping out of it entirely —
      // they may still be joining with another dog, or with none.
      clients={clients.map(c => ({
        id: c.id,
        name: c.user.name ?? 'Unnamed client',
        dogId: c.dog?.deceasedAt ? null : (c.dog?.id ?? null),
        dogName: c.dog?.deceasedAt ? null : (c.dog?.name ?? null),
      }))}
    />
  )
}
