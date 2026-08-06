'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Plus, X } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { EditScreen } from '@/components/shared/edit-screen'
import { formatDate } from '@/lib/utils'
import type { HandedOverRequest, PendingProductRequest } from './client-profile-types'

/**
 * A client's products, as a page of their own (Karl, 2026-08-06: "nah i think
 * we need a 'products' tab/page").
 *
 * TWO lists, under two headings, because they are two different facts and
 * merging them would lose the one that matters:
 *
 *   · **Bring to next session** — PENDING requests. What the trainer has set
 *     aside to hand over. This is the list that used to sit on the profile as a
 *     card, and it carried the ONLY "Add product" for a specific client
 *     anywhere in the app, which is why it moved rather than being deleted.
 *   · **Handed over** — the same rows once they are FULFILLED, newest first.
 *     A trainer asking "did I already give them the long line?" has nowhere
 *     else to look.
 *
 * Not a third list of "recommendations": nothing in the schema records one, and
 * a heading with nothing behind it is worse than no heading.
 *
 * Not a tab strip either. Two headings on one page is the smaller thing, and a
 * strip inside a section page would be the tabs we have just spent the day
 * taking out.
 *
 * `Add product` is a PAGE, not a sheet (Karl: "should be a page") — see
 * `[section]/add/page.tsx`. It POSTs to the same route it always did.
 */
export function ClientProductsSection({
  clientId,
  hasProducts,
  pending: initialPending,
  handedOver,
  canEdit,
}: {
  clientId: string
  /** The trainer has a shop to pick from — gates the Add product action. */
  hasProducts: boolean
  pending: PendingProductRequest[]
  handedOver: HandedOverRequest[]
  canEdit: boolean
}) {
  const [pending, setPending] = useState(initialPending)
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null)

  async function dismissRequest(requestId: string) {
    if (busyRequestId) return
    setBusyRequestId(requestId)
    const removed = pending.find(r => r.id === requestId)
    setPending(prev => prev.filter(r => r.id !== requestId))
    try {
      const res = await fetch(`/api/product-requests/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      })
      if (!res.ok && removed) setPending(prev => [...prev, removed])
    } catch {
      if (removed) setPending(prev => [...prev, removed])
    } finally {
      setBusyRequestId(null)
    }
  }


  const body = (
    <div className="flex flex-col gap-6">
      <Card>
        <CardBody className="py-5">
          <h2 className="text-sm font-semibold text-slate-900">Bring to next session</h2>
          {/* No "nothing pending" line: "Add product" is pinned to the foot of
              the screen, and an empty state next to the action that resolves it
              says the same thing twice. */}
          {pending.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {pending.map(r => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-900 bg-amber-50 border border-amber-100 pl-3 pr-1.5 py-1 rounded-full"
                  title={r.note ?? undefined}
                >
                  {/* The option is part of the name here — "a harness" is not
                      something anyone can go and fetch. Nor is one harness when
                      three were ordered, so the count rides along whenever it
                      isn't one. */}
                  {r.variant ? `${r.product.name} — ${r.variant.name}` : r.product.name}
                  {r.quantity > 1 && (
                    <span className="ml-0.5 font-semibold tabular-nums">× {r.quantity}</span>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => dismissRequest(r.id)}
                      disabled={busyRequestId === r.id}
                      aria-label={`Remove ${r.product.name}`}
                      className="ml-1 h-5 w-5 rounded-full hover:bg-amber-100 flex items-center justify-center text-amber-700 disabled:opacity-50"
                    >
                      {busyRequestId === r.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <X className="h-3 w-3" />}
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {canEdit && !hasProducts && (
            // The one empty state worth keeping: it is not about this client at
            // all, and the fix is on another screen.
            <p className="mt-3 text-sm text-slate-400">
              No products in your shop yet — <Link href="/products" className="text-blue-600 hover:underline">add some</Link> and they&apos;ll be pickable here.
            </p>
          )}
        </CardBody>
      </Card>

      {handedOver.length > 0 && (
        <Card>
          <CardBody className="py-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Handed over</h2>
            <ul className="divide-y divide-slate-100">
              {handedOver.map(r => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                    {r.variant ? `${r.product.name} — ${r.variant.name}` : r.product.name}
                    {r.quantity > 1 && (
                      <span className="ml-1 font-semibold tabular-nums">× {r.quantity}</span>
                    )}
                  </span>
                  {r.fulfilledAt && (
                    <span className="shrink-0 text-xs text-slate-400">{formatDate(r.fulfilledAt)}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  )

  if (!canEdit || !hasProducts) return body

  return (
    <EditScreen
      primary={{
        label: 'Add product',
        icon: <Plus className="h-4 w-4" strokeWidth={1.75} />,
        // A PAGE, not a sheet (Karl: "should be a page"). Its own route under
        // the client, with the same chrome as every other screen in here.
        href: `/clients/${clientId}/products/add`,
      }}
    >
      {body}
    </EditScreen>
  )
}
