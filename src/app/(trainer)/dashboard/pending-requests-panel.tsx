'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShoppingBag, Ticket, Loader2, X } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'
import { ModalPortal } from '@/components/shared/modal-portal'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import {
  paymentCaveat,
  requestReasonLine,
  INTERVAL_LABEL,
  type PendingProductRequest,
  type PendingMembershipRequest,
} from '@/lib/membership-request-shape'

// Everything a client has asked for and not been answered on, in ONE block.
//
// Two kinds land here — a shop product and a package the client can't check out
// (a recurring plan, or one with no price). They are the same job for the
// trainer ("someone wants this, say yes or no"), so per AGENTS.md they aggregate
// rather than getting a strip each. The dashboard is the surface because it is
// the screen a trainer opens every morning; a request sitting on the Packages
// screen is a request nobody sees for a week.

type Row =
  | ({ kind: 'product' } & PendingProductRequest)
  | ({ kind: 'membership' } & PendingMembershipRequest)

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export function PendingRequestsPanel({
  requests: initialProducts,
  membershipRequests: initialMemberships = [],
}: {
  requests: PendingProductRequest[]
  membershipRequests?: PendingMembershipRequest[]
}) {
  const router = useRouter()
  const currency = useCurrency()
  const [, startTransition] = useTransition()
  const [rows, setRows] = useState<Row[]>(() => [
    ...initialMemberships.map(r => ({ kind: 'membership' as const, ...r })),
    ...initialProducts.map(r => ({ kind: 'product' as const, ...r })),
  ])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PendingMembershipRequest | null>(null)

  if (rows.length === 0) return null

  async function action(row: Row, accept: boolean) {
    if (busyId) return
    setBusyId(row.id)
    const removed = row
    setRows(prev => prev.filter(r => r.id !== row.id))
    const url = row.kind === 'product'
      ? `/api/product-requests/${row.id}`
      : `/api/membership-requests/${row.id}`
    // The shop route's decline verb is CANCELLED; packages call it DECLINED.
    const status = accept ? 'FULFILLED' : row.kind === 'product' ? 'CANCELLED' : 'DECLINED'
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) setRows(prev => [removed, ...prev])
      else startTransition(() => router.refresh())
    } catch {
      setRows(prev => [removed, ...prev])
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="mb-6">
        <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-slate-400">
          {rows.length} request{rows.length === 1 ? '' : 's'} from clients
        </p>
        <FlatBlock>
          {rows.map(row => {
            const busy = busyId === row.id
            const Icon = row.kind === 'product' ? ShoppingBag : Ticket
            const title = row.kind === 'product' ? row.product.name : row.membership.name
            const sub = row.kind === 'product'
              ? row.note
              : requestReasonLine(row.membership, formatMoney(row.membership.priceCents, currency))

            return (
              <div key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 sm:flex-nowrap sm:items-center">
                <Icon className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700 sm:mt-0" strokeWidth={1.75} />

                {/* basis forces the actions onto their own line at 390px —
                    they'd otherwise squeeze the name down to a few characters. */}
                <div className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] sm:basis-0">
                  <p className="truncate text-sm font-medium text-slate-900">{title}</p>
                  <p className="truncate text-xs text-slate-500">
                    <Link href={`/clients/${row.client.id}`} className="hover:underline">{row.client.name}</Link>
                    <span className="text-slate-400"> · {timeAgo(row.createdAt)}</span>
                  </p>
                  {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
                </div>

                {/* Actions sit on the row, not behind a "…" — and wrap to their
                    own line at 390px rather than crushing the name.
                    
                    Accept is a filled button and Decline is quiet text. Two
                    text links do opposite things with equal weight, which makes
                    you read both before choosing; a button says which one the
                    screen expects, and leaves the other one available rather
                    than hidden. The colour is semantic (yes / no), not
                    decoration and not the trainer's accent, which is why it can
                    sit beside their brand without competing with it. */}
                <div className="ml-[30px] flex flex-shrink-0 items-center gap-1.5 sm:ml-0">
                  <button
                    type="button"
                    onClick={() => row.kind === 'membership' ? setConfirming(row) : action(row, true)}
                    disabled={busy}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
                    {row.kind === 'product' ? 'Mark done' : 'Accept'}
                  </button>
                  <button
                    type="button"
                    onClick={() => action(row, false)}
                    disabled={busy}
                    className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              </div>
            )
          })}
        </FlatBlock>
      </div>

      {confirming && (
        <AcceptMembershipDialog
          request={confirming}
          currency={currency}
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            const row = rows.find(r => r.id === confirming.id)
            setConfirming(null)
            if (row) action(row, true)
          }}
        />
      )}
    </>
  )
}

/**
 * Accepting grants the package. It does NOT take money, and this is the screen
 * that has to say so — a trainer who thinks a recurring plan is now billing
 * itself will not invoice, and will not find out for a month.
 */
function AcceptMembershipDialog({ request, currency, onCancel, onConfirm }: {
  request: PendingMembershipRequest
  currency: string
  onCancel: () => void
  onConfirm: () => void
}) {
  // Never two scrollbars: the page behind is frozen for as long as this is open.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const priced = request.membership.priceCents > 0
    ? `${formatMoney(request.membership.priceCents, currency)}${request.membership.interval ? ` / ${INTERVAL_LABEL[request.membership.interval]}` : ''}`
    : null

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="accept-request-title">
        <div className="no-scrollbar max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white sm:max-w-md sm:rounded-2xl">
          <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
            <h2 id="accept-request-title" className="min-w-0 flex-1 text-base font-semibold text-slate-900">
              Put {request.client.name} on {request.membership.name}?
            </h2>
            <button type="button" onClick={onCancel} aria-label="Close" className="-mr-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex flex-col gap-3 px-4 py-4 text-sm text-slate-600">
            <p>
              Everything in the package is granted straight away — 1:1 session
              sessions are scheduled, products are marked owed, and class places
              are booked.
            </p>
            <p className="font-medium text-slate-900">{paymentCaveat(request.reason)}</p>
            {priced && (
              <p className="text-xs text-slate-500">
                The package is listed at {priced}. Nothing will be charged to their card.
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            {/* Green, because a green Accept is what opened this — a black
                confirm at the end of that reads as a different decision. */}
            <button type="button" onClick={onConfirm} className="inline-flex h-9 items-center rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700">
              Accept &amp; grant
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
