import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getActiveClient } from '@/lib/client-context'
import { prisma } from '@/lib/prisma'
import { loadPublishedMemberships, loadClientSubscriptions } from '@/lib/client-memberships'
import { PACKAGES_HIDDEN_FROM_CLIENTS } from '@/lib/feature-flags'
import { ClientMembershipsView } from './memberships-view'

export const metadata: Metadata = { title: 'Packages' }

// The standalone client-facing storefront for a trainer's published one-off
// memberships. Memberships now also appear as a type inside the Offerings flow
// (/my-availability) — this page stays as the checkout return target and a
// direct link, it's just no longer in the nav.
export default async function ClientMembershipsPage() {
  const active = await getActiveClient()
  if (!active) redirect('/login')
  const profile = await prisma.clientProfile.findUnique({
    where: { id: active.clientId },
    select: { id: true, trainerId: true, trainer: { select: { payoutCurrency: true } } },
  })
  if (!profile) redirect('/login')

  const currency = profile.trainer?.payoutCurrency ?? 'nzd'

  const memberships = PACKAGES_HIDDEN_FROM_CLIENTS
    ? []
    : await loadPublishedMemberships(profile.trainerId, profile.id)

  // Deliberately NOT behind PACKAGES_HIDDEN_FROM_CLIENTS. That flag hides the
  // STOREFRONT — what a client can buy. Someone who is already being charged
  // every month must always be able to see it and stop it; hiding their cancel
  // button behind a display kill-switch would be the exact dark pattern the
  // self-serve cancellation exists to prevent.
  const subscriptions = await loadClientSubscriptions(profile.id, currency)

  return (
    <ClientMembershipsView
      currency={currency}
      memberships={memberships}
      subscriptions={subscriptions}
    />
  )
}
