/**
 * The ex-VAT cost of a unit of stock — the figure to set against net revenue,
 * to value the shelf, and to write off.
 *
 * products.cost is stored NET in every path: a GRN writes the net unit cost,
 * and the 22 Aug 2026 CSV import divided the owner's VAT-inclusive figures by
 * 1.18 before storing them (75,943 on the sheet → 64,358). The FIFO layers and
 * sale-time snapshots carry those same net figures.
 *
 * cost_includes_vat is the one exception: a product whose stored figure still
 * contains VAT. Nothing is flagged that way today. On 26 Aug 2026 the CSV
 * tyres were flagged by mistake (the flag was set as if the net figure were
 * gross), which made this helper strip VAT a second time and understate cost
 * by 15% in the profit report, stock value and write-offs. Corrected 15 Sep
 * 2026: those products carry cost_vat_rate = 18 and the flag is false. Don't
 * re-flag CSV stock; check the stored figure against the sheet first.
 */
export const DEFAULT_VAT_RATE = 18

export function netStockCost(cost: number | null | undefined, prod: { cost_includes_vat?: any } | null | undefined, vatRate: number = DEFAULT_VAT_RATE): number {
  const c = Math.round(Number(cost) || 0)
  if (c <= 0) return 0
  return prod?.cost_includes_vat ? Math.round(c * 100 / (100 + (Number(vatRate) || DEFAULT_VAT_RATE))) : c
}
