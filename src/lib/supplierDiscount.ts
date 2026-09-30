/**
 * A supplier discount that will never get a credit note (owner, 2026-09-30).
 *
 * Early-payment discounts often come with no paperwork: pay 95% within the
 * week and the supplier writes off the rest. Recorded as a supplier credit
 * with an internal DISC-XXXXX number, reason 'discount', VAT 0 — the tax
 * invoice stands as issued, so the input VAT claim is unchanged and nothing
 * reaches Schedule 04 — and the invoice is re-settled.
 *
 * Only for a discount the supplier has CONFIRMED will get no note. One still
 * waiting on a note is left open on the invoice until the note is entered, so
 * it can't be forgotten. Used by the Credit Note form's "No credit note" tick
 * and by the Record Payment window's discount field.
 */
import { recomputeSupplierInvoice } from '@/lib/supplierInvoice'

export const NO_NOTE_REMARK = 'No credit note — supplier confirmed none will be issued'

/** Next internal DISC number for this vendor (DISC-00001, DISC-00002 …). */
export async function nextDiscNo(admin: any, vendorId: string): Promise<string> {
  const { data: prior } = await admin.from('supplier_credit_notes')
    .select('credit_note_no').eq('vendor_id', vendorId).like('credit_note_no', 'DISC-%')
  const highest = (prior || []).reduce((m: number, r: any) => {
    const n = parseInt(String(r.credit_note_no).replace('DISC-', ''), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  return `DISC-${String(highest + 1).padStart(5, '0')}`
}

/** Record the discount against one invoice and re-settle it. Returns the note, or an error. */
export async function recordNoNoteDiscount(admin: any, opts: {
  vendorId: string; supplierId: string; invoiceId: string; amount: number; date: string
  userId: string | null; invoiceNo?: string | null; invoiceDate?: string | null; remarks?: string | null
}): Promise<{ note?: any; error?: string }> {
  const amount = Math.round(Number(opts.amount) || 0)
  if (amount <= 0) return { error: 'The discount must be more than zero' }
  // Two saves racing for the same DISC number: the unique index refuses the
  // second, so try the next number once more before giving up
  for (let attempt = 0; attempt < 2; attempt++) {
    const noteNo = await nextDiscNo(admin, opts.vendorId)
    const { data, error } = await admin.from('supplier_credit_notes').insert({
      vendor_id: opts.vendorId, supplier_id: opts.supplierId, supplier_invoice_id: opts.invoiceId,
      credit_note_no: noteNo, credit_note_date: opts.date,
      invoice_no: opts.invoiceNo || null, invoice_date: opts.invoiceDate || null,
      reason: 'discount',
      remarks: [NO_NOTE_REMARK, String(opts.remarks || '').trim()].filter(Boolean).join(' · '),
      net_amount: amount, vat_amount: 0, total_amount: amount,
      doc_net: null, doc_vat: null,
      created_by: opts.userId,
    }).select().single()
    if (!error && data) {
      await recomputeSupplierInvoice(admin, opts.vendorId, opts.invoiceId)
      return { note: data }
    }
    if (!/unique/i.test(error?.message || '')) return { error: error?.message || 'Could not record the discount' }
  }
  return { error: 'Could not issue a discount number — try again' }
}
