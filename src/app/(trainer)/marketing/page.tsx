import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { getTrainerContext, scopeForMember, hasPermission } from '@/lib/membership'
import { hasAddon } from '@/lib/billing'
import { PageHeader } from '@/components/shared/page-header'
import { MarketingView } from './marketing-view'

export const metadata: Metadata = { title: 'Marketing' }

const NO_EMAIL_DOMAIN = '@no-email.pupmanager.app'

// Marketing home — currently the bulk-email tool. The composer itself lives at
// /marketing/new; this overview shows the "Email your clients" card, sending
// setup, and lists past broadcasts with their delivery/open/click stats.
export default async function MarketingPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string }>
}) {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')
  const trainerId = ctx.companyId
  // Marketing is a paid add-on — send trainers without it to the add-ons tab.
  if (!(await hasAddon(trainerId, 'marketing'))) redirect('/settings?tab=addons')
  const canSend = await hasPermission('messages.send')
  const memberScope = scopeForMember(ctx, 'clients.viewAll')
  const { sent } = await searchParams

  const [trainer, eligibleCount, broadcasts] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: trainerId },
      select: { businessName: true, domainVerifiedAt: true, sendingFromEmail: true, useTrialSendingDomain: true },
    }),
    // Count of mailable clients (active, real email, not opted out) for the card.
    prisma.clientProfile.count({
      where: {
        trainerId,
        status: 'ACTIVE',
        isSample: false,
        marketingEmailOptOut: false,
        ...memberScope,
        user: { email: { not: { endsWith: NO_EMAIL_DOMAIN } } },
      },
    }),
    prisma.emailBroadcast.findMany({
      where: { trainerId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, subject: true, recipientCount: true, createdAt: true },
    }),
  ])

  // Aggregate per-broadcast recipient stats in one grouped query. A recipient's
  // `status` is its furthest-reached state, so OPENED/CLICKED imply delivered,
  // and CLICKED implies opened.
  const stats = broadcasts.length
    ? await prisma.emailBroadcastRecipient.groupBy({
        by: ['broadcastId', 'status'],
        where: { broadcastId: { in: broadcasts.map(b => b.id) } },
        _count: { _all: true },
      })
    : []
  const statsByBroadcast = new Map<string, { delivered: number; opened: number; clicked: number }>()
  for (const row of stats) {
    const s = statsByBroadcast.get(row.broadcastId) ?? { delivered: 0, opened: 0, clicked: 0 }
    const n = row._count._all
    if (row.status === 'CLICKED') { s.clicked += n; s.opened += n; s.delivered += n }
    else if (row.status === 'OPENED') { s.opened += n; s.delivered += n }
    else if (row.status === 'DELIVERED') { s.delivered += n }
    statsByBroadcast.set(row.broadcastId, s)
  }

  const broadcastRows = broadcasts.map(b => ({
    id: b.id,
    subject: b.subject,
    recipientCount: b.recipientCount,
    createdAt: b.createdAt.toISOString(),
    ...(statsByBroadcast.get(b.id) ?? { delivered: 0, opened: 0, clicked: 0 }),
  }))

  return (
    <>
      <PageHeader title="Marketing" subtitle="Email your clients" />
      <div className="p-4 md:p-8 w-full max-w-4xl mx-auto">
        <MarketingView
          businessName={trainer?.businessName ?? ''}
          domainVerified={!!trainer?.domainVerifiedAt}
          trialDomain={!!trainer?.useTrialSendingDomain}
          sendingFromEmail={trainer?.sendingFromEmail ?? null}
          canSend={canSend}
          eligibleCount={eligibleCount}
          broadcasts={broadcastRows}
          initialFlash={sent ?? null}
        />
      </div>
    </>
  )
}
