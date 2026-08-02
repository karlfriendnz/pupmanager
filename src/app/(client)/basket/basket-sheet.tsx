'use client'

import { useState } from 'react'
import { AlertCircle, CreditCard, Loader2, Minus, Package as PackageIcon, Plus, ShoppingBag, Trash2 } from 'lucide-react'
import { FullScreenSheet } from '@/components/shared/full-screen-sheet'
import { FlatBlock } from '@/components/shared/flat-list'
import { formatMoney } from '@/lib/money'
import { useCurrency } from '@/components/currency-context'
import { openExternal } from '@/lib/external-link'
import { nativePlatform } from '@/lib/native'
import { basketLineKey, toRequestLines, MAX_PRODUCT_QUANTITY, type BasketLine } from '@/lib/basket'
import { PREVIEW_REASON, useIsPreview } from '../preview-context'
import { useBasket } from './basket-context'

/**
 * Review before paying — the whole screen on a phone, a contained panel on a
 * desktop (FullScreenSheet gives us both, plus the body-scroll lock so there is
 * never a second scrollbar behind it).
 *
 * The one screen in this feature that has to be honest about money: it shows
 * what each line costs, says the total is an ESTIMATE where discounts are in
 * play, and — when the server refuses — strikes the failed rows rather than
 * showing one red sentence over an unchanged list.
 */
export function BasketSheet() {
  const basket = useBasket()
  const currency = useCurrency()
  const isPreview = useIsPreview()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Line key → why it can't be bought. Set from the server's 409. */
  const [stale, setStale] = useState<Record<string, string>>({})

  async function pay() {
    // First guard against the double tap. The server has its own (it reuses an
    // identical PENDING payment rather than raising a second), but not sending
    // the second request at all is cheaper and stops the spinner flickering.
    if (busy) return
    setBusy(true)
    setError(null)
    setStale({})
    try {
      const res = await fetch('/api/my/basket/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pm-platform': nativePlatform() },
        body: JSON.stringify({ lines: toRequestLines(basket.lines) }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok && body.url) {
        openExternal(body.url)
        return // leaving for Stripe — keep the spinner up
      }
      if (Array.isArray(body.unavailable)) {
        const next: Record<string, string> = {}
        for (const u of body.unavailable as { key?: string; reason?: string }[]) {
          if (typeof u?.key === 'string') next[u.key] = typeof u.reason === 'string' ? u.reason : 'No longer available.'
        }
        setStale(next)
      }
      setError(typeof body.error === 'string' ? body.error : 'Could not start checkout.')
    } catch {
      setError('Could not start checkout.')
    } finally {
      setBusy(false)
    }
  }

  /** Clear out everything the server just refused, so Pay can be tried again. */
  function dropStale() {
    for (const key of Object.keys(stale)) basket.remove(key)
    setStale({})
    setError(null)
  }

  const empty = basket.lines.length === 0

  return (
    <FullScreenSheet
      title="Your basket"
      sub={empty ? undefined : `${basket.count} item${basket.count === 1 ? '' : 's'}`}
      onClose={basket.close}
      footer={
        empty ? (
          <button
            type="button"
            onClick={basket.close}
            className="h-12 w-full rounded-xl bg-slate-900 text-[15px] font-semibold text-white"
          >
            Keep shopping
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-slate-500">Total</span>
              <span className="text-lg font-bold tabular-nums text-slate-900">
                {formatMoney(basket.subtotalCents, currency)}
              </span>
            </div>
            {/* Said before they tap, not after the number changes on Stripe. */}
            <p className="text-[11px] text-slate-400">
              Any class discounts your trainer set come off at checkout.
            </p>
            {error && (
              <p className="flex items-start gap-1.5 text-[13px] text-rose-600">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} />
                <span>{error}</span>
              </p>
            )}
            {Object.keys(stale).length > 0 && (
              <button
                type="button"
                onClick={dropStale}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700"
              >
                Remove {Object.keys(stale).length === 1 ? 'it' : 'them'} and carry on
              </button>
            )}
            {isPreview ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-center text-[11px] text-amber-800">{PREVIEW_REASON}</p>
            ) : (
              <button
                type="button"
                onClick={pay}
                disabled={busy}
                className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-semibold text-accent-fg disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" strokeWidth={1.75} />}
                Pay {formatMoney(basket.subtotalCents, currency)}
              </button>
            )}
            <button
              type="button"
              onClick={basket.close}
              className="h-10 w-full text-sm font-medium text-slate-500"
            >
              Continue shopping
            </button>
          </div>
        )
      }
    >
      {empty ? (
        <div className="flex flex-col items-center justify-center py-14 text-center">
          <ShoppingBag className="h-8 w-8 text-slate-300" strokeWidth={1.75} />
          <p className="mt-3 text-sm font-medium text-slate-600">Nothing in your basket yet</p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">
            Add products from the shop and classes from your booking screen, then pay for the lot in one go.
          </p>
        </div>
      ) : (
        <FlatBlock>
          {basket.lines.map(line => (
            <BasketRow
              key={basketLineKey(line)}
              line={line}
              currency={currency}
              problem={stale[basketLineKey(line)] ?? null}
              onRemove={() => basket.remove(basketLineKey(line))}
              onQuantity={q => basket.setQuantity(basketLineKey(line), q)}
            />
          ))}
        </FlatBlock>
      )}
    </FullScreenSheet>
  )
}

function BasketRow({
  line,
  currency,
  problem,
  onRemove,
  onQuantity,
}: {
  line: BasketLine
  currency: string
  /** Set once the server has said this one can't be bought. */
  problem: string | null
  onRemove: () => void
  onQuantity: (quantity: number) => void
}) {
  const isProduct = line.kind === 'PRODUCT'
  const amount = isProduct ? line.unitAmount * line.quantity : line.estimateCents
  const sub = isProduct ? line.variantName : line.detail

  return (
    <div className={problem ? 'bg-rose-50/60' : undefined}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-slate-100">
          {line.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-slate-400">
              <PackageIcon className="h-5 w-5" strokeWidth={1.75} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium text-slate-900 ${problem ? 'line-through opacity-60' : ''}`}>{line.name}</p>
          {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
          {isProduct && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-200">
              <StepButton label="One fewer" onClick={() => onQuantity(line.quantity - 1)}>
                <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </StepButton>
              <span className="min-w-6 text-center text-sm font-semibold tabular-nums text-slate-900">{line.quantity}</span>
              <StepButton
                label="One more"
                disabled={line.quantity >= MAX_PRODUCT_QUANTITY}
                onClick={() => onQuantity(line.quantity + 1)}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
              </StepButton>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-2">
          <span className="text-sm font-semibold tabular-nums text-slate-900">{formatMoney(amount, currency)}</span>
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${line.name}`}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {/* Named against the row it happened to — "3 things are unavailable" at
          the bottom of the screen makes the client hunt for which. */}
      {problem && (
        <p className="flex items-start gap-1.5 px-4 pb-3 text-[12px] text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.75} />
          <span>{problem}</span>
        </p>
      )}
    </div>
  )
}

function StepButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center text-slate-600 disabled:opacity-30"
    >
      {children}
    </button>
  )
}
