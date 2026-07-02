import { prisma } from '@/lib/prisma'
import { PromoCodeCreate, PromoCodeRow } from './promo-code-actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Admin · Promo codes' }

// Promo codes a trainer can enter at signup to set their total trial length.
export default async function AdminPromoCodesPage() {
  const codes = await prisma.promoCode.findMany({ orderBy: { createdAt: 'desc' } })
  const now = Date.now()

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Promo codes</h1>
        <p className="text-slate-400 text-sm mt-1">
          A trainer enters one of these at signup and it sets their total free-trial length.
        </p>
      </div>

      <PromoCodeCreate />

      <div className="bg-slate-800 rounded-2xl border border-slate-700 overflow-hidden">
        {/* overflow-x-auto + min-w lets the seven columns scroll horizontally on
            a phone instead of squashing into an unreadable mess. */}
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400 text-xs uppercase">
              <th className="text-left px-4 py-3">Code</th>
              <th className="text-left px-4 py-3">Trial</th>
              <th className="text-left px-4 py-3">Redemptions</th>
              <th className="text-left px-4 py-3">Expires</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {codes.map(c => (
              <PromoCodeRow key={c.id} promo={c} now={now} />
            ))}
          </tbody>
        </table>
        </div>
        {codes.length === 0 && (
          <p className="text-center py-8 text-slate-500">No promo codes yet — create one above.</p>
        )}
      </div>
    </div>
  )
}
