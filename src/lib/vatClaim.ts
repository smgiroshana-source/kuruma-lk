// ── Which months a GRN's input VAT may be claimed in (owner, 2026-11-13) ─────
// VAT Act (consolidated to 2025):
//   s.4(1)  a supply of goods takes place at the EARLIEST of the supplier's
//           invoice, a payment, payment falling due, or delivery;
//   s.22(6)(iii)-(iv)  the tax invoice must be received within 12 months from
//           the end of the taxable period in which it was ISSUED, and claimed
//           for a period ending within 12 months of the INVOICE DATE.
// So a credit may be claimed from the month of the supplier's invoice (or the
// month the goods came in, if earlier) and for 12 months after the invoice
// date. GRN-V-00015 (Prime Lanka PLTV-00170, dated 30 Oct 2026, received
// 2 Nov) may go in October; the system had refused anything before November.
//
// The DEFAULT claim month stays the month the GRN was received: an invoice
// that arrives late never lands by itself in a return already filed. Moving it
// back to its invoice month is the operator's choice in the Filing Centre.
// Imports (GRN-I) keep their own clock: 24 months from the goods coming in.

const ym = (d: unknown): string | null => {
  const s = String(d ?? '').slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.slice(0, 7) : null
}

export const addMonthsYm = (m: string, n: number): string => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** Earliest month the GRN's input VAT may be claimed in. receivedMonth must be the Colombo month of received_at. */
export function grnEarliestClaimMonth(g: { supplier_invoice_date?: string | null; grn_series?: string | null }, receivedMonth: string): string {
  if (g.grn_series === 'I') return receivedMonth
  const inv = ym(g.supplier_invoice_date)
  return inv && inv < receivedMonth ? inv : receivedMonth
}

/** Last month the credit may be claimed in: 12 months from the invoice date (imports: 24 from receipt). */
export function grnClaimDeadline(g: { supplier_invoice_date?: string | null; grn_series?: string | null }, receivedMonth: string): string {
  if (g.grn_series === 'I') return addMonthsYm(receivedMonth, 24)
  return addMonthsYm(ym(g.supplier_invoice_date) || receivedMonth, 12)
}
