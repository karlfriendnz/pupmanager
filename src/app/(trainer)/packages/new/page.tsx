import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageHeader } from '@/components/shared/page-header'
import { NewPackageForm } from './new-package-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New package' }

export default async function NewPackagePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const sessionForms = await prisma.sessionForm.findMany({
    where: { trainerId },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    select: { id: true, name: true },
  })

  return (
    <>
      <PageHeader
        title="New package"
        back={{ href: '/packages', label: 'Back to packages' }}
      />
      <div className="p-4 md:p-8 w-full max-w-2xl mx-auto">
        <NewPackageForm sessionForms={sessionForms} />
      </div>
    </>
  )
}
