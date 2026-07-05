'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { money, fmtDate, receivableBadge, XeroLink, ReceivableDocument, type Rcv } from '@/components/finances/receivable-document'

// The client's new-model invoices (payment-agnostic receivables), scoped to this
// client via the company-scoped, billing.view-guarded receivables list API.
// Shared by the profile's Invoices tab AND the Overview "Unpaid invoices" card.

function useClientReceivables(clientId: string) {
  const [items, setItems] = useState<Rcv[] | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // pageSize=100 pulls a client's whole invoice history in one request
      // (clients rarely exceed that); the API caps it defensively.
      const res = await fetch(`/api/trainer/finances/receivables?clientId=${encodeURIComponent(clientId)}&pageSize=100`)
      const d = res.ok ? await res.json() : null
      setItems(d?.items ?? [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { load() }, [load])
  return { items, loading, reload: load }
}

// Invoice table — clickable rows open the shared ReceivableDocument.
function InvoiceTable({ items, onOpen }: { items: Rcv[]; onOpen: (r: Rcv) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-3 font-medium">Invoice</th>
            <th className="py-2 px-3 font-medium">Date</th>
            <th className="py-2 px-3 font-medium text-right">Amount</th>
            <th className="py-2 px-3 font-medium text-right">Status</th>
            <th className="py-2 pl-3 font-medium text-right sr-only">Xero</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map(r => {
            const b = receivableBadge(r)
            return (
              <tr key={r.id} onClick={() => onOpen(r)} className="cursor-pointer hover:bg-slate-50">
                <td className="py-2.5 pr-3 font-medium text-slate-900">{r.description ?? 'Invoice'}</td>
                <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">{fmtDate(r.createdAt)}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-slate-900 whitespace-nowrap">
                  <span className="font-semibold">{money(r.amountCents, r.currency)}</span>
                  {r.status === 'PARTIAL' && (
                    <span className="block text-[11px] text-amber-600">paid {money(r.amountPaidCents, r.currency)} of {money(r.amountCents, r.currency)}</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${b.cls}`}>{b.label}</span>
                </td>
                <td className="py-2.5 pl-3 text-right">
                  {r.xeroInvoiceId && <span onClick={e => e.stopPropagation()} className="inline-flex"><XeroLink xeroInvoiceId={r.xeroInvoiceId} /></span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Full "Invoices" tab — the whole invoice history for this client.
export function ClientInvoicesTab({ clientId }: { clientId: string }) {
  const { items, loading, reload } = useClientReceivables(clientId)
  const [open, setOpen] = useState<Rcv | null>(null)
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all')

  const filtered = (items ?? []).filter(r =>
    filter === 'unpaid' ? (r.status === 'UNPAID' || r.status === 'PARTIAL')
    : filter === 'paid' ? r.status === 'PAID'
    : true,
  )

  return (
    <Card>
      <CardBody className="py-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
            {(['all', 'unpaid', 'paid'] as const).map(f => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-md px-3 py-1.5 capitalize transition-colors ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
            ))}
          </div>
        </div>
        {loading && !items ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 px-2 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (items?.length ?? 0) === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No invoices yet. They’re created automatically when you assign a priced package or product.</p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No {filter} invoices.</p>
        ) : (
          <InvoiceTable items={filtered} onOpen={setOpen} />
        )}
      </CardBody>
      {open && <ReceivableDocument summary={open} onClose={() => setOpen(null)} onSent={reload} />}
    </Card>
  )
}

// Overview "Unpaid invoices" card — the still-open (UNPAID/PARTIAL) invoices only.
export function ClientUnpaidInvoicesCard({ clientId, onViewAll }: { clientId: string; onViewAll?: () => void }) {
  const { items, loading, reload } = useClientReceivables(clientId)
  const [open, setOpen] = useState<Rcv | null>(null)
  const openItems = (items ?? []).filter(r => r.status === 'UNPAID' || r.status === 'PARTIAL')

  return (
    <Card>
      <CardBody className="py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Unpaid invoices</h2>
          {onViewAll && (items?.length ?? 0) > 0 && (
            <button type="button" onClick={onViewAll} className="text-xs font-medium text-blue-600 hover:underline">View all</button>
          )}
        </div>
        {loading && !items ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : openItems.length === 0 ? (
          <p className="text-sm text-slate-400">No unpaid invoices.</p>
        ) : (
          <InvoiceTable items={openItems} onOpen={setOpen} />
        )}
      </CardBody>
      {open && <ReceivableDocument summary={open} onClose={() => setOpen(null)} onSent={reload} />}
    </Card>
  )
}
