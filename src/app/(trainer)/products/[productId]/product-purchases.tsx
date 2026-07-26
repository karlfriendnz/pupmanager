'use client'

import Link from 'next/link'
import { formatMoney } from '@/lib/money'
import { useCurrency } from '@/components/currency-context'
import { SectionLabel } from '@/components/shared/flat-list'
import { ShoppingBag, ChevronRight } from 'lucide-react'

export interface Purchase {
  id: string
  clientId: string | null
  clientName: string
  dogName: string | null
  /** PAID = money taken, OWING = invoiced/pay-later, REQUESTED = asked for it. */
  state: 'PAID' | 'OWING' | 'REQUESTED'
  amountCents: number | null
  at: string // ISO
}

const STATE_LABEL: Record<Purchase['state'], string> = {
  PAID: 'Paid',
  OWING: 'Pay later',
  REQUESTED: 'Requested',
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Who has this product.
 *
 * Aggregated on purpose (AGENTS.md: "aggregate, don't fragment") — a paid
 * checkout, a pay-later invoice and a standing request are all "someone has
 * this", so they share one list with a state word rather than three sections.
 */
export function ProductPurchases({ purchases }: { purchases: Purchase[] }) {
  const currency = useCurrency()

  if (purchases.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center">
        <ShoppingBag className="mx-auto h-7 w-7 text-slate-300" strokeWidth={1.75} />
        <p className="mt-3 text-sm font-medium text-slate-600">Nobody has bought this yet</p>
        <p className="mt-1 text-xs text-slate-400">
          Purchases, pay-later orders and standing requests all show up here.
        </p>
      </div>
    )
  }

  const paid = purchases.filter(p => p.state === 'PAID')
  const revenueCents = paid.reduce((sum, p) => sum + (p.amountCents ?? 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <section>
        <SectionLabel>Summary</SectionLabel>
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-white [&>*]:border-r [&>*]:border-slate-200 [&>*:last-child]:border-r-0">
          <div className="px-4 py-3.5">
            <p className="text-xs text-slate-500">Clients</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{purchases.length}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-xs text-slate-500">Taken</p>
            <p className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">
              {formatMoney(revenueCents, currency)}
            </p>
          </div>
        </div>
      </section>

      <section>
        <SectionLabel>{purchases.length === 1 ? '1 client' : `${purchases.length} clients`}</SectionLabel>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white [&>*+*]:border-t [&>*+*]:border-slate-200">
          {purchases.map(p => {
            const body = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-900">
                    {p.clientName}
                    {p.dogName && <span className="text-slate-400"> · {p.dogName}</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-slate-500">
                    {STATE_LABEL[p.state]} · {formatWhen(p.at)}
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-2">
                  {p.amountCents != null && (
                    <span className="text-sm font-medium tabular-nums text-slate-700">
                      {formatMoney(p.amountCents, currency)}
                    </span>
                  )}
                  {p.clientId && <ChevronRight className="h-4 w-4 text-slate-400" />}
                </span>
              </>
            )
            const cls = 'flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50'
            return p.clientId ? (
              <Link key={p.id} href={`/clients/${p.clientId}`} className={cls}>{body}</Link>
            ) : (
              <div key={p.id} className={cls}>{body}</div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
