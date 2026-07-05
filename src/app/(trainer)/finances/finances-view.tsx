'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Receipt, ArrowLeftRight, FileText, Search, Loader2, ChevronLeft, ChevronRight, X, Copy, Check, Send, RotateCcw, Printer, Pencil, Plus, Trash2 } from 'lucide-react'

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }
function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Page<T> { page: number; totalPages: number; total: number; items: T[]; xeroConnected?: boolean }

// Shared fetch + debounced search + pagination for a finance endpoint.
function useFinanceList<T>(endpoint: string, extra = '') {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Page<T> | null>(null)
  const [loading, setLoading] = useState(true)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (query: string, p: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: String(p) })
      if (extra) for (const [k, v] of new URLSearchParams(extra)) params.set(k, v)
      const res = await fetch(`${endpoint}?${params.toString()}`)
      setData(res.ok ? await res.json() : null)
    } finally {
      setLoading(false)
    }
  }, [endpoint, extra])

  useEffect(() => { load('', 1) }, [load])

  function onSearch(value: string) {
    setQ(value)
    setPage(1)
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => load(value, 1), 300)
  }
  function goTo(p: number) { setPage(p); load(q, p) }

  return { q, page, data, loading, onSearch, goTo, reload: () => load(q, page) }
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-accent"
      />
    </div>
  )
}

function Pager({ page, totalPages, total, onGo, loading }: { page: number; totalPages: number; total: number; onGo: (p: number) => void; loading: boolean }) {
  if (total === 0) return null
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-sm text-slate-500">
      <span className="tabular-nums">{total} total</span>
      <div className="flex items-center gap-2">
        <button onClick={() => onGo(page - 1)} disabled={page <= 1 || loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 h-8 disabled:opacity-40 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
        <span className="tabular-nums">{page} / {totalPages}</span>
        <button onClick={() => onGo(page + 1)} disabled={page >= totalPages || loading} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 h-8 disabled:opacity-40 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
      </div>
    </div>
  )
}

interface Tx {
  id: string; description: string | null; clientName: string | null
  amountTotal: number; currency: string; applicationFeeAmount: number
  stripeFeeAmount: number | null; amountRefunded: number; status: string; paidAt: string | null
}

const TX_BADGE: Record<string, string> = {
  PAID: 'bg-emerald-100 text-emerald-700', PARTIALLY_REFUNDED: 'bg-amber-100 text-amber-700',
  REFUNDED: 'bg-slate-100 text-slate-500', DISPUTED: 'bg-rose-100 text-rose-700',
}
const TX_LABEL: Record<string, string> = { PAID: 'Paid', PARTIALLY_REFUNDED: 'Part refund', REFUNDED: 'Refunded', DISPUTED: 'Disputed' }

// Derived figures shared by the mobile cards + desktop table. The trainer is the
// merchant of record on the direct charge, so the processing (card) fee is
// theirs — their take-home is gross minus refunds minus that fee (minus any
// legacy in-app application fee, which is 0 under the current pricing model).
function txDerived(t: Tx) {
  const cardFee = t.stripeFeeAmount ?? 0
  const refundFraction = t.amountTotal > 0 ? t.amountRefunded / t.amountTotal : 0
  const platformRetained = Math.round(t.applicationFeeAmount * (1 - refundFraction))
  const net = t.amountTotal - t.amountRefunded - cardFee - platformRetained
  const refundable = t.status === 'PAID' || t.status === 'PARTIALLY_REFUNDED'
  return { cardFee, net, refundable }
}

function TransactionsTab() {
  const { q, data, loading, onSearch, goTo, reload } = useFinanceList<Tx>('/api/trainer/finances/transactions')
  const [open, setOpen] = useState<Tx | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <SearchBar value={q} onChange={onSearch} placeholder="Search by item or client…" />
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 px-5 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 py-8">{q ? 'No transactions match your search.' : 'No transactions yet.'}</p>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.items.map(t => {
                const { cardFee, net } = txDerived(t)
                return (
                  <button key={t.id} type="button" onClick={() => setOpen(t)} className="w-full text-left p-4 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{t.description ?? '—'}</p>
                        <p className="text-xs text-slate-400 truncate">{[t.clientName, fmtDate(t.paidAt)].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-slate-900 tabular-nums">{money(t.amountTotal, t.currency)}</p>
                        <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${TX_BADGE[t.status] ?? TX_BADGE.PAID}`}>{TX_LABEL[t.status] ?? t.status}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>Card fee {t.stripeFeeAmount == null ? '—' : money(cardFee, t.currency)}</span>
                      <span>Net <strong className="text-slate-700">{money(net, t.currency)}</strong></span>
                    </div>
                  </button>
                )
              })}
            </div>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="px-4 pt-4 pb-2 font-medium">Date</th>
                    <th className="px-4 pt-4 pb-2 font-medium">For</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right">Amount</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right">Card fee</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right">Net</th>
                    <th className="px-4 pt-4 pb-2 font-medium">Status</th>
                    <th className="px-4 pt-4 pb-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(t => {
                    const { cardFee, net } = txDerived(t)
                    return (
                      <tr key={t.id} onClick={() => setOpen(t)} className="border-t border-slate-100 align-top cursor-pointer hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(t.paidAt)}</td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <span className="block">{t.description ?? '—'}</span>
                          {t.clientName && <span className="text-xs text-slate-400">{t.clientName}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(t.amountTotal, t.currency)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 whitespace-nowrap">{t.stripeFeeAmount == null ? '—' : money(cardFee, t.currency)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap">{money(net, t.currency)}</td>
                        <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TX_BADGE[t.status] ?? TX_BADGE.PAID}`}>{TX_LABEL[t.status] ?? t.status}</span></td>
                        <td className="px-4 py-2.5 text-right text-slate-300"><ChevronRight className="h-4 w-4 inline" /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onGo={goTo} loading={loading} />}
      {open && <TransactionDetail tx={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload() }} />}
    </div>
  )
}

interface Inv { id: string; description: string | null; clientName: string | null; amountTotal: number; currency: string; status: string; paidAt: string | null; createdAt: string; xeroSyncStatus: 'NOT_SYNCED' | 'SYNCED' | 'ERROR'; xeroSyncError: string | null }

function invoiceBadge(status: string): { label: string; cls: string } {
  if (status === 'PENDING') return { label: 'Unpaid', cls: 'bg-amber-100 text-amber-700' }
  if (status === 'REFUNDED') return { label: 'Refunded', cls: 'bg-slate-100 text-slate-500' }
  if (status === 'PARTIALLY_REFUNDED') return { label: 'Part refund', cls: 'bg-amber-100 text-amber-700' }
  if (status === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-400' }
  return { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' }
}

function InvoicesTab() {
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all')
  const { q, data, loading, onSearch, goTo } = useFinanceList<Inv>('/api/trainer/finances/invoices', `status=${filter}`)
  const [open, setOpen] = useState<Inv | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1"><SearchBar value={q} onChange={onSearch} placeholder="Search invoices by item or client…" /></div>
        <div className="inline-flex self-start rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          {(['all', 'unpaid', 'paid'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg capitalize transition-colors ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 px-5 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 py-8">{q ? 'No invoices match your search.' : 'No invoices yet. Send one from a client’s profile.'}</p>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.items.map(i => {
                const b = invoiceBadge(i.status)
                return (
                  <button key={i.id} type="button" onClick={() => setOpen(i)} className="w-full text-left p-4 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{i.description ?? '—'}</p>
                        <p className="text-xs text-slate-400 truncate">{[i.clientName, `issued ${fmtDate(i.createdAt)}`].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-slate-900 tabular-nums">{money(i.amountTotal, i.currency)}</p>
                        <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>{b.label}</span>
                      </div>
                    </div>
                    {i.paidAt && <p className="mt-1.5 text-xs text-slate-400">Paid {fmtDate(i.paidAt)}</p>}
                  </button>
                )
              })}
            </div>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="px-4 pt-4 pb-2 font-medium">Issued</th>
                    <th className="px-4 pt-4 pb-2 font-medium">For</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right">Amount</th>
                    <th className="px-4 pt-4 pb-2 font-medium">Paid on</th>
                    <th className="px-4 pt-4 pb-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(i => {
                    const b = invoiceBadge(i.status)
                    return (
                      <tr key={i.id} onClick={() => setOpen(i)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(i.createdAt)}</td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <span className="block">{i.description ?? '—'}</span>
                          {i.clientName && <span className="text-xs text-slate-400">{i.clientName}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(i.amountTotal, i.currency)}</td>
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{i.paidAt ? fmtDate(i.paidAt) : '—'}</td>
                        <td className="px-4 py-2.5"><div className="flex items-center justify-between gap-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${b.cls}`}>{b.label}</span><ChevronRight className="h-4 w-4 text-slate-300" /></div></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onGo={goTo} loading={loading} />}
      {open && <InvoiceDetail inv={open} xeroConnected={!!data?.xeroConnected} onClose={() => setOpen(null)} />}
    </div>
  )
}

// ── Full-screen detail views ───────────────────────────────────────────────

function DetailShell({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  // z-[80] so a detail view sits ABOVE the list modal (z-[70]) it opens from.
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-white">
      <div className="flex items-center gap-2 px-3 sm:px-5 min-h-[3.5rem] border-b border-slate-100 flex-shrink-0" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <button type="button" onClick={onClose} aria-label="Close" className="p-2 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-900">{title}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-lg px-5 sm:px-6 py-6">{children}</div>
      </div>
      {footer && (
        <div className="border-t border-slate-100 flex-shrink-0 bg-white" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="mx-auto w-full max-w-lg px-6 py-3.5">{footer}</div>
        </div>
      )}
    </div>
  )
}

function DetailRow({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm tabular-nums text-right ${strong ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{value}</span>
    </div>
  )
}

function TransactionDetail({ tx, onClose, onChanged }: { tx: Tx; onClose: () => void; onChanged: () => void }) {
  const { cardFee, net, refundable } = txDerived(tx)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function refund() {
    if (!confirm('Refund this payment in full? The money is returned to the client.')) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/trainer/payments/${tx.id}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) { onChanged() }
      else { const b = await res.json().catch(() => ({})); setError(typeof b.error === 'string' ? b.error : 'Could not refund.') }
    } catch { setError('Could not refund.') } finally { setBusy(false) }
  }

  return (
    <DetailShell
      title="Transaction"
      onClose={onClose}
      footer={refundable ? (
        <button type="button" onClick={refund} disabled={busy} className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm font-semibold disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Refund payment
        </button>
      ) : undefined}
    >
      <div className="text-center">
        <p className="text-3xl font-bold text-slate-900 tabular-nums">{money(tx.amountTotal, tx.currency)}</p>
        <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${TX_BADGE[tx.status] ?? TX_BADGE.PAID}`}>{TX_LABEL[tx.status] ?? tx.status}</span>
      </div>
      <div className="mt-6">
        <DetailRow label="For" value={tx.description ?? '—'} />
        {tx.clientName && <DetailRow label="Client" value={tx.clientName} />}
        <DetailRow label="Date" value={fmtDate(tx.paidAt)} />
      </div>
      <p className="mt-6 text-xs font-semibold uppercase tracking-wide text-slate-400">Breakdown</p>
      <div className="mt-1">
        <DetailRow label="Gross" value={money(tx.amountTotal, tx.currency)} />
        <DetailRow label="Card fee" value={tx.stripeFeeAmount == null ? '—' : `− ${money(cardFee, tx.currency)}`} />
        {tx.amountRefunded > 0 && <DetailRow label="Refunded" value={`− ${money(tx.amountRefunded, tx.currency)}`} />}
        <DetailRow label="Net to you" value={money(net, tx.currency)} strong />
      </div>
      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
    </DetailShell>
  )
}

function InvoiceDetail({ inv, xeroConnected, onClose }: { inv: Inv; xeroConnected: boolean; onClose: () => void }) {
  const b = invoiceBadge(inv.status)
  const unpaid = inv.status === 'PENDING'
  const [copied, setCopied] = useState(false)
  const [resending, setResending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  // Local Xero sync state so a retry reflects immediately without a full reload.
  const [xero, setXero] = useState<{ status: Inv['xeroSyncStatus']; error: string | null }>({ status: inv.xeroSyncStatus, error: inv.xeroSyncError })
  const [retrying, setRetrying] = useState(false)
  const payLink = typeof window !== 'undefined' ? `${window.location.origin}/my/pay/${inv.id}` : ''

  async function copy() {
    try { await navigator.clipboard.writeText(payLink); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch { /* clipboard blocked */ }
  }
  async function resend() {
    setResending(true); setMsg(null)
    try {
      const res = await fetch(`/api/trainer/finances/invoices/${inv.id}/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      setMsg(res.ok ? 'Reminder sent to the client.' : 'Could not resend — try again.')
    } catch { setMsg('Could not resend — try again.') } finally { setResending(false) }
  }
  async function retryXero() {
    setRetrying(true)
    try {
      const res = await fetch('/api/xero/retry', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paymentId: inv.id }) })
      const json = await res.json().catch(() => ({}))
      setXero(res.ok && json.ok ? { status: 'SYNCED', error: null } : { status: 'ERROR', error: json.error ?? 'Sync failed — try again.' })
    } catch { setXero({ status: 'ERROR', error: 'Sync failed — try again.' }) } finally { setRetrying(false) }
  }

  return (
    <DetailShell
      title="Invoice"
      onClose={onClose}
      footer={unpaid ? (
        <div className="flex gap-2">
          <button type="button" onClick={copy} className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-semibold">
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy pay link'}
          </button>
          <button type="button" onClick={resend} disabled={resending} className="flex-1 inline-flex items-center justify-center gap-1.5 h-11 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-semibold disabled:opacity-60">
            {resending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {resending ? 'Sending…' : 'Resend'}
          </button>
        </div>
      ) : undefined}
    >
      <div className="text-center">
        <p className="text-3xl font-bold text-slate-900 tabular-nums">{money(inv.amountTotal, inv.currency)}</p>
        <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${b.cls}`}>{b.label}</span>
      </div>
      <div className="mt-6">
        <DetailRow label="For" value={inv.description ?? '—'} />
        {inv.clientName && <DetailRow label="Client" value={inv.clientName} />}
        <DetailRow label="Issued" value={fmtDate(inv.createdAt)} />
        <DetailRow label="Paid on" value={inv.paidAt ? fmtDate(inv.paidAt) : '—'} />
      </div>
      {unpaid && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Payment link</p>
          <p className="mt-1 text-xs text-slate-400 break-all">{payLink}</p>
        </div>
      )}
      {xeroConnected && (
        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Xero</span>
            {xero.status === 'SYNCED' ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" /> Synced</span>
            ) : xero.status === 'ERROR' ? (
              <span className="text-xs font-medium text-rose-600">Sync failed</span>
            ) : (
              <span className="text-xs font-medium text-slate-400">Not synced yet</span>
            )}
          </div>
          {xero.status === 'ERROR' && xero.error && <p className="mt-1.5 text-xs text-rose-500">{xero.error}</p>}
          {xero.status !== 'SYNCED' && (
            <button type="button" onClick={retryXero} disabled={retrying} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{retrying ? 'Syncing…' : 'Retry Xero sync'}
            </button>
          )}
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </DetailShell>
  )
}

// ── Receivables (payment-method-agnostic invoices) ──────────────────────────

interface Rcv {
  id: string; description: string | null; clientName: string | null
  amountCents: number; amountPaidCents: number; currency: string; status: string
  sentAt: string | null; paidAt: string | null; createdAt: string
  xeroInvoiceId: string | null; xeroSyncStatus: 'SYNCED' | 'ERROR' | null; xeroSyncError: string | null
}

function receivableBadge(r: { status: string; sentAt: string | null }): { label: string; cls: string } {
  if (r.status === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-400' }
  if (r.status === 'PAID') return { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' }
  if (r.status === 'PARTIAL') return { label: 'Partially paid', cls: 'bg-amber-100 text-amber-700' }
  if (!r.sentAt) return { label: 'Unsent', cls: 'bg-slate-100 text-slate-500' }
  return { label: 'Sent', cls: 'bg-amber-100 text-amber-700' }
}

// Deep link to an invoice inside the trainer's Xero org.
const xeroInvoiceUrl = (xeroInvoiceId: string) => `https://go.xero.com/app/invoicing/view/${xeroInvoiceId}`

// Small round Xero logo that links out to the invoice in Xero (new tab).
// stopPropagation so clicking it inside a list row doesn't also open the modal.
function XeroLink({ xeroInvoiceId, className = '' }: { xeroInvoiceId: string; className?: string }) {
  return (
    <a
      href={xeroInvoiceUrl(xeroInvoiceId)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={e => e.stopPropagation()}
      title="View in Xero"
      aria-label="View in Xero"
      className={`inline-flex shrink-0 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logos/xero-icon.webp" alt="View in Xero" className="h-[18px] w-[18px] rounded-full" />
    </a>
  )
}

interface RcvLine { id: string; description: string; quantity: number; unitAmountCents: number; amountCents: number }

interface RcvDetail {
  id: string; reference: string; description: string | null
  amountCents: number; amountPaidCents: number; currency: string; status: string
  createdAt: string; sentAt: string | null; paidAt: string | null
  xeroInvoiceId: string | null; xeroSyncStatus: 'SYNCED' | 'ERROR' | null; xeroSyncError: string | null
  lines: RcvLine[]
  client: { name: string | null; email: string | null; address: string | null; phone: string | null }
  business: { name: string | null; logoUrl: string | null; email: string | null; address: string | null }
}

function ReceivablesTab() {
  const [filter, setFilter] = useState<'all' | 'unsent' | 'sent' | 'paid'>('all')
  const { q, data, loading, onSearch, goTo, reload } = useFinanceList<Rcv>('/api/trainer/finances/receivables', `status=${filter}`)
  const [sending, setSending] = useState<string | null>(null)
  const [open, setOpen] = useState<Rcv | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const [reconcileMsg, setReconcileMsg] = useState<string | null>(null)

  async function send(id: string) {
    setSending(id)
    try {
      const res = await fetch(`/api/trainer/finances/receivables/${id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) reload()
    } finally {
      setSending(null)
    }
  }

  // Manual "Check Xero for payments" — pulls the latest payment state from Xero
  // for every open synced invoice, then refreshes the list.
  async function checkXero() {
    setReconciling(true); setReconcileMsg(null)
    try {
      const res = await fetch('/api/trainer/finances/receivables/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const b = await res.json().catch(() => ({}))
      if (res.ok) {
        setReconcileMsg(b.updated > 0 ? `Updated ${b.updated} invoice${b.updated === 1 ? '' : 's'}.` : 'No payment changes.')
        reload()
      } else {
        setReconcileMsg('Could not check Xero — try again.')
      }
    } catch {
      setReconcileMsg('Could not check Xero — try again.')
    } finally {
      setReconciling(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1"><SearchBar value={q} onChange={onSearch} placeholder="Search invoices by item or client…" /></div>
        <div className="inline-flex self-start rounded-xl bg-slate-100 p-1 text-xs font-semibold">
          {(['all', 'unsent', 'sent', 'paid'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg capitalize transition-colors ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{f}</button>
          ))}
        </div>
      </div>
      {/* Manual reconcile — only when the trainer has connected Xero. */}
      {data?.xeroConnected && (
        <div className="flex items-center gap-3 self-start">
          <button type="button" onClick={checkXero} disabled={reconciling} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            {reconciling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/logos/xero-icon.webp" alt="" className="h-[18px] w-[18px] rounded-full" />
            )}
            {reconciling ? 'Checking…' : 'Check Xero for payments'}
          </button>
          {reconcileMsg && <span className="text-xs text-slate-500">{reconcileMsg}</span>}
        </div>
      )}
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 px-5 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 py-8">{q ? 'No invoices match your search.' : 'No invoices yet. They’re created automatically when you assign a priced package or product.'}</p>
        ) : (
          <>
            {/* Mobile: stacked cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {data.items.map(r => {
                const b = receivableBadge(r)
                const unsent = r.status === 'UNPAID' && !r.sentAt
                return (
                  <div key={r.id} onClick={() => setOpen(r)} className="p-4 cursor-pointer active:bg-slate-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">{r.description ?? '—'}</p>
                        <p className="text-xs text-slate-400 truncate">{[r.clientName, `issued ${fmtDate(r.createdAt)}`].filter(Boolean).join(' · ')}</p>
                      </div>
                      <div className="flex items-start gap-3 shrink-0">
                        <div className="text-right">
                          <p className="font-semibold text-slate-900 tabular-nums">{money(r.amountCents, r.currency)}</p>
                          {r.status === 'PARTIAL' && <p className="text-[11px] text-amber-600 tabular-nums">{money(r.amountPaidCents, r.currency)} of {money(r.amountCents, r.currency)}</p>}
                          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${b.cls}`}>{b.label}</span>
                        </div>
                        {/* Xero deep link — far-right trailing edge of the card. */}
                        {r.xeroInvoiceId && <XeroLink xeroInvoiceId={r.xeroInvoiceId} className="mt-1" />}
                      </div>
                    </div>
                    {unsent && (
                      <button onClick={e => { e.stopPropagation(); send(r.id) }} disabled={sending === r.id} className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-lg bg-accent hover:bg-accent-strong text-white text-sm font-semibold disabled:opacity-60">
                        {sending === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {sending === r.id ? 'Sending…' : 'Send to client'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400">
                    <th className="px-4 pt-4 pb-2 font-medium">Issued</th>
                    <th className="px-4 pt-4 pb-2 font-medium">For</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right">Amount</th>
                    <th className="px-4 pt-4 pb-2 font-medium">Status</th>
                    <th className="px-4 pt-4 pb-2 font-medium text-right" />
                    <th className="px-4 pt-4 pb-2 font-medium text-right w-10" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map(r => {
                    const b = receivableBadge(r)
                    const unsent = r.status === 'UNPAID' && !r.sentAt
                    return (
                      <tr key={r.id} onClick={() => setOpen(r)} className="border-t border-slate-100 cursor-pointer hover:bg-slate-50/70">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(r.createdAt)}</td>
                        <td className="px-4 py-2.5 text-slate-700">
                          <span className="block">{r.description ?? '—'}</span>
                          {r.clientName && <span className="text-xs text-slate-400">{r.clientName}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 whitespace-nowrap">
                          {money(r.amountCents, r.currency)}
                          {r.status === 'PARTIAL' && <span className="block text-[11px] font-normal text-amber-600">{money(r.amountPaidCents, r.currency)} paid</span>}
                        </td>
                        <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${b.cls}`}>{b.label}</span></td>
                        <td className="px-4 py-2.5 text-right">
                          {unsent && (
                            <button onClick={e => { e.stopPropagation(); send(r.id) }} disabled={sending === r.id} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
                              {sending === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} {sending === r.id ? 'Sending…' : 'Send'}
                            </button>
                          )}
                        </td>
                        {/* Xero deep link — far-right trailing cell. */}
                        <td className="px-4 py-2.5 text-right">{r.xeroInvoiceId && <XeroLink xeroInvoiceId={r.xeroInvoiceId} />}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onGo={goTo} loading={loading} />}
      {open && <ReceivableDocument summary={open} onClose={() => setOpen(null)} onSent={reload} />}
    </div>
  )
}

// A draft line during edit (string-typed inputs → parsed on save).
interface DraftLine { description: string; quantity: string; unitDollars: string }

// Parsed cents for a draft line, or null when the inputs aren't valid yet.
function draftLineCents(l: DraftLine): number | null {
  const qty = parseInt(l.quantity, 10)
  const unit = parseFloat(l.unitDollars)
  if (!Number.isInteger(qty) || qty < 1) return null
  if (!Number.isFinite(unit) || unit < 0) return null
  return Math.round(unit * 100) * qty
}

// Full printable invoice document, shown as a centered modal dialog (backdrop +
// card, Esc/backdrop to close, body scroll-locked). Fetches the richer detail on
// open; the chrome is `print:hidden` so window.print() yields just the invoice.
// UNPAID invoices are editable in place — a full multi-line editor (add/remove
// lines, edit description/qty/unit; Subtotal/Total = sum).
function ReceivableDocument({ summary, onClose, onSent }: { summary: Rcv; onClose: () => void; onSent: () => void }) {
  const [data, setData] = useState<RcvDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftLines, setDraftLines] = useState<DraftLine[]>([])

  const load = useCallback(async () => {
    const d = await fetch(`/api/trainer/finances/receivables/${summary.id}`).then(r => (r.ok ? r.json() : null)).catch(() => null)
    return d as RcvDetail | null
  }, [summary.id])

  useEffect(() => {
    let alive = true
    setLoading(true)
    load().then(d => { if (alive) { setData(d); setLoading(false) } })
    return () => { alive = false }
  }, [load])

  // Lock body scroll + close on Escape while the dialog is open.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey) }
  }, [onClose, editing])

  // Prefer the fetched detail; fall back to the list summary while loading.
  const view = data ?? summary
  const badge = receivableBadge(view)
  const unpaidUnsent = view.status === 'UNPAID' && !view.sentAt
  // A paid or cancelled invoice is locked — only UNPAID is editable.
  const editable = view.status === 'UNPAID'

  // Live draft totals + validity.
  const draftCents = draftLines.map(draftLineCents)
  const draftValid = draftLines.length > 0 && draftCents.every(c => c !== null) && draftLines.every(l => l.description.trim().length > 0)
  const previewTotal = draftCents.reduce<number>((sum, c) => sum + (c ?? 0), 0)

  function startEdit() {
    if (!data) return
    const seed: DraftLine[] = data.lines.length
      ? data.lines.map(l => ({ description: l.description, quantity: String(l.quantity), unitDollars: (l.unitAmountCents / 100).toFixed(2) }))
      : [{ description: data.description ?? '', quantity: '1', unitDollars: (data.amountCents / 100).toFixed(2) }]
    setDraftLines(seed)
    setMsg(null)
    setEditing(true)
  }
  function updateLine(i: number, patch: Partial<DraftLine>) {
    setDraftLines(ls => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function addLine() {
    setDraftLines(ls => [...ls, { description: '', quantity: '1', unitDollars: '0.00' }])
  }
  function removeLine(i: number) {
    setDraftLines(ls => (ls.length <= 1 ? ls : ls.filter((_, idx) => idx !== i)))
  }

  async function send() {
    setSending(true); setMsg(null)
    try {
      const res = await fetch(`/api/trainer/finances/receivables/${summary.id}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) {
        setMsg('Sent to the client.')
        onSent()
        const d = await load()
        if (d) setData(d)
      } else {
        setMsg('Could not send — try again.')
      }
    } catch {
      setMsg('Could not send — try again.')
    } finally {
      setSending(false)
    }
  }

  async function save() {
    if (!draftValid) { setMsg('Check each line has a description, a quantity ≥ 1, and a valid amount.'); return }
    setSaving(true); setMsg(null)
    try {
      const res = await fetch(`/api/trainer/finances/receivables/${summary.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines: draftLines.map(l => ({
            description: l.description.trim(),
            quantity: parseInt(l.quantity, 10),
            unitAmountCents: Math.round(parseFloat(l.unitDollars) * 100),
          })),
        }),
      })
      if (res.ok) {
        onSent() // refresh the underlying list (amount/desc changed)
        const d = await load()
        if (d) setData(d)
        setEditing(false)
      } else {
        const b = await res.json().catch(() => ({}))
        setMsg(typeof b.error === 'string' ? b.error : 'Could not save — try again.')
      }
    } catch {
      setMsg('Could not save — try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 print:p-0 print:static print:block">
      {/* Backdrop — click to close (disabled mid-edit to avoid losing changes). */}
      <div className="absolute inset-0 bg-slate-900/40 print:hidden" onClick={() => { if (!editing) onClose() }} />

      <div role="dialog" aria-modal="true" aria-label="Invoice" className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-2xl shadow-xl overflow-hidden print:max-h-none print:max-w-none print:rounded-none print:shadow-none print:overflow-visible">
        {/* Action bar — hidden when printing. */}
        <div className="print:hidden flex items-center gap-2 px-3 sm:px-5 min-h-[3.5rem] border-b border-slate-100 flex-shrink-0">
          <button type="button" onClick={onClose} aria-label="Close" className="p-2 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          <p className="flex-1 min-w-0 truncate text-sm font-semibold text-slate-900">{editing ? 'Edit invoice' : 'Invoice'}</p>
          {editing ? (
            <>
              <button type="button" onClick={() => { setEditing(false); setMsg(null) }} disabled={saving} className="inline-flex items-center rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">Cancel</button>
              <button type="button" onClick={save} disabled={saving || !draftValid} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white px-3 h-9 text-sm font-semibold disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              {editable && data && (
                <button type="button" onClick={startEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              )}
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 h-9 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Printer className="h-4 w-4" /> Print
              </button>
              {unpaidUnsent && (
                <button type="button" onClick={send} disabled={sending} className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white px-3 h-9 text-sm font-semibold disabled:opacity-60">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {sending ? 'Sending…' : 'Send'}
                </button>
              )}
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto print:overflow-visible">
          {loading && !data ? (
            <div className="flex items-center gap-2 text-sm text-slate-400 px-6 py-10"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : !data ? (
            <p className="text-sm text-slate-400 px-6 py-10">Could not load this invoice.</p>
          ) : (
            <div className="mx-auto w-full max-w-2xl px-6 sm:px-10 py-8 print:py-2">
              {/* Header: business identity + invoice meta. */}
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {data.business.logoUrl && <img src={data.business.logoUrl} alt="" className="h-10 w-auto mb-3 object-contain" />}
                  <p className="text-lg font-bold text-slate-900">{data.business.name ?? 'Your business'}</p>
                  {data.business.address && <p className="mt-1 text-xs text-slate-500 whitespace-pre-line">{data.business.address}</p>}
                  {data.business.email && <p className="text-xs text-slate-500">{data.business.email}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Invoice</p>
                  <p className="mt-1 text-sm font-semibold text-slate-900 tabular-nums">{data.reference}</p>
                  <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                </div>
              </div>

              {/* Bill-to + dates. */}
              <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Bill to</p>
                  <p className="mt-1.5 text-sm font-medium text-slate-800">{data.client.name ?? '—'}</p>
                  {data.client.email && <p className="text-xs text-slate-500">{data.client.email}</p>}
                  {data.client.phone && <p className="text-xs text-slate-500">{data.client.phone}</p>}
                  {data.client.address && <p className="text-xs text-slate-500 whitespace-pre-line">{data.client.address}</p>}
                </div>
                <div className="sm:text-right">
                  <div className="flex sm:justify-end gap-2 text-xs"><span className="text-slate-400">Issued</span><span className="text-slate-700 tabular-nums">{fmtDate(data.createdAt)}</span></div>
                  {data.sentAt && <div className="flex sm:justify-end gap-2 text-xs mt-1"><span className="text-slate-400">Sent</span><span className="text-slate-700 tabular-nums">{fmtDate(data.sentAt)}</span></div>}
                  {data.paidAt && <div className="flex sm:justify-end gap-2 text-xs mt-1"><span className="text-slate-400">Paid</span><span className="text-slate-700 tabular-nums">{fmtDate(data.paidAt)}</span></div>}
                </div>
              </div>

              {/* Line items — invoices can carry multiple lines. */}
              <table className="mt-8 w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-slate-400 border-b border-slate-200">
                    <th className="py-2 font-medium">Description</th>
                    <th className="py-2 font-medium text-right w-16">Qty</th>
                    <th className="py-2 font-medium text-right w-28">Unit</th>
                    <th className="py-2 font-medium text-right w-28">Amount</th>
                    {editing && <th className="py-2 w-8 print:hidden" />}
                  </tr>
                </thead>
                <tbody>
                  {editing ? (
                    draftLines.map((l, i) => {
                      const cents = draftCents[i]
                      return (
                        <tr key={i} className="border-b border-slate-100 align-top">
                          <td className="py-2 pr-3">
                            <input
                              type="text"
                              value={l.description}
                              onChange={e => updateLine(i, { description: e.target.value })}
                              maxLength={200}
                              placeholder="Description"
                              className="w-full h-9 px-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </td>
                          <td className="py-2 pl-2">
                            <input
                              type="number" inputMode="numeric" min={1} step="1"
                              value={l.quantity}
                              onChange={e => updateLine(i, { quantity: e.target.value })}
                              className="w-14 h-9 px-2 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                            />
                          </td>
                          <td className="py-2 pl-2">
                            <div className="flex items-center justify-end gap-1">
                              <span className="text-[10px] text-slate-400">{(data.currency || '').toUpperCase()}</span>
                              <input
                                type="number" inputMode="decimal" min={0} step="0.01"
                                value={l.unitDollars}
                                onChange={e => updateLine(i, { unitDollars: e.target.value })}
                                className="w-24 h-9 px-2 rounded-lg border border-slate-200 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-accent"
                              />
                            </div>
                          </td>
                          <td className="py-2 text-right tabular-nums text-slate-900 whitespace-nowrap">{cents === null ? '—' : money(cents, data.currency)}</td>
                          <td className="py-2 pl-1 text-right print:hidden">
                            <button type="button" onClick={() => removeLine(i)} disabled={draftLines.length <= 1} aria-label="Remove line" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  ) : (
                    data.lines.map(l => (
                      <tr key={l.id} className="border-b border-slate-100">
                        <td className="py-3 text-slate-700">{l.description}</td>
                        <td className="py-3 text-right tabular-nums text-slate-500">{l.quantity}</td>
                        <td className="py-3 text-right tabular-nums text-slate-500 whitespace-nowrap">{money(l.unitAmountCents, data.currency)}</td>
                        <td className="py-3 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(l.amountCents, data.currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {editing && (
                <button type="button" onClick={addLine} className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 h-9 text-sm font-medium text-slate-600 hover:bg-slate-50 print:hidden">
                  <Plus className="h-4 w-4" /> Add line
                </button>
              )}

              {/* Totals — follow the (draft) lines. Paid/balance shown once
                  something's been settled (and never mid-edit). */}
              {(() => {
                const totalCents = editing ? previewTotal : data.amountCents
                const showPaid = !editing && data.amountPaidCents > 0
                const balance = Math.max(0, data.amountCents - data.amountPaidCents)
                return (
                  <div className="mt-4 flex flex-col items-end gap-1.5">
                    <div className="flex justify-between gap-12 text-sm w-full max-w-[220px]"><span className="text-slate-500">Subtotal</span><span className="tabular-nums text-slate-700">{money(totalCents, data.currency)}</span></div>
                    <div className="flex justify-between gap-12 text-base font-semibold w-full max-w-[220px] border-t border-slate-200 pt-1.5"><span className="text-slate-900">Total</span><span className="tabular-nums text-slate-900">{money(totalCents, data.currency)}</span></div>
                    {showPaid && (
                      <>
                        <div className="flex justify-between gap-12 text-sm w-full max-w-[220px]"><span className="text-slate-500">Amount paid</span><span className="tabular-nums text-emerald-600">− {money(data.amountPaidCents, data.currency)}</span></div>
                        <div className="flex justify-between gap-12 text-sm font-semibold w-full max-w-[220px] border-t border-slate-200 pt-1.5"><span className="text-slate-900">Balance due</span><span className="tabular-nums text-slate-900">{money(balance, data.currency)}</span></div>
                      </>
                    )}
                  </div>
                )
              })()}

              {/* Xero — deep link to the invoice in Xero when synced. */}
              {data.xeroInvoiceId && (
                <a href={xeroInvoiceUrl(data.xeroInvoiceId)} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:underline print:hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/logos/xero-icon.webp" alt="View in Xero" className="h-[18px] w-[18px] rounded-full" /> View in Xero
                </a>
              )}
              {!data.xeroInvoiceId && data.xeroSyncError && (
                <p className="mt-8 text-xs text-slate-400 print:hidden">Xero sync pending — {data.xeroSyncError}</p>
              )}

              {msg && <p className="mt-4 text-sm text-slate-600 print:hidden">{msg}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const TABS = [
  { id: 'receivables', label: 'Invoices', icon: FileText },
  { id: 'invoices', label: 'Pay links', icon: Receipt },
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
] as const
type TabId = typeof TABS[number]['id']

export function FinancesView() {
  const params = useSearchParams()
  const requested = params.get('tab')
  const initial = (TABS.some(t => t.id === requested) ? requested : 'receivables') as TabId
  const [tab, setTab] = useState<TabId>(initial)

  function select(id: TabId) {
    setTab(id)
    if (typeof window !== 'undefined') history.replaceState(null, '', `?tab=${id}`)
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map(t => {
          const Icon = t.icon
          const active = tab === t.id
          return (
            <button key={t.id} type="button" onClick={() => select(t.id)} className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${active ? 'text-accent' : 'text-slate-500 hover:text-slate-700'}`}>
              <Icon className="h-4 w-4" /> {t.label}
              {active && <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-accent rounded-full" />}
            </button>
          )
        })}
      </div>
      <div className={tab === 'receivables' ? '' : 'hidden'}><ReceivablesTab /></div>
      <div className={tab === 'transactions' ? '' : 'hidden'}><TransactionsTab /></div>
      <div className={tab === 'invoices' ? '' : 'hidden'}><InvoicesTab /></div>
    </div>
  )
}
