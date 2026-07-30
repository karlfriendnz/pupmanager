'use client'

import { MembershipCards } from '@/components/shared/membership-cards'
import type { ClientMembership } from '@/lib/client-memberships'
import { clientLabelFor } from '@/lib/nav-labels'
import { useNavLabelOverrides } from '@/components/shared/page-title'

export function ClientMembershipsView({ memberships, currency }: { memberships: ClientMembership[]; currency: string }) {
  // The trainer's word for these, same as the booking flow and the menu use.
  const title = clientLabelFor('/my-memberships', 'Packages', useNavLabelOverrides())
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">{title}</h1>
      <p className="text-slate-500 text-sm mb-5">Bundles of sessions and extras — everything below is included.</p>
      <MembershipCards memberships={memberships} currency={currency} />
    </div>
  )
}
