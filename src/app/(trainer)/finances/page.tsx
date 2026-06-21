import { redirect } from 'next/navigation'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/shared/page-header'
import { FinancesView } from './finances-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Finances' }

export default async function FinancesPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!can('billing.view', ctx.role, ctx.permissions)) redirect('/dashboard')

  return (
    <>
      <PageHeader title="Finances" />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-[960px] mx-auto">
        <FinancesView />
      </div>
    </>
  )
}
