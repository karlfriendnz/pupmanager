import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { getBusinessReports, getReportFilterOptions } from '@/lib/reports'
import { PageHeader } from '@/components/shared/page-header'
import { ReportsExplorer } from './reports-explorer'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Reports' }

const DAY = 86_400_000

// Resolve the active date range from the URL. No params → all time (the default
// is "show everything"; the trainer adds a range only if they want one).
function resolveRange(sp: Record<string, string | undefined>): { from: Date | null; to: Date | null } {
  if (sp.from || sp.to) {
    const from = sp.from ? new Date(`${sp.from}T00:00:00`) : null
    const to = sp.to ? new Date(`${sp.to}T23:59:59`) : null
    return {
      from: from && !isNaN(+from) ? from : null,
      to: to && !isNaN(+to) ? to : null,
    }
  }
  const now = new Date()
  switch (sp.range) {
    case '30d': return { from: new Date(Date.now() - 30 * DAY), to: null }
    case '90d': return { from: new Date(Date.now() - 90 * DAY), to: null }
    case '12m': return { from: new Date(now.getFullYear(), now.getMonth() - 11, 1), to: null }
    case 'ytd': return { from: new Date(now.getFullYear(), 0, 1), to: null }
    case 'all':
    default: return { from: null, to: null }
  }
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const session = await auth()
  if (!session || session.user.role !== 'TRAINER') redirect('/login')
  const trainerId = session.user.trainerId
  if (!trainerId) redirect('/login')

  // Reports surface revenue + whole-business numbers — owner/manager territory,
  // gated the same as Finances. Staff without billing.view are bounced.
  const ctx = await getTrainerContext()
  if (ctx && !can('billing.view', ctx.role, ctx.permissions)) redirect('/dashboard')

  const sp = await searchParams
  const { members, breeds, customFields } = await getReportFilterOptions(trainerId)

  // Validate filter params against what actually exists.
  const member = sp.member && members.some(m => m.id === sp.member) ? sp.member : null
  const breed = sp.breed && breeds.includes(sp.breed) ? sp.breed : null
  const range = resolveRange(sp)

  // Custom-field conditions arrive as `cf_<fieldId>=<value>`; keep only the
  // ones whose field + value are real.
  const cfValues: Record<string, string> = {}
  const customFieldFilters: { fieldId: string; value: string }[] = []
  for (const [key, value] of Object.entries(sp)) {
    if (!key.startsWith('cf_') || !value) continue
    const fieldId = key.slice(3)
    const field = customFields.find(f => f.id === fieldId)
    if (field && field.options.includes(value)) {
      cfValues[fieldId] = value
      customFieldFilters.push({ fieldId, value })
    }
  }

  const reports = await getBusinessReports(trainerId, {
    membershipId: member,
    from: range.from,
    to: range.to,
    breed,
    customFieldFilters,
  })

  return (
    <>
      <PageHeader title="Reports" />
      <div className="p-4 md:p-8 w-full max-w-6xl mx-auto">
        <ReportsExplorer
          reports={reports}
          members={members}
          breeds={breeds}
          customFields={customFields}
          filters={{
            member: member ?? '',
            breed: breed ?? '',
            range: sp.range ?? (sp.from || sp.to ? 'custom' : 'all'),
            from: sp.from ?? '',
            to: sp.to ?? '',
            customFields: cfValues,
          }}
        />
      </div>
    </>
  )
}
