import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { can } from '@/lib/permissions'
import { PageHeader } from '@/components/shared/page-header'
import { AddonNudge } from '@/components/shared/addon-nudge'
import { isNudgeDismissed } from '@/lib/nudge-dismissals'
import { addonNudge } from '@/components/shared/addon-nudge-registry'
import { FinancesView } from './finances-view'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Finances' }

export default async function FinancesPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  if (!can('billing.view', ctx.role, ctx.permissions)) redirect('/dashboard')

  // Nudge: promote taking card payments when Stripe isn't connected yet.
  // Payments is enabled by connecting Stripe (charges_enabled), not a toggle,
  // so gate on connectChargesEnabled — mirrors the schedule's googleConn check.
  const profile = await prisma.trainerProfile.findUnique({
    where: { id: ctx.companyId },
    select: { connectChargesEnabled: true },
  })
  const isDevPreview = process.env.NODE_ENV === 'development'
  const paymentsNudge = addonNudge('payments')
  // Only nudge while payments aren't connected — connecting hides it (dev too;
  // the old `|| isDevPreview` forced it on even after setup).
  const showPaymentsNudge = !profile?.connectChargesEnabled && !!paymentsNudge
  // A previous "Not now" is remembered per user, so it stays gone on their
  // other devices too (not just the browser it was dismissed in).
  const paymentsNudgeDismissed = await isNudgeDismissed(ctx.userId, 'finances-payments')

  return (
    <>
      <PageHeader title="Finances" />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-[960px] mx-auto">
        <FinancesView />
      </div>
      {showPaymentsNudge && paymentsNudge && (
        <AddonNudge id="finances-payments" {...paymentsNudge} forceShow={isDevPreview} dismissed={paymentsNudgeDismissed} />
      )}
    </>
  )
}
