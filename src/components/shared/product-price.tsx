import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import { effectivePriceCents, isOnSale, savingPercent, type ProductPricing } from '@/lib/product-price'

/**
 * A product's price, wherever it is shown.
 *
 * One component so the sale price and the struck-through original can never
 * drift apart between the trainer's list, the client's shop card and the shop
 * detail — and so nothing hand-formats a `$`, which is wrong the moment a
 * trainer's base currency isn't a dollar.
 *
 * Server-safe: takes `currency` explicitly rather than reading the context, so
 * a server component can render it. Client components pass `useCurrency()`.
 */
export function ProductPrice({
  product,
  currency,
  size = 'sm',
  unpricedLabel = 'Contact',
  className,
}: {
  product: ProductPricing
  currency: string
  size?: 'sm' | 'lg'
  /** What to say when there's no price at all. */
  unpricedLabel?: string
  className?: string
}) {
  const cents = effectivePriceCents(product)
  const onSale = isOnSale(product)

  if (cents == null) {
    return (
      <span className={cn(size === 'lg' ? 'text-lg' : 'text-sm', 'font-semibold text-slate-500', className)}>
        {unpricedLabel}
      </span>
    )
  }

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      <span className={cn(size === 'lg' ? 'text-lg' : 'text-sm', 'font-semibold text-slate-900')}>
        {formatMoney(cents, currency)}
      </span>
      {onSale && (
        <>
          <s className={cn(size === 'lg' ? 'text-sm' : 'text-xs', 'font-medium text-slate-400')}>
            {formatMoney(product.priceCents as number, currency)}
          </s>
          <span className={cn(size === 'lg' ? 'text-xs' : 'text-[10px]', 'font-semibold uppercase tracking-wide text-rose-600')}>
            {savingPercent(product)}% off
          </span>
        </>
      )}
    </span>
  )
}

/**
 * The corner tag on a product image. Rendered only when a saving is actually
 * being advertised — the one place a bit of colour is earned, because it's the
 * whole point of the sale.
 */
export function SaleTag({ product, className }: { product: ProductPricing; className?: string }) {
  if (!isOnSale(product)) return null
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white',
        className
      )}
    >
      Sale
    </span>
  )
}
