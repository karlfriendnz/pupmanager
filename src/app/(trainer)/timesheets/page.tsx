import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { PageHeader } from '@/components/shared/page-header'
import { TimesheetsView } from './timesheets-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Timesheets' }

export default async function TimesheetsPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')

  const profile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { payoutCurrency: true },
  })

  return (
    <>
      <PageHeader title="Timesheets" />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-4xl mx-auto">
        <TimesheetsView currency={profile?.payoutCurrency ?? 'nzd'} isOwner={ctx.role === 'OWNER'} />
      </div>
    </>
  )
}
