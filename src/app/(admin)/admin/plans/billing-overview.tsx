'use client'

import { useState } from 'react'
import type { CurrencyCode } from '@/lib/pricing'

export interface BillingRow {
  id: string
  label: string
  name: string
  description: string
  badge?: string
  kind: 'CORE' | 'SEAT' | 'ADDON'
  prices: Record<CurrencyCode, number>
  wired: CurrencyCode[]
  isActive: boolean
  // Whether a DB row backs this yet (false = not seeded / migration not run).
  exists: boolean
  // Add-ons + seat can be toggled; Core cannot.
  toggleable: boolean
}

interface Props {
  core: BillingRow
  seat: BillingRow
  addons: BillingRow[]
  currencies: { code: CurrencyCode; symbol: string; label: string }[]
  stripeReady: boolean
}

export function BillingOverview({ core, seat, addons, currencies, stripeReady }: Props) {
  return (
    <div className="flex flex-col gap-6">
      {!stripeReady && (
        <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-200">
          Stripe isn&apos;t configured in this environment (<code>STRIPE_SECRET_KEY</code> unset) — checkout is off
          until it&apos;s wired. Wiring status below reflects the Price IDs stored in the DB.
        </div>
      )}

      <Section title="Core software">
        <ItemCard row={core} currencies={currencies} />
      </Section>

      <Section title="Extra trainers">
        <ItemCard row={seat} currencies={currencies} />
      </Section>

      <Section title="Add-ons">
        <div className="flex flex-col gap-3">
          {addons.map(a => (
            <ItemCard key={a.id} row={a} currencies={currencies} />
          ))}
        </div>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </div>
  )
}

function ItemCard({ row, currencies }: { row: BillingRow; currencies: Props['currencies'] }) {
  const [isActive, setIsActive] = useState(row.isActive)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fullyWired = currencies.every(c => row.wired.includes(c.code))

  async function toggle() {
    setBusy(true)
    setErr(null)
    const next = !isActive
    try {
      const res = await fetch(`/api/admin/billing-items/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed')
      setIsActive(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-800 p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold text-white">{row.name}</p>
            {row.badge && (
              <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-300">{row.badge}</span>
            )}
            <StatusPill exists={row.exists} isActive={isActive} />
          </div>
          <p className="mt-0.5 text-sm text-slate-400">{row.description}</p>
        </div>

        {row.toggleable && row.exists && (
          <button
            onClick={toggle}
            disabled={busy}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              isActive
                ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                : 'bg-blue-600 text-white hover:bg-blue-500'
            }`}
          >
            {busy ? '…' : isActive ? 'Disable' : 'Enable'}
          </button>
        )}
      </div>

      {/* Per-currency price + Stripe wiring */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {currencies.map(c => {
          const wired = row.wired.includes(c.code)
          return (
            <div
              key={c.code}
              className="flex items-center justify-between rounded-lg border border-slate-700/70 bg-slate-900/40 px-3 py-2"
            >
              <span className="text-sm tabular-nums text-slate-200">
                {c.symbol}{row.prices[c.code]} <span className="text-xs text-slate-500">{c.label}</span>
              </span>
              <span
                title={wired ? 'Stripe price wired' : 'No Stripe price yet'}
                className={`text-xs ${wired ? 'text-green-400' : 'text-slate-600'}`}
              >
                {wired ? '● wired' : '○'}
              </span>
            </div>
          )
        })}
      </div>

      {!fullyWired && row.exists && (
        <p className="mt-3 text-xs text-slate-500">
          Not all currencies are wired to Stripe — run <code className="text-slate-400">scripts/setup-billing.ts</code> with the missing Price IDs.
        </p>
      )}
      {!row.exists && (
        <p className="mt-3 text-xs text-amber-400/80">
          No DB row yet — apply the billing migration and run the seed / wire script.
        </p>
      )}
      {err && <p className="mt-2 text-xs text-red-400">{err}</p>}
    </div>
  )
}

function StatusPill({ exists, isActive }: { exists: boolean; isActive: boolean }) {
  if (!exists) return <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-400">Not set up</span>
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] ${
        isActive ? 'bg-green-900 text-green-300' : 'bg-slate-700 text-slate-400'
      }`}
    >
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}
