/**
 * How many of a product an order is for.
 *
 * ONE definition of the bounds, imported by the routes, the invoice and the
 * basket alike, because "at least 1, a whole number, at most twenty" written
 * out three times is three places for it to drift — and the browser's `<input
 * type="number" min="1">` is not the check (AGENTS.md #3). Every route that
 * accepts a quantity runs it through `quantitySchema`; everything that merely
 * needs to be defensive about a number it was handed calls `normaliseQuantity`.
 *
 * Pure on purpose: no prisma, no React. The client shop, the trainer's add
 * screen and the invoice builder all import it.
 */

import { z } from 'zod'
import { MAX_PRODUCT_QUANTITY } from './basket'

export { MAX_PRODUCT_QUANTITY }

/**
 * What a request body may say. Optional so that every existing caller — and
 * every app build already on a phone — keeps meaning one.
 *
 * `.int()` rather than a silent floor: 2.5 harnesses is not a typo to be
 * guessed at, it is a request that should be refused. Same for 0 and -1, which
 * would otherwise become a sale that took nothing off the shelf and billed for
 * nothing.
 */
export const quantitySchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_PRODUCT_QUANTITY)
  .optional()

/**
 * Coerce an already-trusted number into the bounds. Used where the value came
 * from OUR OWN code rather than a request body (an invoice being built from a
 * row that has already been validated), so it clamps rather than refusing.
 */
export function normaliseQuantity(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 1
  return Math.min(MAX_PRODUCT_QUANTITY, Math.max(1, Math.floor(value)))
}

/**
 * Is there enough on the shelf for the whole order?
 *
 * `null` means the product isn't counted, and an uncounted product can never
 * run out — the same rule `inStock` has always applied, just asked about N
 * units instead of one.
 */
export function enoughStock(stockCount: number | null | undefined, quantity: number): boolean {
  if (stockCount === null || stockCount === undefined) return true
  return stockCount >= quantity
}

/**
 * The refusal a client or trainer should read when the shelf is short.
 *
 * Named rather than inlined because "out of stock" and "you asked for three and
 * there are two" are different problems with different fixes, and a single
 * message for both sends someone to look for a product that is sitting right
 * there. Worded to match the basket checkout's existing refusal.
 */
export function shortStockMessage(
  name: string,
  stockCount: number | null | undefined,
  quantity: number,
): string {
  if (stockCount == null || stockCount <= 0) return `${name} is out of stock.`
  return `Only ${stockCount} of ${name} left — you asked for ${quantity}.`
}
