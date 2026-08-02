/**
 * The client's basket — shape, identity and arithmetic.
 *
 * BROWSER-ONLY BY DESIGN. There is no Cart table and there is not going to be
 * one: a basket is a thirty-second decision made on one device, and the cost of
 * persisting it (a table, a cleanup job, a cross-device merge rule, an
 * abandoned-cart backlog nobody asked for) is out of all proportion to that.
 * The lines live in React state, mirrored to localStorage so a tab reload or a
 * bounce out to Stripe doesn't lose them, and the SERVER re-prices and
 * re-checks every line at checkout — so a stale or tampered basket can only
 * ever produce a refusal, never a wrong charge.
 *
 * This module is imported by client components AND by the checkout route, so it
 * stays pure: no prisma, no Stripe, no React.
 */

/** One shop product (a specific variant, when the product has options). */
export interface BasketProductLine {
  kind: 'PRODUCT'
  productId: string
  /** Which size/colour. Null for a product sold as one thing. */
  variantId: string | null
  quantity: number
  // ── Display only, from the page that added it ──────────────────────────────
  // Never trusted at checkout: the route reads the price off the product row
  // again. Held here so the basket screen can render without a round trip.
  name: string
  variantName: string | null
  imageUrl: string | null
  unitAmount: number
}

/**
 * One class booking — a whole course, a set of casual sessions, or event
 * tickets. Deliberately ONE line per (run, choice) rather than per session:
 * "3 Saturdays of Puppy Foundations" is one decision the client made, and
 * splitting it into three rows they can half-remove is how someone ends up
 * enrolled in a course they meant to drop.
 */
export interface BasketClassLine {
  kind: 'CLASS'
  classRunId: string
  type: 'FULL' | 'DROP_IN'
  /** The chosen sessions for a DROP_IN. Empty for a FULL seat. */
  sessionIds: string[]
  /** Which dogs. A single null entry = booked without naming a dog. */
  dogIds: (string | null)[]
  /** Ticketed events only — the tier bought and how many. */
  ticketTierId: string | null
  ticketQuantity: number
  // ── Display only, as above ────────────────────────────────────────────────
  name: string
  detail: string | null
  imageUrl: string | null
  estimateCents: number
}

export type BasketLine = BasketProductLine | BasketClassLine

/**
 * A line's identity, and the whole reason the basket can answer "which one went
 * stale?". The checkout route echoes these keys back in its refusal, so the
 * review screen can strike through exactly the row that failed instead of
 * showing one red sentence over an unchanged list.
 *
 * Two adds of the same product+variant are the SAME line (quantity goes up);
 * two adds of the same class with different sessions are not.
 */
export function basketLineKey(line: BasketLine): string {
  if (line.kind === 'PRODUCT') {
    return `PRODUCT:${line.productId}:${line.variantId ?? '-'}`
  }
  const sessions = [...line.sessionIds].sort().join(',')
  const dogs = [...line.dogIds].map(d => d ?? '-').sort().join(',')
  return `CLASS:${line.classRunId}:${line.type}:${sessions}:${dogs}:${line.ticketTierId ?? '-'}`
}

/**
 * Add a line, or fold it into the matching one already there.
 *
 * Products ACCUMULATE — tapping "add" twice on the same harness means two
 * harnesses, which is what every shop on earth does. Class lines REPLACE: the
 * booking wizard hands over the client's whole current choice for that run each
 * time, so folding would double the seats they asked for.
 */
export function addBasketLine(lines: BasketLine[], line: BasketLine): BasketLine[] {
  const key = basketLineKey(line)
  const at = lines.findIndex(l => basketLineKey(l) === key)
  if (at === -1) return [...lines, line]
  const next = [...lines]
  const existing = next[at]
  next[at] =
    existing.kind === 'PRODUCT' && line.kind === 'PRODUCT'
      ? { ...line, quantity: existing.quantity + line.quantity }
      : line
  return next
}

export function removeBasketLine(lines: BasketLine[], key: string): BasketLine[] {
  return lines.filter(l => basketLineKey(l) !== key)
}

/** Change a product's quantity. Dropping to zero removes the line entirely. */
export function setBasketQuantity(lines: BasketLine[], key: string, quantity: number): BasketLine[] {
  if (quantity <= 0) return removeBasketLine(lines, key)
  return lines.map(l =>
    basketLineKey(l) === key && l.kind === 'PRODUCT' ? { ...l, quantity: Math.min(quantity, MAX_PRODUCT_QUANTITY) } : l,
  )
}

/** Ceiling on one product line, mirrored by the checkout route's schema. */
export const MAX_PRODUCT_QUANTITY = 20
/** Ceiling on the basket as a whole, mirrored by the checkout route's schema. */
export const MAX_BASKET_LINES = 40

/**
 * The number on the badge. A product counts its units; a class counts as one
 * thing however many sessions or dogs it covers — "12" on the badge for one
 * course booking would read as a mistake.
 */
export function basketCount(lines: BasketLine[]): number {
  return lines.reduce((n, l) => n + (l.kind === 'PRODUCT' ? l.quantity : 1), 0)
}

/**
 * What the basket screen shows as the total. An ESTIMATE, and labelled as one
 * where it matters: the server applies the offering's discounts at checkout, so
 * the amount actually charged can be lower than this. It is never higher —
 * discounts only ever come off.
 */
export function basketSubtotalCents(lines: BasketLine[]): number {
  return lines.reduce(
    (sum, l) => sum + (l.kind === 'PRODUCT' ? l.unitAmount * l.quantity : l.estimateCents),
    0,
  )
}

/**
 * A stable signature for a set of checkout lines.
 *
 * This is how a double-tapped Pay button stops being two payments. With no
 * basket table there is no id to be idempotent against, so the checkout route
 * fingerprints the lines it is about to create and looks for a PENDING Payment
 * from the last half hour carrying the same fingerprint; a match is re-used and
 * its Stripe session simply re-minted, so the second tap lands on the SAME
 * Payment row rather than a second one.
 *
 * The card-surcharge line is skipped: it is appended by createPaymentRecord
 * after the caller's lines, so including it would make a stored payment never
 * match the basket that produced it.
 */
export interface FingerprintableLine {
  kind: string
  unitAmount: number
  quantity?: number | null
  productId?: string | null
  variantId?: string | null
  intent?: unknown
}

export function checkoutFingerprint(lines: FingerprintableLine[]): string {
  return lines
    .filter(l => !isSurchargeLine(l))
    .map(l =>
      [
        l.kind,
        l.unitAmount,
        l.quantity ?? 1,
        l.productId ?? '-',
        l.variantId ?? '-',
        stableJson(l.intent),
      ].join('|'),
    )
    .sort()
    .join('\n')
}

function isSurchargeLine(l: FingerprintableLine): boolean {
  const intent = l.intent as { surcharge?: unknown } | null | undefined
  return !!intent && typeof intent === 'object' && intent.surcharge === true
}

/** JSON with object keys sorted, so two equal intents always stringify alike. */
function stableJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** What the checkout route is sent — the choices only, never the prices. */
export type BasketRequestLine =
  | { kind: 'PRODUCT'; key: string; productId: string; variantId: string | null; quantity: number }
  | {
      kind: 'CLASS'
      key: string
      classRunId: string
      type: 'FULL' | 'DROP_IN'
      sessionIds: string[]
      dogIds: (string | null)[]
      ticketTierId: string | null
      quantity: number
    }

/**
 * Strip a basket down to what the server needs. The prices, names and photos
 * are deliberately left behind — everything that decides the charge is read
 * from the database again, so a basket edited in devtools buys nothing it
 * shouldn't.
 */
export function toRequestLines(lines: BasketLine[]): BasketRequestLine[] {
  return lines.map(l =>
    l.kind === 'PRODUCT'
      ? {
          kind: 'PRODUCT' as const,
          key: basketLineKey(l),
          productId: l.productId,
          variantId: l.variantId,
          quantity: l.quantity,
        }
      : {
          kind: 'CLASS' as const,
          key: basketLineKey(l),
          classRunId: l.classRunId,
          type: l.type,
          sessionIds: l.sessionIds,
          dogIds: l.dogIds,
          ticketTierId: l.ticketTierId,
          quantity: l.ticketQuantity,
        },
  )
}
