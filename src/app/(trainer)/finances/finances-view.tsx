'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Receipt, ArrowLeftRight, Search, Loader2, ChevronLeft, ChevronRight, X, Copy, Check, Send, RotateCcw } from 'lucide-react'

const CURRENCY_SYMBOLS: Record<string, string> = { nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R' }
function money(minor: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency.toLowerCase()] ?? ''
  return `${sym}${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

interface Page<T> { page: number; totalPages: number; total: number; items: T[] }

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

interface Inv { id: string; description: string | null; clientName: string | null; amountTotal: number; currency: string; status: string; paidAt: string | null; createdAt: string }

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
      {open && <InvoiceDetail inv={open} onClose={() => setOpen(null)} />}
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

function InvoiceDetail({ inv, onClose }: { inv: Inv; onClose: () => void }) {
  const b = invoiceBadge(inv.status)
  const unpaid = inv.status === 'PENDING'
  const [copied, setCopied] = useState(false)
  const [resending, setResending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
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
      {msg && <p className="mt-3 text-sm text-slate-600">{msg}</p>}
    </DetailShell>
  )
}

const TABS = [
  { id: 'invoices', label: 'Invoices', icon: Receipt },
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
] as const
type TabId = typeof TABS[number]['id']

export function FinancesView() {
  const params = useSearchParams()
  const initial = (params.get('tab') === 'transactions' ? 'transactions' : 'invoices') as TabId
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
      <div className={tab === 'transactions' ? '' : 'hidden'}><TransactionsTab /></div>
      <div className={tab === 'invoices' ? '' : 'hidden'}><InvoicesTab /></div>
    </div>
  )
}
