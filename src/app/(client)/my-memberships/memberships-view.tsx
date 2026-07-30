'use client'

import { MembershipCards } from '@/components/shared/membership-cards'
import { ClientSubscriptions } from './client-subscriptions'
import type { ClientMembership, ClientSubscription } from '@/lib/client-memberships'
import { clientLabelFor } from '@/lib/nav-labels'
import { useNavLabelOverrides } from '@/components/shared/page-title'

export function ClientMembershipsView({
  memberships,
  currency,
  subscriptions,
}: {
  memberships: ClientMembership[]
  currency: string
  subscriptions: ClientSubscription[]
}) {
  // The trainer's word for these, same as the booking flow and the menu use.
  const title = clientLabelFor('/my-memberships', 'Packages', useNavLabelOverrides())
  // The storefront can be empty (packages hidden, or none published) while the
  // client still has a live plan to manage — so the two sections are
  // independent, and the page only says "nothing here" when BOTH are empty.
  const hasAnything = memberships.length > 0 || subscriptions.length > 0

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-slate-500 text-sm mb-5">Bundles of sessions and extras — everything below is included.</p>
      <ClientSubscriptions subscriptions={subscriptions} />
      {memberships.length > 0 || !hasAnything ? (
        <MembershipCards memberships={memberships} currency={currency} />
      ) : null}
    </div>
  )
}
