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

// One tappable invoice row (opens the shared ReceivableDocument on click).
function InvoiceRow({ r, onOpen }: { r: Rcv; onOpen: () => void }) {
  const b = receivableBadge(r)
  return (
    <button type="button" onClick={onOpen} className="w-full text-left flex items-center justify-between gap-3 py-2.5 px-2 -mx-2 rounded-lg hover:bg-slate-50">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{r.description ?? 'Invoice'}</p>
        <p className="text-xs text-slate-400">{fmtDate(r.createdAt)}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="text-right">
          <p className="text-sm font-semibold tabular-nums text-slate-900">{money(r.amountCents, r.currency)}</p>
          {r.status === 'PARTIAL' && (
            <p className="text-[11px] tabular-nums text-amber-600">paid {money(r.amountPaidCents, r.currency)} of {money(r.amountCents, r.currency)}</p>
          )}
        </div>
        {r.xeroInvoiceId && <XeroLink xeroInvoiceId={r.xeroInvoiceId} />}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${b.cls}`}>{b.label}</span>
      </div>
    </button>
  )
}

// Full "Invoices" tab — the whole invoice history for this client.
export function ClientInvoicesTab({ clientId }: { clientId: string }) {
  const { items, loading, reload } = useClientReceivables(clientId)
  const [open, setOpen] = useState<Rcv | null>(null)

  return (
    <Card>
      <CardBody className="py-3">
        {loading && !items ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 px-2 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !items || items.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <p className="text-sm">No invoices yet. They’re created automatically when you assign a priced package or product.</p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {items.map(r => <li key={r.id}><InvoiceRow r={r} onOpen={() => setOpen(r)} /></li>)}
          </ul>
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
          <ul className="flex flex-col divide-y divide-slate-100">
            {openItems.map(r => <li key={r.id}><InvoiceRow r={r} onOpen={() => setOpen(r)} /></li>)}
          </ul>
        )}
      </CardBody>
      {open && <ReceivableDocument summary={open} onClose={() => setOpen(null)} onSent={reload} />}
    </Card>
  )
}
