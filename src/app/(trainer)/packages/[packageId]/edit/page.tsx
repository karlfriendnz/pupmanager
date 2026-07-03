import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { EditPackageForm } from './edit-package-form'
import type { PackageColor } from '../../package-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Edit package' }

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

  const [pkg, sessionForms] = await Promise.all([
    prisma.package.findFirst({
      where: { id: packageId, trainerId },
      include: { _count: { select: { assignments: true } } },
    }),
    prisma.sessionForm.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    }),
  ])

  if (!pkg) notFound()

  return (
    <>
      <PageHeader
        title="Edit package"
        back={{ href: '/packages', label: 'Back to packages' }}
      />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
        <EditPackageForm
          existing={{
            id: pkg.id,
            name: pkg.name,
            description: pkg.description,
            sessionCount: pkg.sessionCount,
            weeksBetween: pkg.weeksBetween,
            durationMins: pkg.durationMins,
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
            allowWaitlist: pkg.allowWaitlist,
            publicEnrollment: pkg.publicEnrollment,
            clientSelfBook: pkg.clientSelfBook,
            selfBookRequiresApproval: pkg.selfBookRequiresApproval,
            xeroAccountCode: pkg.xeroAccountCode,
            assignments: pkg._count.assignments,
          }}
          sessionForms={sessionForms}
        />
      </div>
    </>
  )
}
