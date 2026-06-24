import { redirect } from 'next/navigation'
import { getTrainerContext } from '@/lib/membership'
import { PageHeader } from '@/components/shared/page-header'
import { TimesheetDetail } from './timesheet-detail'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Timesheet' }

export default async function TimesheetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  const { id } = await params

  return (
    <>
      <PageHeader title="Timesheet" back={{ href: '/timesheets', label: 'Timesheets' }} />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-5xl mx-auto">
        <TimesheetDetail id={id} />
      </div>
    </>
  )
}
