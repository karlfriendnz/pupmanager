import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectConfigured } from '@/lib/connect'
import { PageHeader } from '@/components/shared/page-header'
import { trainerRegionCode } from '@/lib/country'
import { NewPackageForm } from './new-package-form'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'New package' }

export default async function NewPackagePage() {
  const session = await auth()
  if (!session) redirect('/login')

  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  const [sessionForms, trainer] = await Promise.all([
    prisma.sessionForm.findMany({
      where: { trainerId },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
      select: { id: true, name: true },
    }),
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { connectChargesEnabled: true, sandboxBilling: true, addressCountry: true, signupCountry: true },
    }),
  ])
  // Localise Google address suggestions to the trainer's country (global rule).
  const region = trainer ? trainerRegionCode(trainer) : undefined

  // Whether to nudge Stripe Connect after a priced package is created. Only when
  // payments aren't already live AND the trainer can actually onboard right now
  // (Connect configured + allowed for their account) — so it's never a dead end.
  const sandbox = trainer?.sandboxBilling ?? false
  const promptConnect =
    !trainer?.connectChargesEnabled &&
    isConnectConfigured(sandbox)

  return (
    <>
      <PageHeader
        title="New package"
        back={{ href: '/packages', label: 'Back to packages' }}
      />
      <div className="p-4 md:p-8 w-full max-w-[872px] mx-auto">
        <NewPackageForm sessionForms={sessionForms} promptConnect={promptConnect} region={region} />
      </div>
    </>
  )
}
