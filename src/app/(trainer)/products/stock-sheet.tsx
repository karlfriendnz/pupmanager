'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { readApiError } from '@/lib/api-error'

/** The six things that can happen to a shelf, in the words a trainer would use. */
const REASONS = [
  { value: 'RECEIVED', label: 'Stock arrived', direction: 'in' },
  { value: 'RETURNED', label: 'Came back to me', direction: 'in' },
  { value: 'SOLD', label: 'Sold it myself', direction: 'out' },
  { value: 'DAMAGED', label: 'Damaged', direction: 'out' },
  { value: 'LOST', label: 'Lost', direction: 'out' },
  { value: 'CORRECTION', label: 'I counted them', direction: 'set' },
] as const

type Reason = (typeof REASONS)[number]['value']

const REASON_LABEL: Record<Reason, string> = Object.fromEntries(
  REASONS.map(r => [r.value, r.label]),
) as Record<Reason, string>

export interface StockMovementRow {
  id: string
  delta: number
  reason: Reason
  note: string | null
  balanceAfter: number | null
  at: string
  clientName: string | null
  userName: string | null
}

function directionOf(reason: Reason) {
  return REASONS.find(r => r.value === reason)!.direction
}

/**
 * Add stock, and see what has happened to it.
 *
 * The count itself is TEXT on the page now. A bare number input let a trainer
 * type 9 over 12 with nothing recorded anywhere about the three that went
 * missing — you could see the shelf, never the story. Changing it is an
 * action with a reason attached, and the reason is what the history is made
 * of, so the two live in one place.
 *
 * The reason picks the direction: "damaged" can only take units off, "stock
 * arrived" can only put them on. A signed number plus a separate reason is two
 * ways to say the same thing, and they can disagree.
 */
export function StockSheet({
  productId,
  productName,
  variantId = null,
  stockCount,
  onClose,
  onChanged,
}: {
  productId: string
  /** What the sheet is about — "Long line" or "Long line · Large". */
  productName: string
  /**
   * Which shelf. A varianted product has a count per size, so the sheet has to
   * say which one it is moving; null is the product's own count, which is what
   * a product with no variants has always had.
   */
  variantId?: string | null
  /** null = this isn't counted yet; the sheet opens on "I counted them". */
  stockCount: number | null
  onClose: () => void
  onChanged: (next: number | null) => void
}) {
  const untracked = stockCount === null
  const [reason, setReason] = useState<Reason>(untracked ? 'CORRECTION' : 'RECEIVED')
  const [quantity, setQuantity] = useState('')
  const [note, setNote] = useState('')
  const [balance, setBalance] = useState<number | null>(stockCount)
  const [movements, setMovements] = useState<StockMovementRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // The history is per shelf: mixing every size into one list is how "we're
    // three short" becomes unanswerable.
    const qs = variantId ? `?variantId=${encodeURIComponent(variantId)}` : ''
    const res = await fetch(`/api/products/${productId}/stock${qs}`)
    if (!res.ok) return
    const body = await res.json()
    setBalance(body.stockCount ?? null)
    setMovements(body.movements ?? [])
  }, [productId, variantId])

  useEffect(() => { void load() }, [load])

  const direction = directionOf(reason)
  const parsed = quantity.trim() === '' ? null : Math.floor(Number(quantity))
  const valid = parsed !== null && Number.isFinite(parsed) && parsed >= (direction === 'set' ? 0 : 1)

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/products/${productId}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: parsed, reason, note: note.trim() || null, variantId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { setError(readApiError(body, 'Could not record that.')); return }
      setBalance(body.stockCount ?? null)
      setMovements(body.movements ?? [])
      setQuantity('')
      setNote('')
      onChanged(body.stockCount ?? null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FullScreenSheet
      title="Stock"
      sub={productName}
      onClose={onClose}
      footer={
        <Button className="w-full" loading={busy} disabled={!valid} onClick={submit}>
          {direction === 'set' ? 'Set the count' : 'Record it'}
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex items-baseline justify-between gap-3 p-4">
            <span className="text-sm font-medium text-slate-700">Units on hand</span>
            <span className="text-2xl font-semibold tabular-nums text-slate-900">
              {balance ?? 'Not counted'}
            </span>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label htmlFor="stock-reason" className="text-sm font-medium text-slate-700">
              What happened
            </label>
            <select
              id="stock-reason"
              value={reason}
              onChange={e => setReason(e.target.value as Reason)}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label htmlFor="stock-quantity" className="text-sm font-medium text-slate-700">
              {direction === 'set' ? 'How many are there now' : 'How many'}
            </label>
            <input
              id="stock-quantity"
              type="number"
              min={direction === 'set' ? 0 : 1}
              step="1"
              inputMode="numeric"
              value={quantity}
              onChange={e => setQuantity(e.target.value)}
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500">
              {direction === 'set'
                ? 'The count becomes this number, and the difference is recorded.'
                : direction === 'in'
                  ? 'Added to what you have.'
                  : 'Taken off what you have.'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 border-t border-slate-200 p-4">
            <label htmlFor="stock-note" className="text-sm font-medium text-slate-700">
              Note <span className="font-normal text-slate-400">optional</span>
            </label>
            <input
              id="stock-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Delivery from the wholesaler"
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && <Alert variant="error">{error}</Alert>}

        <StockHistory movements={movements} />
      </div>
    </FullScreenSheet>
  )
}

/**
 * The history, as one bordered block split by hairlines — the house list, not a
 * stack of cards. `balanceAfter` is stored per line so this renders without
 * replaying sums, and so a line that disagrees with the running balance is
 * visible instead of silently absorbed.
 */
function StockHistory({ movements }: { movements: StockMovementRow[] | null }) {
  if (movements === null) {
    return <p className="text-sm text-slate-500">Loading history…</p>
  }
  if (movements.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        Nothing recorded yet. Anything you add, and every sale, shows up here.
      </p>
    )
  }

  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Recent movements</p>
      <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
        {movements.map(m => {
          const who = m.clientName ?? m.userName
          return (
            <div key={m.id} className="flex items-start justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{REASON_LABEL[m.reason] ?? m.reason}</p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {new Date(m.at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                  {who ? ` · ${who}` : ''}
                  {m.note ? ` · ${m.note}` : ''}
                </p>
              </div>
              <div className="flex-shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-slate-900">
                  {m.delta > 0 ? `+${m.delta}` : m.delta}
                </p>
                {m.balanceAfter != null && (
                  <p className="text-xs tabular-nums text-slate-500">{m.balanceAfter} left</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
