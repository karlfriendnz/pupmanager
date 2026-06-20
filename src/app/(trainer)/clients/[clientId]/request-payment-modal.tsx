'use client'

import { useEffect, useState } from 'react'
import { X, Loader2, CheckCircle2, CreditCard, ExternalLink } from 'lucide-react'

const CURRENCY_SYMBOLS: Record<string, string> = {
  nzd: '$', aud: '$', cad: '$', usd: '$', gbp: '£', eur: '€', zar: 'R',
}
function money(minor: number, currency: string | null): string {
  const sym = currency ? CURRENCY_SYMBOLS[currency.toLowerCase()] ?? '' : '$'
  return `${sym}${(minor / 100).toFixed(2)}`
}

interface Item { id: string; label: string; amount: number; kind: 'PACKAGE' | 'PRODUCT'; refId: string }

export function RequestPaymentModal({
  clientId,
  clientName,
  open,
  onOpenChange,
}: {
  clientId: string
  clientName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(true)
  const [currency, setCurrency] = useState<string | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [selected, setSelected] = useState<string>('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true); setError(null); setDone(false)
    fetch(`/api/trainer/clients/${clientId}/invoice`)
      .then(r => r.json())
      .then((d: { accepting: boolean; currency: string | null; packages: { clientPackageId: string; name: string; amount: number }[]; products: { productId: string; name: string; amount: number }[] }) => {
        setAccepting(d.accepting)
        setCurrency(d.currency)
        const list: Item[] = [
          ...d.packages.map(p => ({ id: `pkg:${p.clientPackageId}`, label: p.name, amount: p.amount, kind: 'PACKAGE' as const, refId: p.clientPackageId })),
          ...d.products.map(p => ({ id: `prod:${p.productId}`, label: p.name, amount: p.amount, kind: 'PRODUCT' as const, refId: p.productId })),
        ]
        setItems(list)
        setSelected(list[0]?.id ?? '')
      })
      .catch(() => setError('Could not load items.'))
      .finally(() => setLoading(false))
  }, [open, clientId])

  async function send() {
    const item = items.find(i => i.id === selected)
    if (!item) return
    setSending(true); setError(null)
    try {
      const res = await fetch(`/api/trainer/clients/${clientId}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.kind === 'PACKAGE' ? { clientPackageId: item.refId } : { productId: item.refId }),
      })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not send.'); return }
      setDone(true)
    } finally {
      setSending(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => !sending && onOpenChange(false)}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="text-base font-semibold text-slate-900">Request payment from {clientName}</h2>
          <button type="button" onClick={() => !sending && onOpenChange(false)} aria-label="Close" className="text-slate-400 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="py-4 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="mt-3 font-medium text-slate-900">Payment link sent</p>
            <p className="mt-1 text-sm text-slate-500">{clientName} has been notified by app and email with a link to pay.</p>
            <button onClick={() => onOpenChange(false)} className="mt-5 w-full rounded-xl bg-slate-900 text-white text-sm font-medium py-2.5">Done</button>
          </div>
        ) : loading ? (
          <div className="py-10 text-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : !accepting ? (
          <div className="py-3 text-center">
            <p className="text-sm text-slate-600">Turn on payments first.</p>
            <a href="/settings?tab=payments" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
              Settings → Payments <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : items.length === 0 ? (
          <p className="py-4 text-sm text-slate-500 text-center">No unpaid packages or priced products to invoice. Assign a package or add a priced product first.</p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-slate-700">What for?</label>
            <select
              value={selected}
              onChange={e => setSelected(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {items.map(i => (
                <option key={i.id} value={i.id}>{i.label} · {money(i.amount, currency)}{i.kind === 'PRODUCT' ? ' (product)' : ''}</option>
              ))}
            </select>
            {error && <p className="text-sm text-rose-600">{error}</p>}
            <button
              onClick={send}
              disabled={sending || !selected}
              className="mt-1 w-full rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold py-3 inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CreditCard className="h-4 w-4" /> Send payment link</>}
            </button>
            <p className="text-[11px] text-slate-400 text-center">They’ll get a notification + email with a secure Stripe link.</p>
          </div>
        )}
      </div>
    </div>
  )
}
