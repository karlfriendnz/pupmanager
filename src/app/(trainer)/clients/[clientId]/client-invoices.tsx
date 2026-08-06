'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Card, CardBody } from '@/components/ui/card'
import { money, fmtDate, receivableBadge, XeroLink, ReceivableDocument, RecordPaymentModal, type Rcv } from '@/components/finances/receivable-document'

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

// The list block. Identical treatment to the Finances list, and for the same
// measured reason: the client page's own `p-4` wrapper, plus this block's 1px
// side border, plus each row's 16px padding stacked to ~33px of dead margin
// down BOTH edges of a 390px screen — which is what wrapped an untruncated
// invoice description into three ragged lines while the screen edges sat empty.
// Negating the page padding hands those 34px back to the content and leaves a
// single hairline rule per row. Desktop keeps the rounded card.
const LIST_BLOCK = '-mx-4 border-y border-slate-200 bg-white overflow-hidden md:mx-0 md:rounded-2xl md:border'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'unpaid', label: 'Unpaid' },
  { id: 'paid', label: 'Paid' },
] as const
type InvoiceFilter = typeof FILTERS[number]['id']

// Full "Invoices" tab — the whole invoice history for this client.
export function ClientInvoicesTab({ clientId }: { clientId: string }) {
  const { items, loading, reload } = useClientReceivables(clientId)
  const [open, setOpen] = useState<Rcv | null>(null)
  const [filter, setFilter] = useState<InvoiceFilter>('all')

  const filtered = (items ?? []).filter(r =>
    filter === 'unpaid' ? (r.status === 'UNPAID' || r.status === 'PARTIAL')
    : filter === 'paid' ? r.status === 'PAID'
    : true,
  )

  return (
    <div className="flex flex-col gap-3">
      {/* Underline rail, not a segmented pill on a grey tray — the same control
          Finances uses one tap away, so the two screens read alike. */}
      <div className="flex gap-1 border-b border-slate-200">
        {FILTERS.map(f => {
          const active = filter === f.id
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              aria-pressed={active}
              className={`relative px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${active ? 'text-accent' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {f.label}
              {active && <span className="absolute -bottom-px left-3 right-3 h-0.5 rounded-full bg-accent" />}
            </button>
          )
        })}
      </div>

      <div className={LIST_BLOCK}>
        {loading && !items ? (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (items?.length ?? 0) === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-400">No invoices yet. They’re created automatically when you assign a priced 1:1 session or product.</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-8 text-sm text-slate-400">No {filter} invoices.</p>
        ) : (
          <>
            {/* Mobile: stacked rows. The description flexes and TRUNCATES; the
                money column and the Xero slot are fixed widths, so the amount,
                the badge and the icon each hold one column down the whole list
                — including rows with no Xero icon, whose slot stays reserved
                rather than collapsing and shifting everything sideways. */}
            <div className="divide-y divide-slate-100 md:hidden">
              {filtered.map(r => {
                const b = receivableBadge(r)
                return (
                  <div key={r.id} data-testid="client-invoice-row" onClick={() => setOpen(r)} className="cursor-pointer px-4 py-3.5 active:bg-slate-50">
                    <div className="flex items-start gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p data-testid="client-invoice-desc" className="truncate text-sm font-medium text-slate-900">{r.description ?? 'Invoice'}</p>
                        <p className="truncate text-xs text-slate-400">issued {fmtDate(r.createdAt)}</p>
                      </div>
                      <div className="w-24 shrink-0 text-right">
                        <p data-testid="client-invoice-amount" className="whitespace-nowrap text-sm font-semibold tabular-nums text-slate-900">{money(r.amountCents, r.currency)}</p>
                        {r.status === 'PARTIAL' && (
                          <p className="whitespace-nowrap text-[11px] tabular-nums text-amber-600">{money(r.amountPaidCents, r.currency)} paid</p>
                        )}
                        <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${b.cls}`}>{b.label}</span>
                      </div>
                      <div className="flex w-6 shrink-0 justify-center pt-0.5">
                        {r.xeroInvoiceId && <span onClick={e => e.stopPropagation()} className="inline-flex"><XeroLink xeroInvoiceId={r.xeroInvoiceId} /></span>}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="px-4 pt-4 pb-2 font-medium">Issued</th>
                    <th className="px-4 pt-4 pb-2 font-medium">For</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right">Amount</th>
                    <th className="px-4 pt-4 pb-2 font-medium">Status</th>
                    <th className="w-10 px-4 pt-4 pb-2 font-medium text-right" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const b = receivableBadge(r)
                    return (
                      <tr key={r.id} data-testid="client-invoice-row-desktop" onClick={() => setOpen(r)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">{fmtDate(r.createdAt)}</td>
                        {/* Bounded so a very long description can't stretch the
                            table and shove the amount/status columns sideways. */}
                        <td className="max-w-[26rem] px-4 py-2.5 text-slate-700">
                          <span className="block truncate">{r.description ?? 'Invoice'}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-slate-900">
                          {money(r.amountCents, r.currency)}
                          {r.status === 'PARTIAL' && (
                            <span className="block text-[11px] font-normal text-amber-600">{money(r.amountPaidCents, r.currency)} paid</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5"><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${b.cls}`}>{b.label}</span></td>
                        <td className="px-4 py-2.5 text-right">
                          {r.xeroInvoiceId && <span onClick={e => e.stopPropagation()} className="inline-flex"><XeroLink xeroInvoiceId={r.xeroInvoiceId} /></span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {open && <ReceivableDocument summary={open} onClose={() => setOpen(null)} onSent={reload} />}
    </div>
  )
}

// Overview "Unpaid invoices" card — the still-open (UNPAID/PARTIAL) invoices only.
export function ClientUnpaidInvoicesCard({ clientId, viewAllHref }: { clientId: string; viewAllHref?: string }) {
  const { items, loading, reload } = useClientReceivables(clientId)
  const [open, setOpen] = useState<Rcv | null>(null)
  const openItems = (items ?? []).filter(r => r.status === 'UNPAID' || r.status === 'PARTIAL')

  // Combining is only offered for invoices with nothing paid against them —
  // merging a part-paid one would strand that payment (the API refuses it too).
  const combinable = openItems.filter(r => r.amountPaidCents === 0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<null | 'combine' | 'pay'>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [payFor, setPayFor] = useState<Rcv | null>(null)

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function combineSelected() {
    if (selected.size < 2 || busy) return
    setBusy('combine'); setMsg(null)
    try {
      const res = await fetch('/api/trainer/finances/receivables/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceIds: [...selected] }),
      })
      const body = await res.json().catch(() => null) as { error?: unknown } | null
      if (!res.ok) { setMsg(typeof body?.error === 'string' ? body.error : 'Could not combine those invoices.'); return }
      setSelected(new Set())
      setMsg('Combined into one invoice — send it when you’re ready.')
      reload()
    } finally { setBusy(null) }
  }

  return (
    <Card>
      <CardBody className="py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900">Unpaid invoices</h2>
          {/* Invoices are their own PAGE now, so this is a link rather than a
              tab switch — the trainer can middle-click it and back returns. */}
          {viewAllHref && (items?.length ?? 0) > 0 && (
            <Link href={viewAllHref} className="text-xs font-medium text-blue-600 hover:underline">View all</Link>
          )}
        </div>
        {loading && !items ? (
          <div className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : openItems.length === 0 ? (
          <p className="text-sm text-slate-400">No unpaid invoices.</p>
        ) : (
          <>
            {/* Tick two or more to bill them as one — a client with five
                outstanding invoices otherwise has to pay five times. */}
            <ul className="divide-y divide-slate-100">
              {openItems.map(r => {
                const canCombine = r.amountPaidCents === 0
                return (
                  <li key={r.id} className="flex items-center gap-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      disabled={!canCombine}
                      onChange={() => toggle(r.id)}
                      aria-label={`Select ${r.description ?? 'invoice'} to combine`}
                      title={canCombine ? 'Select to combine' : 'Part-paid invoices can’t be combined'}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-30"
                    />
                    <button type="button" onClick={() => setOpen(r)} className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm font-medium text-slate-900">{r.description ?? 'Invoice'}</span>
                      <span className="block text-[11px] text-slate-400">
                        {fmtDate(r.createdAt)}
                        {r.amountPaidCents > 0 && ` · ${money(r.amountPaidCents, r.currency)} paid`}
                      </span>
                    </button>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {money(r.amountCents - r.amountPaidCents, r.currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setPayFor(r); setMsg(null) }}
                      className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Mark paid
                    </button>
                  </li>
                )
              })}
            </ul>

            {combinable.length > 1 && (
              <div className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={combineSelected}
                  disabled={selected.size < 2 || busy !== null}
                  className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-strong disabled:opacity-40"
                >
                  {busy === 'combine' ? 'Combining…' : `Combine ${selected.size > 1 ? selected.size + ' ' : ''}into one invoice`}
                </button>
                {selected.size > 0 && (
                  <span className="text-[11px] text-slate-400">
                    {money(openItems.filter(r => selected.has(r.id)).reduce((s, r) => s + r.amountCents, 0), openItems[0].currency)} total
                  </span>
                )}
              </div>
            )}
            {msg && <p className="mt-2 text-[11px] font-medium text-slate-500">{msg}</p>}
          </>
        )}
      </CardBody>
      {open && <ReceivableDocument summary={open} onClose={() => setOpen(null)} onSent={reload} />}
      {payFor && (
        <RecordPaymentModal
          invoice={payFor}
          onClose={() => setPayFor(null)}
          onDone={() => { setPayFor(null); setMsg('Payment recorded.'); reload() }}
        />
      )}
    </Card>
  )
}
