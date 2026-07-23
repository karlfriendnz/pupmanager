/**
 * The heading row a detail card starts with.
 *
 * It's a fixed height (h-11 — the height of a default Button) whether or not
 * the card has an action in it, so the first line of a left-hand card lines up
 * with the first line of the card beside it. Without this, a heading that
 * shares its row with a button sits ~10px lower than a plain <h2> next to it,
 * and two columns of cards never quite agree.
 */
export function CardHeading({
  icon,
  children,
  count,
  note,
  action,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  /** Rendered as "(3)" beside the title. */
  count?: number
  /** Free text in the same spot, for a count that isn't just a number. */
  note?: string
  action?: React.ReactNode
}) {
  return (
    // mb-2 on top of the row's own centring — a heading sitting straight on
    // the first row of facts reads as part of the list rather than over it.
    <div className="mb-2 flex h-11 items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-semibold text-slate-900">
        {icon} {children}
        {(count != null || note) && (
          <span className="text-sm font-normal text-slate-500">({note ?? count})</span>
        )}
      </h2>
      {action}
    </div>
  )
}
