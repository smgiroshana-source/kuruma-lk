// Gross-profit helpers for showing cost vs selling price in the vendor UI.
// GP% is margin on the selling price (price - cost) / price — consistent with
// the GP figure used in the reports. Cost is internal: never expose it publicly.

export function gpPercent(price: number | null | undefined, cost: number | null | undefined): number | null {
  const p = Number(price) || 0
  const c = Number(cost) || 0
  if (p <= 0) return null
  return Math.round(((p - c) / p) * 100)
}

/** True only when both are set and the selling price is at or below cost. */
export function isBelowCost(price: number | null | undefined, cost: number | null | undefined): boolean {
  const p = Number(price) || 0
  const c = Number(cost) || 0
  return p > 0 && c > 0 && p <= c
}

/**
 * The ex-VAT portion of a VAT-inclusive price. For a VAT-registered seller the
 * VAT slice is remitted to IRD, so margin/below-cost checks must compare cost
 * against this, not the sticker price.
 */
export function netOfVat(price: number | null | undefined, vatRatePercent: number): number {
  const p = Number(price) || 0
  const r = Number(vatRatePercent) || 0
  if (p <= 0 || r <= 0) return p
  return Math.round((p * 100) / (100 + r))
}

/**
 * The VAT-inclusive figure a stored (net) cost corresponds to.
 *
 * Cost is held net because that is the true cost to a VAT-registered seller —
 * the input VAT comes back. But a price quoted over the counter is
 * VAT-INCLUSIVE, so an operator glancing at the net cost to decide what to ask
 * will quote too low: Rs.64,358 net cost looks safely under a Rs.70,000 quote,
 * when that quote is only Rs.59,322 net and loses Rs.5,036 a tyre.
 *
 * This is the number to show beside a price the customer will hear — the floor
 * below which the sale loses money.
 */
export function costIncVat(cost: number | null | undefined, vatRatePercent: number): number {
  const c = Number(cost) || 0
  const r = Number(vatRatePercent) || 0
  if (c <= 0) return 0
  return Math.round(c * (100 + r) / 100)
}
