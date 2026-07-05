/**
 * Resolve whether a bookable item (package / class / product) requires the
 * client to pay up front to book, honouring the per-item override and falling
 * back to the trainer's account default.
 *
 *   - itemRequirePayment === true   → always require payment (pay-to-book)
 *   - itemRequirePayment === false  → never require payment (book now, invoice later)
 *   - itemRequirePayment == null    → inherit the trainer's default
 *
 * This only governs the decision when the trainer CAN take cards — a trainer
 * with payments switched off always falls back to invoicing regardless.
 */
export function resolveRequirePayment(
  itemRequirePayment: boolean | null,
  trainerDefault: boolean,
): boolean {
  return itemRequirePayment ?? trainerDefault
}
