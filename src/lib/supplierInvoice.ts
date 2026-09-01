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
    .select('amount, amount_paid, due_date').eq('id', invoiceId).eq('vendor_id', vendorId).single()
  if (!inv) return
  const { data: notes } = await admin.from('supplier_credit_notes')
    .select('total_amount').eq('supplier_invoice_id', invoiceId).eq('vendor_id', vendorId)
  const creditTotal = (notes || []).reduce((t: number, n: any) => t + Number(n.total_amount || 0), 0)
  const settled = Number(inv.amount_paid || 0) + creditTotal
  const owed = Number(inv.amount || 0) - settled
  // An invoice fully covered by credits is settled, not "partly paid" — nothing
  // is outstanding, so it must stop appearing in payables and ageing.
  const status = owed <= 0 ? 'paid'
    : settled > 0 ? 'partial'
    : (inv.due_date && String(inv.due_date) < new Date().toISOString().slice(0, 10)) ? 'overdue'
    : 'unpaid'
  await admin.from('supplier_invoices')
    .update({ credit_total: creditTotal, status }).eq('id', invoiceId).eq('vendor_id', vendorId)
}
