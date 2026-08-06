'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ShoppingBag, Ticket, Loader2, X, CreditCard, Gift, Clock } from 'lucide-react'
import { FlatBlock } from '@/components/shared/flat-list'
import { ModalPortal } from '@/components/shared/modal-portal'
import { useCurrency } from '@/components/currency-context'
import { formatMoney } from '@/lib/money'
import {
  paymentCaveat,
  chargeExplainer,
  cannotChargeReason,
  waitingOnClientLine,
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

  // The server's answer, recomputed whenever it changes.
  //
  // This used to be seeded into state with `useState(() => …)`, which runs ONCE
  // — so the router.refresh() below re-rendered this component with fresh props
  // and it ignored every one of them. It mattered because the dashboard renders
  // this panel TWICE, a phone copy and a desktop one: accepting in the copy you
  // can see removed the row there optimistically, and the other copy went on
  // showing the request forever. Same for anything that changed the list from
  // elsewhere — another device, another tab, a decline on the client's screen.
  const serverRows = useMemo<Row[]>(() => [
    ...initialMemberships.map(r => ({ kind: 'membership' as const, ...r })),
    ...initialProducts.map(r => ({ kind: 'product' as const, ...r })),
  ], [initialMemberships, initialProducts])

  // Answered here, and hidden immediately rather than waiting for the round
  // trip. Ids only, so a refreshed list is still the source of truth for
  // everything else — and once the server drops an answered row, its id here
  // simply stops matching anything.
  const [answeredIds, setAnsweredIds] = useState<ReadonlySet<string>>(new Set())
  const rows = serverRows.filter(r => !answeredIds.has(r.id))

  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PendingMembershipRequest | null>(null)

  if (rows.length === 0) return null

  /**
   * Answer a request.
   *
   * `verb` is the trainer's actual decision, not a boolean, because a package
   * request now has THREE answers and "accept: true" can no longer say which
   * one was meant:
   *  - CHARGE  → ask the client to subscribe and pay. Grants nothing.
   *  - GRANT   → hand the package over and collect the money separately.
   *  - DECLINE → no, or withdraw an invitation already sent.
   */
  async function action(row: Row, verb: 'CHARGE' | 'GRANT' | 'DECLINE') {
    if (busyId) return
    setBusyId(row.id)
    const answer = (on: boolean) => setAnsweredIds(prev => {
      const next = new Set(prev)
      if (on) next.add(row.id)
      else next.delete(row.id)
      return next
    })
    answer(true)
    const url = row.kind === 'product'
      ? `/api/product-requests/${row.id}`
      : `/api/membership-requests/${row.id}`
    // The shop route's decline verb is CANCELLED; packages call it DECLINED.
    const status = verb === 'DECLINE'
      ? (row.kind === 'product' ? 'CANCELLED' : 'DECLINED')
      : verb === 'CHARGE' ? 'INVITED' : 'FULFILLED'
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      // Put it back if the server refused; otherwise let the refreshed list
      // take over, which is now something this component actually notices.
      //
      // A successful CHARGE also puts the row back — the server keeps it, in an
      // INVITED "waiting on them" state, and hiding it here would tell the
      // trainer the job was done when nobody has paid yet.
      if (!res.ok || verb === 'CHARGE') answer(false)
      if (res.ok) startTransition(() => router.refresh())
    } catch {
      answer(false)
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
            // Already invited: the trainer has answered, and what is left is the
            // client's move. The row stays visible so they can see it is
            // outstanding, but it must not offer "Accept" again — that button
            // would grant for free the very plan they just asked to be paid for.
            const awaitingClient = row.kind === 'membership' && row.status === 'INVITED'
            const Icon = row.kind === 'product' ? ShoppingBag : awaitingClient ? Clock : Ticket
            const title = row.kind === 'product'
              ? (row.variantName ? `${row.product.name} — ${row.variantName}` : row.product.name)
              : row.membership.name
            const sub = row.kind === 'product'
              ? row.note
              : awaitingClient
                ? waitingOnClientLine()
                : requestReasonLine(row.membership, formatMoney(row.membership.priceCents, currency))

            return (
              <div key={row.id} data-testid="request-row" className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-3 py-2.5 sm:flex-nowrap sm:items-center">
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
                  {awaitingClient ? (
                    // Nothing to accept: they were asked to pay. The only move
                    // left is to take the invitation back, which is safe because
                    // it granted nothing in the first place.
                    <>
                      <span className="inline-flex h-8 items-center rounded-lg bg-amber-50 px-2.5 text-xs font-semibold text-amber-700">
                        Asked to pay
                      </span>
                      <button
                        type="button"
                        onClick={() => action(row, 'DECLINE')}
                        disabled={busy}
                        className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
                        Withdraw
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => row.kind === 'membership' ? setConfirming(row) : action(row, 'GRANT')}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />}
                        {row.kind === 'product' ? 'Mark done' : 'Accept'}
                      </button>
                      <button
                        type="button"
                        onClick={() => action(row, 'DECLINE')}
                        disabled={busy}
                        className="inline-flex h-8 items-center rounded-lg px-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  )}
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
          onChoose={(verb) => {
            const row = rows.find(r => r.id === confirming.id)
            setConfirming(null)
            if (row) action(row, verb)
          }}
        />
      )}
    </>
  )
}

/**
 * Accepting is TWO decisions, and this screen makes the trainer pick one.
 *
 * It used to be one button — "Accept & grant" — under a sentence saying
 * PupManager couldn't bill an ongoing plan. It can now, so the trainer gets the
 * choice they should always have had: ask the client to pay for it, or hand it
 * over and invoice for it themselves. Both are legitimate; plenty of trainers
 * bill outside the app and that behaviour is untouched.
 *
 * The order is deliberate. Charging is listed first and styled as the primary
 * action, because a plan given away by accident is money the trainer never gets
 * back and never notices going. Granting stays a full, unhidden option one tap
 * away — it is not a trap door, and the payment caveat is attached to it and
 * ONLY to it, where it is true.
 *
 * When the trainer can't take cards, the paid choice isn't offered at all — not
 * shown-and-disabled, and never inferred in the browser. The server resolves
 * `canCharge` from the real Connect capability, and the reason takes its place
 * so the absence isn't a mystery.
 */
function AcceptMembershipDialog({ request, currency, onCancel, onChoose }: {
  request: PendingMembershipRequest
  currency: string
  onCancel: () => void
  onChoose: (verb: 'CHARGE' | 'GRANT') => void
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
              {request.client.name} wants {request.membership.name}
            </h2>
            <button type="button" onClick={onCancel} aria-label="Close" className="-mr-1 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>

          <div className="px-4 py-4">
            {priced && (
              <p className="mb-3 text-sm text-slate-500">Listed at {priced}.</p>
            )}

            {/* One bordered block, hairline-split — the two choices are the same
                kind of thing and belong together, not on two floating cards. */}
            <div className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200">
              {request.canCharge && (
                <button
                  type="button"
                  data-testid="request-charge"
                  onClick={() => onChoose('CHARGE')}
                  className="flex w-full items-start gap-3 px-3.5 py-3 text-left hover:bg-slate-50"
                >
                  <CreditCard className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">Send them a payment link</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{chargeExplainer()}</span>
                  </span>
                </button>
              )}

              <button
                type="button"
                data-testid="request-grant"
                onClick={() => onChoose('GRANT')}
                className="flex w-full items-start gap-3 px-3.5 py-3 text-left hover:bg-slate-50"
              >
                <Gift className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-slate-700" strokeWidth={1.75} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-900">Grant it — I’ll invoice them</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Everything in the package is handed over straight away: 1:1 sessions
                    are scheduled, products are marked owed, and class places are booked.
                  </span>
                  {/* The caveat belongs to THIS choice and only this one. */}
                  <span className="mt-1.5 block text-xs font-medium text-slate-700">{paymentCaveat(request.reason)}</span>
                </span>
              </button>
            </div>

            {!request.canCharge && (
              <p className="mt-3 text-xs text-slate-500">{cannotChargeReason(request.membership.cadence)}</p>
            )}
          </div>

          <div className="flex items-center justify-end border-t border-slate-200 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  )
}
