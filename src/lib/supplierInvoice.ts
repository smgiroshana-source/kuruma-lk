/**
 * Re-derive a supplier invoice's credit_total and status from the credit notes
 * actually on file.
 *
 * Lives here because two places create credit notes — a note typed in by hand,
 * and one raised automatically when goods go back to a supplier — and both must
 * settle the invoice by the same rule. A second copy of this logic drifted from
 * the first almost immediately: it reported a fully-credited invoice as
 * "partial" and lost the overdue state entirely.
 */
export async function recomputeSupplierInvoice(admin: any, vendorId: string, invoiceId: string) {
  const { data: inv } = await admin.from('supplier_invoices')
    .select('amount, amount_paid, due_date, cn_expected_amount').eq('id', invoiceId).eq('vendor_id', vendorId).single()
  if (!inv) return
  const { data: notes } = await admin.from('supplier_credit_notes')
    .select('total_amount').eq('supplier_invoice_id', invoiceId).eq('vendor_id', vendorId)
  const creditTotal = (notes || []).reduce((t: number, n: any) => t + Number(n.total_amount || 0), 0)
  const settled = Number(inv.amount_paid || 0) + creditTotal
  const owed = Number(inv.amount || 0) - settled
  // "Credit note expected" (2026-09-30) can never be more than is still owed,
  // and goes once nothing is owed. The part waiting on a note is not money to
  // pay, so it never makes the bill overdue.
  const cn = Number(inv.cn_expected_amount || 0)
  const cnNext = cn > 0 && owed > 0 ? Math.min(cn, owed) : null
  const payable = owed - (cnNext || 0)
  // An invoice fully covered by credits is settled, not "partly paid" — nothing
  // is outstanding, so it must stop appearing in payables and ageing.
  const status = owed <= 0 ? 'paid'
    : payable > 0 && inv.due_date && String(inv.due_date) < new Date().toISOString().slice(0, 10) ? 'overdue'
    : settled > 0 ? 'partial'
    : 'unpaid'
  const patch: any = { credit_total: creditTotal, status }
  if (cn > 0 && cnNext !== cn) {
    patch.cn_expected_amount = cnNext
    if (cnNext == null) { patch.cn_expected_since = null; patch.cn_expected_by = null }
  }
  await admin.from('supplier_invoices').update(patch).eq('id', invoiceId).eq('vendor_id', vendorId)
}
