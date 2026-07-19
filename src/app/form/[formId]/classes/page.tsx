import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { effectiveCapacity, seatsRemaining, PUBLIC_CLASS_ENROLLMENT_ENABLED } from '@/lib/class-runs'
import { PublicClasses } from './public-classes'

// Public, unauthenticated class listing reached from a trainer's embed
// form. Requesting a spot creates an Enquiry tagged with the run — the
// trainer accepts (and enrols) from their inbox. No account or payment
// happens here, so paid classes park on the trainer's accept step.
export default async function PublicClassesPage({
  params,
}: {
  params: Promise<{ formId: string }>
}) {
  // Public class self-enrolment is hidden for now — 404 the page.
  if (!PUBLIC_CLASS_ENROLLMENT_ENABLED) notFound()

  const { formId } = await params

  const form = await prisma.embedForm.findFirst({
    where: { id: formId, isActive: true },
    select: { id: true, trainerId: true, description: true },
  })
  if (!form) notFound()

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: form.trainerId },
    select: { payoutCurrency: true },
  })
  const currency = profile?.payoutCurrency ?? 'nzd'

  const runs = await prisma.classRun.findMany({
    where: {
      trainerId: form.trainerId,
      status: 'SCHEDULED',
      package: { isGroup: true, publicEnrollment: true },
    },
    orderBy: { startDate: 'asc' },
    include: {
      package: { select: { name: true, description: true, capacity: true, priceCents: true, allowWaitlist: true } },
      _count: { select: { sessions: true } },
      enrollments: { where: { status: 'ENROLLED' }, select: { id: true } },
    },
  })

  return (
    <PublicClasses
      formId={form.id}
      currency={currency}
      runs={runs.map(r => {
        const cap = effectiveCapacity(r.capacity, r.package.capacity)
        const left = seatsRemaining(cap, r.enrollments.length)
        return {
          id: r.id,
          name: r.name,
          scheduleNote: r.scheduleNote,
          startDate: r.startDate.toISOString(),
          sessionCount: r._count.sessions,
          description: r.package.description,
          priceCents: r.package.priceCents,
          seatsLeft: left,
          full: left === 0,
          waitlistAvailable: left === 0 && r.package.allowWaitlist,
        }
      })}
    />
  )
}
