import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { trainerRegionCode } from '@/lib/country'
import { EditPackageForm } from './edit-package-form'
import type { PackageColor } from '../../package-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit consult' }

export default async function EditPackagePage({
  params,
}: {
  params: Promise<{ packageId: string }>
}) {
  const session = await auth()
  if (!session) redirect('/login')

  const { packageId } = await params

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [pkg, sessionForms, trainerProfile] = await Promise.all([
    prisma.package.findFirst({
      where: { id: packageId, trainerId },
      include: {
        _count: { select: { assignments: true } },
        // A drop-in class's schedule — the form edits these directly.
        sessionSlots: { orderBy: { order: 'asc' } },
        // A one-off event's ticket types.
        ticketTiers: { orderBy: { order: 'asc' } },
        // The class this offering was scheduled as. Exactly one run means the
        // form can edit that class's venue/cover/staff; several means cohorts
        // are managed per-run and the form leaves them alone.
        classRuns: {
          orderBy: { startDate: 'asc' },
          select: {
            id: true, startDate: true, status: true, scheduleNote: true, location: true, imageUrl: true,
            assignedTrainers: { select: { membershipId: true } },
            // Once anyone has been marked present the dates are fixed, so the
            // form shows them read-only rather than offering a move it'd refuse.
            _count: { select: { sessions: true } },
          },
        },
      },
    }),
    prisma.sessionForm.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    }),
    prisma.trainerProfile.findUnique({ where: { id: trainerId }, select: { addressCountry: true, signupCountry: true } }),
  ])
  const region = trainerProfile ? trainerRegionCode(trainerProfile) : undefined

  if (!pkg) notFound()

  // Only a single-run offering is edited as "the class" here; a package with
  // several cohorts keeps its runs out of this form.
  const run = pkg.classRuns.length === 1 ? pkg.classRuns[0] : null
  const hasAttendance = run
    ? (await prisma.sessionAttendance.count({ where: { session: { classRunId: run.id } } })) > 0
    : false

  // Name the thing you're editing, and send Back where you came from — the
  // class itself when it's scheduled, else its list.
  const isEvent = pkg.isGroup && pkg.sessionCount === 1 && !pkg.recurrenceRule
  const kindLabel = !pkg.isGroup ? 'package' : pkg.allowDropIn ? 'drop-in class' : isEvent ? 'event' : 'class'
  const back = run
    ? { href: `/classes/${run.id}`, label: `Back to ${pkg.name}` }
    : !pkg.isGroup ? { href: '/packages', label: 'Back to packages' }
    : pkg.allowDropIn ? { href: '/casual-classes', label: 'Back to casual classes' }
    : isEvent ? { href: '/events', label: 'Back to events' }
    : { href: '/classes', label: 'Back to classes' }

  return (
    <>
      <PageHeader
        title={`Edit ${kindLabel}`}
        back={back}
      />
      <div className="p-4 md:p-8 w-full max-w-[872px] mx-auto pm-centered">
        <EditPackageForm
          region={region}
          existing={{
            id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            sessionCount: pkg.sessionCount,
            weeksBetween: pkg.weeksBetween,
            durationMins: pkg.durationMins,
            bufferMins: pkg.bufferMins,
            sessionType: pkg.sessionType,
            priceCents: pkg.priceCents,
            specialPriceCents: pkg.specialPriceCents,
            color: (pkg.color ?? null) as PackageColor | null,
            defaultSessionFormId: pkg.defaultSessionFormId ?? null,
            requireSessionNotes: pkg.requireSessionNotes,
            isGroup: pkg.isGroup,
            capacity: pkg.capacity,
            allowDropIn: pkg.allowDropIn,
            dropInPriceCents: pkg.dropInPriceCents,
            recurrenceRule: pkg.recurrenceRule,
            allowWaitlist: pkg.allowWaitlist,
            publicEnrollment: pkg.publicEnrollment,
            clientSelfBook: pkg.clientSelfBook,
            selfBookRequiresApproval: pkg.selfBookRequiresApproval,
            xeroAccountCode: pkg.xeroAccountCode,
            requirePayment: pkg.requirePayment,
            sessionSlots: pkg.sessionSlots.map(s => ({
              ...s,
              startDate: s.startDate ? s.startDate.toISOString() : null,
            })),
            ticketTiers: pkg.ticketTiers,
            classRunId: run?.id ?? null,
            runCount: pkg.classRuns.length,
            startAtIso: run?.startDate.toISOString() ?? null,
            hasAttendance,
            runStatus: run?.status,
            scheduleNote: run?.scheduleNote ?? null,
            // The scheduled class is the live venue when there's exactly one;
            // otherwise (not scheduled yet, or several cohorts at their own
            // venues) fall back to the offering's own default, which is where
            // the form's value is stored and what the next run will inherit.
            location: run?.location ?? pkg.location ?? null,
            // The cover image belongs to the OFFERING — that's where the detail
            // page reads it from, and a 1:1 package has no run at all. Seeding
            // it from the run meant an image you'd saved was simply not there
            // when you came back to edit, and the next save wrote the blank
            // over it. Fall back to the run's for rows that only ever got one
            // through the class page.
            imageUrl: pkg.imageUrl ?? run?.imageUrl ?? null,
            assignedMembershipIds: run?.assignedTrainers.map(t => t.membershipId) ?? [],
            assignments: pkg._count.assignments,
          }}
          sessionForms={sessionForms}
        />
      </div>
    </>
  )
}
