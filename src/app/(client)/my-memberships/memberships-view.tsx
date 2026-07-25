'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { Ticket, Loader2, Check } from 'lucide-react'
import { formatMoney } from '@/lib/money'

interface Item { label: string; quantity: number; imageUrl?: string | null; description?: string | null }
interface M { id: string; name: string; description: string | null; priceCents: number; items: Item[] }

export function ClientMembershipsView({ memberships, currency }: { memberships: M[]; currency: string }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function buy(id: string) {
    setBusy(id); setError(null)
    try {
      const res = await fetch(`/api/my/memberships/${id}/buy`, { method: 'POST' })
      const b = await res.json().catch(() => ({}))
      if (!res.ok) { setError(typeof b.error === 'string' ? b.error : 'Could not start checkout.'); return }
      if (b.url) window.location.href = b.url
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Memberships</h1>
      <p className="text-slate-500 text-sm mb-5">Bundles from your trainer — everything included, one payment.</p>
      {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}

      {memberships.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No memberships available right now.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {memberships.map(m => (
            <div key={m.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-900 text-lg flex items-center gap-2"><Ticket className="h-5 w-5 text-violet-600 shrink-0" /> {m.name}</h2>
                  <RichText html={m.description} className="text-sm text-slate-500 mt-1" />
                </div>
                <span className="text-lg font-bold text-violet-700 whitespace-nowrap">{formatMoney(m.priceCents, currency)}</span>
              </div>
              {m.items.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2.5">
                  {m.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-slate-200 shrink-0" />
                      ) : (
                        <Check className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm text-slate-700">{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}</p>
                        {it.description && <RichText html={it.description} className="text-xs text-slate-500" />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button onClick={() => buy(m.id)} disabled={busy === m.id} className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl bg-violet-600 text-white font-semibold hover:bg-violet-700 disabled:opacity-50">
                {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Get this membership
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
