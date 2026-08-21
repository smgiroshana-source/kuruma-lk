// ─────────────────────────────────────────────────────────────────────────────
// What IRD Schedule 02 needs before an input-VAT credit can be filed
//
// A local purchase only earns an input-VAT credit if it is backed by a valid
// supplier tax invoice, and Schedule 02 lists three things off that invoice:
// the supplier's invoice NUMBER, its DATE, and the supplier's TIN. Miss any
// one and the line can't be filed — the credit is lost, or worse, filed with a
// blank field and queried later.
//
// The trap this closes: nothing used to ask for them. A GRN could be posted
// with VAT on it and no paperwork at all, and the gap only surfaced weeks
// later at filing time (GRN-00007, Aug 2026) when the goods were long sold and
// the delivery note nowhere to be found. So the check lives at POSTING — the
// moment the purchase enters the VAT ledger — not at filing.
//
// Deliberately NOT applied when there is no input VAT to claim: a purchase
// from a non-registered supplier has no Schedule 02 line, so its paperwork is
// bookkeeping preference, not a legal requirement.
// ─────────────────────────────────────────────────────────────────────────────

export type VatPaperwork = {
  supplier_invoice_no?: string | null
  supplier_invoice_date?: string | null
  supplier_tin?: string | null
}

/** Human-readable list of what Schedule 02 is still missing. Empty = filable. */
export function missingVatPaperwork(row: VatPaperwork): string[] {
  const gaps: string[] = []
  if (!row.supplier_invoice_no) gaps.push('supplier invoice number')
  if (!row.supplier_invoice_date) gaps.push('supplier invoice date')
  if (!row.supplier_tin) gaps.push('supplier TIN')
  return gaps
}

/** One sentence naming the gaps, for an error message or a warning banner. */
export function vatPaperworkMessage(gaps: string[]): string {
  const list = gaps.length > 1
    ? gaps.slice(0, -1).join(', ') + ' and ' + gaps[gaps.length - 1]
    : gaps[0]
  return `Missing the ${list}. VAT Schedule 02 needs ${gaps.length > 1 ? 'these' : 'this'} to file the input VAT claim.`
}
