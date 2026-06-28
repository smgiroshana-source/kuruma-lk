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
