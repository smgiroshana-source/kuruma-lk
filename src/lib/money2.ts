/**
 * Two-decimal money for the figures that are somebody else's: supplier tax
 * invoices, supplier credit notes, CUSDECs. The books stay in whole rupees;
 * these are copied off the paper as printed and never recomputed, because
 * IRD matches our input claims against what the supplier declared.
 */

/** Round to cents. NaN, null, '' → 0. */
export function round2(n: unknown): number {
  const v = Number(n)
  if (!Number.isFinite(v)) return 0
  return Math.round(v * 100) / 100
}

/** A printed figure if one was recorded, else the whole-rupee book figure. */
export function exactOr(doc: unknown, fallback: unknown): number {
  if (doc !== null && doc !== undefined && doc !== '' && Number.isFinite(Number(doc))) return round2(doc)
  return Math.round(Number(fallback) || 0)
}

/** For CSV schedules: always two decimals. */
export const fmt2 = (n: unknown) => round2(n).toFixed(2)
