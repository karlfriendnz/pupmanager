'use client'

import { useState } from 'react'
import { RichText } from '@/components/shared/rich-text'
import { Ticket, Loader2, Check } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { resolveButtonColors } from '@/lib/membership-card-colors'
import type { ClientMembership } from '@/lib/client-memberships'

/**
 * The client-facing membership cards + their buy action. Shared by the
 * Memberships storefront page and the Offerings flow's "Memberships" type, so a
 * trainer's card styling (image, colours, custom button text) renders
 * identically wherever a client meets it.
 */
export function MembershipCards({ memberships, currency }: { memberships: ClientMembership[]; currency: string }) {
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

  if (memberships.length === 0) {
    return <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">No memberships available right now.</div>
  }

  return (
    <>
      {error && <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm px-3 py-2">{error}</div>}
      <div className="flex flex-col gap-4">
        {memberships.map(m => {
          const bg = m.bgColor ?? '#ffffff'
          const header = m.headerColor ?? '#0f172a'
          const text = m.textColor ?? '#64748b'
          const featured = m.featuredColor ?? '#7c3aed'
          // Never paint the trainer's raw pair — the guard derives a label tone
          // that clears 4.5:1 on whatever background they chose.
          const btn = resolveButtonColors(m.buttonBgColor, m.buttonTextColor, m.featuredColor)
          return (
            <div key={m.id} className="rounded-2xl border border-slate-200 shadow-sm overflow-hidden" style={{ backgroundColor: bg }}>
              {m.imageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.imageUrl} alt="" className="w-full h-36 object-cover" />
              )}
              <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-lg flex items-center gap-2" style={{ color: header }}><Ticket className="h-5 w-5 shrink-0" style={{ color: featured }} /> {m.name}</h2>
                    <div className="mt-1" style={{ color: text }}><RichText html={m.description} className="text-sm" /></div>
                  </div>
                  <span className="text-lg font-bold whitespace-nowrap" style={{ color: featured }}>{formatMoney(m.priceCents, currency)}</span>
                </div>
                {m.items.length > 0 && (
                  <ul className="mt-3 flex flex-col gap-2.5">
                    {m.items.map((it, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-black/10 shrink-0" />
                        ) : (
                          <Check className="h-4 w-4 shrink-0 mt-0.5" style={{ color: featured }} />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm" style={{ color: header }}>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.label}</p>
                          {it.description && <div style={{ color: text }}><RichText html={it.description} className="text-xs" /></div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <button onClick={() => buy(m.id)} disabled={busy === m.id} className="mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl font-semibold hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: btn.background, color: btn.color }}>
                  {busy === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {m.buttonText?.trim() || 'Get this membership'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
