/**
 * Loose-counted stock: sells even at 0, the count is approximate by design
 * and is corrected at the next GRN or stocktake. Two things qualify:
 *   - consumables (patches, valves, weights) by product type, and
 *   - any product switched on as a Money-in quick item (owner, 2026-09-08:
 *     "every quick item should be loose count"). A flap on the counter is
 *     sold by the piece the way a valve is, whatever its catalogue type.
 */
export const isLooseCount = (p: any): boolean =>
  !!p && (p.product_type === 'consumable' || !!p.show_in_money_in)
