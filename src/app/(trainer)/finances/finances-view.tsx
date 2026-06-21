'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Receipt, ArrowLeftRight, Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { RefundButton } from '../settings/payments-actions'

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

function TransactionsTab() {
  const { q, data, loading, onSearch, goTo, reload } = useFinanceList<Tx>('/api/trainer/finances/transactions')
  return (
    <div className="flex flex-col gap-3">
      <SearchBar value={q} onChange={onSearch} placeholder="Search by item or client…" />
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 px-5 py-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-slate-400 px-5 py-8">{q ? 'No transactions match your search.' : 'No transactions yet.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-slate-400">
                  <th className="px-4 pt-4 pb-2 font-medium">Date</th>
                  <th className="px-4 pt-4 pb-2 font-medium">For</th>
                  <th className="px-4 pt-4 pb-2 font-medium text-right">Amount</th>
                  <th className="px-4 pt-4 pb-2 font-medium text-right">Card fee</th>
                  <th className="px-4 pt-4 pb-2 font-medium text-right">Platform fee</th>
                  <th className="px-4 pt-4 pb-2 font-medium text-right">Net</th>
                  <th className="px-4 pt-4 pb-2 font-medium">Status</th>
                  <th className="px-4 pt-4 pb-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {data.items.map(t => {
                  const cardFee = t.stripeFeeAmount ?? 0
                  const refundFraction = t.amountTotal > 0 ? t.amountRefunded / t.amountTotal : 0
                  const platformRetained = Math.round(t.applicationFeeAmount * (1 - refundFraction))
                  const net = t.amountTotal - t.amountRefunded - platformRetained
                  const refundable = t.status === 'PAID' || t.status === 'PARTIALLY_REFUNDED'
                  return (
                    <tr key={t.id} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(t.paidAt)}</td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="block">{t.description ?? '—'}</span>
                        {t.clientName && <span className="text-xs text-slate-400">{t.clientName}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(t.amountTotal, t.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 whitespace-nowrap">{t.stripeFeeAmount == null ? '—' : money(cardFee, t.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 whitespace-nowrap">{money(t.applicationFeeAmount, t.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap">{money(net, t.currency)}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TX_BADGE[t.status] ?? TX_BADGE.PAID}`}>{TX_LABEL[t.status] ?? t.status}</span></td>
                      <td className="px-4 py-2.5 text-right">{refundable && <RefundButton paymentId={t.id} onRefunded={reload} />}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onGo={goTo} loading={loading} />}
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
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <div className="flex-1"><SearchBar value={q} onChange={onSearch} placeholder="Search invoices by item or client…" /></div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-semibold">
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
          <div className="overflow-x-auto">
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
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(i.createdAt)}</td>
                      <td className="px-4 py-2.5 text-slate-700">
                        <span className="block">{i.description ?? '—'}</span>
                        {i.clientName && <span className="text-xs text-slate-400">{i.clientName}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 whitespace-nowrap">{money(i.amountTotal, i.currency)}</td>
                      <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">{i.paidAt ? fmtDate(i.paidAt) : '—'}</td>
                      <td className="px-4 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${b.cls}`}>{b.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && <Pager page={data.page} totalPages={data.totalPages} total={data.total} onGo={goTo} loading={loading} />}
    </div>
  )
}

const TABS = [
  { id: 'transactions', label: 'Transactions', icon: ArrowLeftRight },
  { id: 'invoices', label: 'Invoices', icon: Receipt },
] as const
type TabId = typeof TABS[number]['id']

export function FinancesView() {
  const params = useSearchParams()
  const initial = (params.get('tab') === 'invoices' ? 'invoices' : 'transactions') as TabId
  const [tab, setTab] = useState<TabId>(initial)

  function select(id: TabId) {
    setTab(id)
    if (typeof window !== 'undefined') history.replaceState(null, '', `?tab=${id}`)
  }

  return (
    <div>
      <div className="flex gap-1 border-b border-slate-200 mb-6 -mx-4 md:-mx-8 px-4 md:px-8 overflow-x-auto">
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
