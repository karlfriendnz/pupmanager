import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getActiveClient } from '@/lib/client-context'
import { prisma } from '@/lib/prisma'
import { loadPublishedMemberships } from '@/lib/client-memberships'
import { ClientMembershipsView } from './memberships-view'

export const metadata: Metadata = { title: 'Memberships' }

// The standalone client-facing storefront for a trainer's published one-off
// memberships. Memberships now also appear as a type inside the Offerings flow
// (/my-availability) — this page stays as the checkout return target and a
// direct link, it's just no longer in the nav.
export default async function ClientMembershipsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { trainerId: true, trainer: { select: { payoutCurrency: true } } },
  })
  if (!profile) redirect('/login')

  const memberships = await loadPublishedMemberships(profile.trainerId)

  return (
    <ClientMembershipsView
      currency={profile.trainer?.payoutCurrency ?? 'nzd'}
      memberships={memberships}
    />
  )
}
