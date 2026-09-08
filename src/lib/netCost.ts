/**
 * The ex-VAT cost of a unit of stock — the figure to set against net revenue,
 * to value the shelf, and to write off.
 *
 * Stock bought through a GRN is stored net (the input VAT comes back through
 * the VAT return and is not a cost of the goods). The opening stock loaded by
 * CSV was keyed VAT-INCLUSIVE and flagged cost_includes_vat; its FIFO layers
 * and sale-time snapshots carry that gross figure. Any figure that came from
 * such a product must be taken net here. Owner, 2026-09-08: a 300R 18 tyre
 * read as a 2% loss against its gross cost when it made 14%.
 */
export const DEFAULT_VAT_RATE = 18

export function netStockCost(cost: number | null | undefined, prod: { cost_includes_vat?: any } | null | undefined, vatRate: number = DEFAULT_VAT_RATE): number {
  const c = Math.round(Number(cost) || 0)
  if (c <= 0) return 0
  return prod?.cost_includes_vat ? Math.round(c * 100 / (100 + (Number(vatRate) || DEFAULT_VAT_RATE))) : c
}
