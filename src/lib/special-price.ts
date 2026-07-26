/**
 * One rule about special prices, in one place.
 *
 * A special price is a DISCOUNT — every screen that shows one renders it beside
 * the normal price as the amount actually charged, so a "special" set ABOVE the
 * normal price doesn't read as an increase, it reads as a saving while quietly
 * billing more. That's not a preference, it's a wrong number going out to a
 * client, so the rule is enforced twice: in the form (so the trainer gets a
 * sentence while they're typing) and in the API (so it's true regardless of
 * what did the asking).
 *
 * Equal is allowed — "the special price is the same this month" is a legitimate
 * thing to type on the way to changing one of them.
 */

export const SPECIAL_PRICE_TOO_HIGH =
  'The special price has to be the same as, or lower than, the price — it’s a discount, not a surcharge.'

/**
 * True when `special` is a usable discount on `price`.
 *
 * A missing special price is always fine (there's no discount to check), and so
 * is a missing normal price — an offering with no set price has nothing for the
 * special to be measured against, and refusing that would block a half-filled
 * form the trainer is still working through.
 */
export function isValidSpecialPrice(
  price: number | null | undefined,
  special: number | null | undefined,
): boolean {
  if (special === null || special === undefined) return true
  if (price === null || price === undefined) return true
  return special <= price
}
