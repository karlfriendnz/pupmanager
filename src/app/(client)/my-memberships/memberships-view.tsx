'use client'

import { MembershipCards } from '@/components/shared/membership-cards'
import type { ClientMembership } from '@/lib/client-memberships'

export function ClientMembershipsView({ memberships, currency }: { memberships: ClientMembership[]; currency: string }) {
  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Packages</h1>
      <p className="text-slate-500 text-sm mb-5">Bundles of sessions and extras — everything below is included.</p>
      <MembershipCards memberships={memberships} currency={currency} />
    </div>
  )
}
