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

// ── Checking the figures copied off a supplier's tax invoice (2026-11-16) ────
// GRN-V-00015: Prime Lanka's paper prints no single net figure (its "Total
// Value of Supply" is the price BEFORE discounts), so the TOTAL incl. VAT
// (263,788.96) was typed into the net box. The VAT box was right, nothing
// checked the net, and Schedule 02 carried the total as the value of purchase.

const num = (x: unknown): number | null =>
  x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x)
const rs2 = (x: number) => 'Rs.' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * What the supplier billed, to the rupee: the printed net + VAT when both were
 * copied off the tax invoice, else our book total (owner, 2026-11-21).
 * Our unit costs are whole rupees and the supplier's carry cents, so the book
 * total drifts a few rupees from the paper — GRN-V-00019: 4 × 32,882 booked
 * against 4 × 32,881.36 printed, a bill of Rs.155,203 for an invoice of
 * Rs.155,200, leaving Rs.3 open after paying in full. A printed total further
 * from the book than rounding explains (50 cents a unit + VAT) is a typo, not
 * rounding — then the book total stands.
 */
export function supplierBillAmount(bookTotal: unknown, docNet: unknown, docVat: unknown, units: number): number {
  const book = Math.round(Number(bookTotal) || 0)
  const n = num(docNet), v = num(docVat)
  if (n == null || v == null || n <= 0) return book
  const printed = Math.round(n + v)
  return Math.abs(printed - book) <= 1 + units * 0.6 ? printed : book
}

/** The VAT rate the book lines actually carry (mixed 18% / 0% lines give less than 18). */
export function bookVatRate(bookNet: unknown, bookVat: unknown): number {
  const n = Number(bookNet) || 0, v = Number(bookVat) || 0
  if (n <= 0) return 0
  // Per-line whole-rupee VAT drifts the rate a little (GRN-V-00012: 18.002%);
  // within 0.1 of a whole percent it IS that percent.
  const r = (v / n) * 100, whole = Math.round(r)
  return Math.abs(r - whole) < 0.1 ? whole : r
}

/**
 * True when the "net" is really net + VAT: taking the VAT off it leaves a
 * figure whose VAT at `ratePct` IS the printed VAT. A genuine net can't pass
 * this (it would need VAT = rate × net and VAT = rate × (net − VAT) at once),
 * so it is safe to refuse on.
 */
export function printedNetIsTotal(docNet: unknown, docVat: unknown, ratePct: number): boolean {
  const n = num(docNet), v = num(docVat)
  if (n == null || v == null || v <= 0 || n <= v || ratePct <= 0) return false
  return Math.abs((n - v) * ratePct / 100 - v) <= 1
}

/**
 * Warnings for the printed net / VAT pair. `net` speaks about the net box,
 * `pair` about the two boxes disagreeing. Advisory — except the total-as-net
 * case, which the server refuses (printedNetIsTotal).
 * `units` (lines' unit count) allows 50 cents a unit: our costs are whole
 * rupees, the supplier's carry cents.
 */
export function printedFigureWarnings(o: {
  docNet: unknown; docVat: unknown; ratePct: number
  bookNet?: number | null; bookVat?: number | null; units?: number | null
}): { net: string | null; pair: string | null } {
  const n = num(o.docNet), v = num(o.docVat)
  if (n == null || n <= 0) return { net: null, pair: null }
  const bookNet = o.bookNet != null && o.bookNet > 0 ? o.bookNet : null
  const bookVat = o.bookVat || 0
  const total = bookNet != null ? bookNet + bookVat : null
  const tol = o.units != null ? 1 + o.units * 0.5 : Math.max(2, (bookNet || 0) * 0.002)

  if (printedNetIsTotal(n, v, o.ratePct) || (total != null && bookVat > 0 && Math.abs(n - total) <= tol * 1.2)) {
    const hint = v != null && v > 0 ? round2(n - v) : bookNet
    return { net: `This is the total INCLUDING VAT. Enter the amount before VAT${hint != null ? ` — about ${rs2(hint)}` : ''}. If the paper prints no net, add up the line totals.`, pair: null }
  }
  let net: string | null = null
  if (bookNet != null && o.units != null && Math.abs(n - bookNet) > tol) {
    net = `${rs2(Math.abs(n - bookNet))} from the lines' net (Rs.${bookNet.toLocaleString()}) — more than whole-rupee costs explain. A discount not entered, a mistyped cost, or the wrong figure copied?`
  }
  let pair: string | null = null
  if (v != null && v > 0 && o.ratePct > 0) {
    const expected = round2(n * o.ratePct / 100)
    if (Math.abs(v - expected) > 1) {
      pair = `VAT ${rs2(v)} is not ${round2(o.ratePct)}% of the net ${rs2(n)} (that would be ${rs2(expected)}) — one of the two is not what the paper says.`
    }
  }
  return { net, pair }
}
