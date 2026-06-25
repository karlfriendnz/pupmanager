import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getTrainerContext } from '@/lib/membership'
import { PageHeader } from '@/components/shared/page-header'
import { TimesheetsView } from './timesheets-view'
import { canViewAllTimesheets } from '@/app/api/timesheets/_access'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Timesheets' }

export default async function TimesheetsPage() {
  const ctx = await getTrainerContext()
  if (!ctx) redirect('/login')

  // Owners/managers can browse every member's timesheets via tabs; staff only
  // ever see their own, so we don't even load the roster for them.
  const [profile, roster] = await Promise.all([
    prisma.trainerProfile.findUnique({
      where: { id: ctx.companyId },
      select: { payoutCurrency: true },
    }),
    canViewAllTimesheets(ctx)
      ? prisma.trainerMembership.findMany({
          where: { companyId: ctx.companyId },
          select: { id: true, role: true, userId: true, user: { select: { name: true, email: true } } },
          orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }],
        })
      : Promise.resolve([]),
  ])

  // Build the tab list. The logged-in user goes first ("You"); everyone else
  // follows. With only one member (or staff), `members` is empty → no tabs.
  const members = roster
    .map((m) => ({
      id: m.id,
      name: m.user.name?.trim() || m.user.email || 'Trainer',
      isSelf: m.userId === ctx.userId,
    }))
    .sort((a, b) => (a.isSelf === b.isSelf ? 0 : a.isSelf ? -1 : 1))

  return (
    <>
      <PageHeader title="Timesheets" />
      <div className="p-4 md:p-8 w-full max-w-2xl md:max-w-4xl mx-auto">
        <TimesheetsView
          currency={profile?.payoutCurrency ?? 'nzd'}
          isOwner={ctx.role === 'OWNER'}
          members={members.length > 1 ? members : []}
        />
      </div>
    </>
  )
}
