// ─────────────────────────────────────────────────────────────────────────────
// Paying supplier bills — WHEEL MART (owner, 2026-09-30)
//
// One payment can settle one or several of a supplier's bills, oldest first.
// With it can come a discount the supplier has CONFIRMED gets no credit note
// (recorded like the credit note form's "no credit note" tick), and, when a
// balance is still left, the reason: we'll pay it later, or the supplier is
// sending a credit note for it. The second marks the bill "credit note
// expected" — kept out of overdue and chased as "credit notes to come" until
// the note is entered — so a note due from a supplier is never forgotten
// (Prime Lanka PLTV 00097: Rs.4,832 left for a note to follow).
//
// Everything a payday writes is undone if any part fails: half a settlement is
// worse than none.
// ─────────────────────────────────────────────────────────────────────────────
import { recomputeSupplierInvoice } from '@/lib/supplierInvoice'
import { recordNoNoteDiscount } from '@/lib/supplierDiscount'
import { recomputeSessionForDate } from '@/lib/cash'

export type ShortReason = 'later' | 'credit_note'

export type PayBillsInput = {
  vendorId: string; userId: string | null; supplierId: string; invoiceIds: string[]
  amount: number; method: string; reference?: string | null; notes?: string | null; date: string
  discount?: number; discountConfirmed?: boolean; shortReason?: ShortReason
}

export type BillOutcome = { invoice_id: string; invoice_no: string; paid: number; discount: number; left: number; cn_expected: boolean }

const r0 = (n: any) => Math.round(Number(n) || 0)
const owedOf = (i: any) => Number(i.amount || 0) - Number(i.amount_paid || 0) - Number(i.credit_total || 0)

/** Mark (or clear) the balance on one bill as waiting for the supplier's credit note. */
export async function setCreditNoteExpected(admin: any, vendorId: string, invoiceId: string, on: boolean, userId: string | null, date: string) {
  const { data: inv } = await admin.from('supplier_invoices')
    .select('id, amount, amount_paid, credit_total').eq('id', invoiceId).eq('vendor_id', vendorId).single()
  if (!inv) return { error: 'Bill not found' }
  const owed = owedOf(inv)
  if (on && owed <= 0) return { error: 'Nothing is owed on this bill' }
  const { error } = await admin.from('supplier_invoices').update(on
    ? { cn_expected_amount: owed, cn_expected_since: date, cn_expected_by: userId }
    : { cn_expected_amount: null, cn_expected_since: null, cn_expected_by: null })
    .eq('id', invoiceId).eq('vendor_id', vendorId)
  if (error) return { error: error.message }
  await recomputeSupplierInvoice(admin, vendorId, invoiceId)
  return { ok: true, amount: on ? owed : 0 }
}

export async function payBills(admin: any, p: PayBillsInput): Promise<{ error?: string; status?: number; confirm_no?: string | null; confirm_kind?: string | null; bills?: BillOutcome[] }> {
  const amount = r0(p.amount), discount = r0(p.discount)
  if (!p.supplierId || !Array.isArray(p.invoiceIds) || p.invoiceIds.length === 0) return { error: 'Pick the bills you are settling', status: 400 }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''))) return { error: 'The payment date is required', status: 400 }
  if (amount < 0 || discount < 0) return { error: 'Amounts cannot be negative', status: 400 }
  if (amount === 0 && discount === 0) return { error: 'Enter the amount paid', status: 400 }
  if (discount > 0 && !p.discountConfirmed) {
    return { error: 'Only take a discount here when the supplier has confirmed no credit note will be issued. If a note is coming, choose "Supplier will send a credit note" instead.', status: 400 }
  }

  const { data: rows } = await admin.from('supplier_invoices')
    .select('id, supplier_id, invoice_no, invoice_date, due_date, amount, amount_paid, credit_total, status, cn_expected_amount')
    .eq('vendor_id', p.vendorId).in('id', p.invoiceIds)
  const bills = (rows || []).filter((i: any) => i.supplier_id === p.supplierId && i.status !== 'paid' && owedOf(i) > 0)
  if (bills.length !== new Set(p.invoiceIds).size) return { error: 'One of those bills is already settled or belongs to another supplier — reload and pick again', status: 409 }
  // A balance waiting on a credit note is not money to pay
  const waiting = bills.find((i: any) => Number(i.cn_expected_amount || 0) >= owedOf(i))
  if (waiting) return { error: `${waiting.invoice_no} is waiting for the supplier's credit note — enter the note when it arrives, or clear "credit note expected" on the bill first`, status: 400 }

  // Oldest first — the bill that has waited longest is paid first
  bills.sort((a: any, b: any) => String(a.invoice_date || a.due_date || '').localeCompare(String(b.invoice_date || b.due_date || '')))
  const total = bills.reduce((t: number, i: any) => t + owedOf(i) - Number(i.cn_expected_amount || 0), 0)
  if (amount + discount > total) return { error: `Payment ${amount.toLocaleString()} + discount ${discount.toLocaleString()} is more than the Rs.${total.toLocaleString()} owed on these bills`, status: 400 }

  const m = String(p.method || '').toLowerCase()
  const isCheque = m.includes('cheque')
  const isOnline = m === 'online' || m.includes('bank') || m === 'card'
  if (amount > 0 && isCheque && !String(p.reference || '').trim()) return { error: 'Cheque number is required for cheque payments', status: 400 }
  const methodCanon = isCheque ? 'cheque' : isOnline ? 'online' : 'cash'
  // One cheque or transfer settling several bills carries one control number
  const confirmNo = amount > 0 && (isCheque || isOnline) ? String(Math.floor(10000000 + Math.random() * 90000000)) : null

  // Walk the money, then the discount, oldest bill first
  let cash = amount, disc = discount
  type Step = { inv: any; pay: number; disc: number; left: number }
  const plan: Step[] = bills.map((i: any) => {
    const room = owedOf(i) - Number(i.cn_expected_amount || 0)
    const pay = Math.min(cash, room); cash -= pay
    const d = Math.min(disc, room - pay); disc -= d
    return { inv: i, pay, disc: d, left: owedOf(i) - pay - d }
  })

  const madePayments: string[] = [], madeNotes: string[] = [], paidBefore = new Map<string, number>()
  const undo = async () => {
    if (madePayments.length) await admin.from('supplier_payments').delete().in('id', madePayments).eq('vendor_id', p.vendorId)
    if (madeNotes.length) await admin.from('supplier_credit_notes').delete().in('id', madeNotes).eq('vendor_id', p.vendorId)
    for (const [id, paid] of paidBefore) {
      await admin.from('supplier_invoices').update({ amount_paid: paid }).eq('id', id).eq('vendor_id', p.vendorId)
      await recomputeSupplierInvoice(admin, p.vendorId, id)
    }
  }

  for (const s of plan) {
    if (s.pay > 0) {
      const { data: pay, error } = await admin.from('supplier_payments').insert({
        vendor_id: p.vendorId, supplier_id: p.supplierId, supplier_invoice_id: s.inv.id,
        amount: s.pay, payment_date: p.date, method: methodCanon,
        reference: String(p.reference || '').trim() || null,
        notes: [String(p.notes || '').trim(), plan.filter(x => x.pay > 0).length > 1 ? `One payment of Rs.${amount.toLocaleString()} across ${plan.filter(x => x.pay > 0).length} bills` : ''].filter(Boolean).join(' · ') || null,
        payment_confirm_no: confirmNo, created_by: p.userId,
      }).select('id').single()
      if (error || !pay) { await undo(); return { error: `Nothing saved — ${error?.message || 'the payment could not be recorded'}`, status: 500 } }
      madePayments.push(pay.id)
      paidBefore.set(s.inv.id, Number(s.inv.amount_paid || 0))
      const { error: upErr } = await admin.from('supplier_invoices')
        .update({ amount_paid: Number(s.inv.amount_paid || 0) + s.pay }).eq('id', s.inv.id).eq('vendor_id', p.vendorId)
      if (upErr) { await undo(); return { error: `Nothing saved — ${upErr.message}`, status: 500 } }
      await recomputeSupplierInvoice(admin, p.vendorId, s.inv.id)
    }
    if (s.disc > 0) {
      const d = await recordNoNoteDiscount(admin, {
        vendorId: p.vendorId, supplierId: p.supplierId, invoiceId: s.inv.id, amount: s.disc, date: p.date,
        userId: p.userId, invoiceNo: s.inv.invoice_no, invoiceDate: s.inv.invoice_date, remarks: p.notes,
      })
      if (d.error) { await undo(); return { error: `Nothing saved — the discount could not be recorded: ${d.error}`, status: 500 } }
      madeNotes.push(d.note.id)
    }
  }

  // What's still left: waiting on a credit note, or simply to pay later
  const outcome: BillOutcome[] = []
  for (const s of plan) {
    let cnMarked = Number(s.inv.cn_expected_amount || 0) > 0
    if (s.left > 0 && p.shortReason === 'credit_note' && (s.pay > 0 || s.disc > 0)) {
      const r = await setCreditNoteExpected(admin, p.vendorId, s.inv.id, true, p.userId, p.date)
      if ((r as any).error) { await undo(); return { error: `Nothing saved — ${(r as any).error}`, status: 500 } }
      cnMarked = true
    }
    outcome.push({ invoice_id: s.inv.id, invoice_no: s.inv.invoice_no, paid: s.pay, discount: s.disc, left: s.left, cn_expected: s.left > 0 && cnMarked })
  }

  // Cash left the drawer — that day's expected count must know
  if (amount > 0 && methodCanon === 'cash') await recomputeSessionForDate(admin, p.vendorId, p.date)
  return { confirm_no: confirmNo, confirm_kind: confirmNo ? (isCheque ? 'cheque' : 'online') : null, bills: outcome }
}
