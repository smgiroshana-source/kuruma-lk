// ── Supplier returns and VAT (accountant, 2026-11-04) ────────────────────────
// A VAT-registered supplier can issue a credit note only within 6 months of
// the invoice the goods came on. Past that — and for opening stock, which has
// no GRN — no note is possible and the return carries no VAT either side:
// our input VAT claim stands and the loss is ex-VAT cost − what they allowed
// (SR-2611-0001 Stevans, SR-2609-0001 Douglas).
import { colomboToday } from './dates'
//
// Within the window the supplier may send a note. Its total is VAT-inclusive,
// so the loss must compare the ex-VAT cost with the note's ex-VAT part — never
// with the total, which made a full-value VAT note read as "more than the
// goods cost you" and understated every partial loss by the VAT.

export const CREDIT_NOTE_MONTHS = 6

export type NoteWindow = {
  registered: boolean          // supplier is VAT-registered
  open: boolean                // a credit note is still possible for some line
  newestPurchase: string | null  // newest VAT invoice date for these goods from this supplier
  cutoff: string               // invoices on or after this date are inside the window
}

const monthsBefore = (ymd: string, months: number) => {
  const d = new Date(ymd.slice(0, 10) + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() - months)
  return d.toISOString().slice(0, 10)
}

// One read for many returns: the lines, the suppliers, and the GRN lines that
// brought those products in from that supplier with VAT on them.
export async function creditNoteWindows(admin: any, vendorId: string, rets: { id: string; supplier_id: string; return_date: string }[]): Promise<Record<string, NoteWindow>> {
  const out: Record<string, NoteWindow> = {}
  if (rets.length === 0) return out
  const retIds = rets.map(r => r.id)
  const supplierIds = [...new Set(rets.map(r => r.supplier_id).filter(Boolean))]

  const [{ data: items }, { data: sups }] = await Promise.all([
    admin.from('supplier_return_items').select('return_id, product_id').in('return_id', retIds),
    admin.from('suppliers').select('id, vat_registered').eq('vendor_id', vendorId).in('id', supplierIds),
  ])
  const productIds = [...new Set((items || []).map((i: any) => i.product_id).filter(Boolean))]
  const { data: grnLines } = productIds.length ? await admin.from('grn_items')
    .select('product_id, vat_amount, grn:grns!inner(vendor_id, supplier_id, status, received_at, supplier_invoice_date)')
    .in('product_id', productIds).eq('grn.vendor_id', vendorId).eq('grn.status', 'posted') : { data: [] }

  const registered = new Map((sups || []).map((s: any) => [s.id, !!s.vat_registered]))
  // newest VAT purchase per supplier+product
  const newest = new Map<string, string>()
  for (const g of (grnLines || []) as any[]) {
    if (!(Number(g.vat_amount) > 0)) continue
    const day = String(g.grn?.supplier_invoice_date || g.grn?.received_at || '').slice(0, 10)
    if (!day) continue
    const key = g.grn.supplier_id + '|' + g.product_id
    if (!newest.has(key) || day > newest.get(key)!) newest.set(key, day)
  }

  for (const r of rets) {
    const cutoff = monthsBefore(r.return_date, CREDIT_NOTE_MONTHS)
    let newestPurchase: string | null = null
    for (const i of (items || []) as any[]) {
      if (i.return_id !== r.id) continue
      const d = newest.get(r.supplier_id + '|' + i.product_id)
      if (d && (!newestPurchase || d > newestPurchase)) newestPurchase = d
    }
    const reg = registered.get(r.supplier_id) === true
    out[r.id] = { registered: reg, open: reg && !!newestPurchase && newestPurchase >= cutoff, newestPurchase, cutoff }
  }
  return out
}

// What the return lost: ex-VAT cost − the ex-VAT part of what was allowed.
// The VAT on a supplier's credit note only counts once the note is recorded.
export function returnLoss(ret: { cost_of_goods?: any; total_amount?: any; credit_amount?: any; credit_method?: any; credit_vat?: any; supplier_credit_note_no?: any }): number {
  const cost = Math.round(Number(ret.cost_of_goods ?? ret.total_amount) || 0)
  const allowed = ret.credit_method === 'none' ? 0 : Math.round(Number(ret.credit_amount) || 0)
  const vat = ret.supplier_credit_note_no && ret.credit_method !== 'none' ? Math.round(Number(ret.credit_vat) || 0) : 0
  return Math.max(0, cost - (allowed - vat))
}

// Keep the return's loss expense equal to returnLoss() — called whenever what
// was allowed, or the VAT credit note behind it, changes.
export async function syncReturnShortfall(admin: any, vendorId: string, returnId: string, userId: string, date?: string): Promise<{ error?: string; shortfall: number }> {
  const { data: ret } = await admin.from('supplier_returns')
    .select('id, return_no, reason, cost_of_goods, total_amount, credit_amount, credit_method, credit_vat, supplier_credit_note_no, credit_recorded_at, shortfall_expense_id')
    .eq('id', returnId).eq('vendor_id', vendorId).single()
  if (!ret || !ret.credit_recorded_at) return { shortfall: 0 }
  const shortfall = returnLoss(ret)

  if (ret.shortfall_expense_id) {
    if (shortfall > 0) {
      const { error } = await admin.from('expenses').update({ amount: shortfall }).eq('id', ret.shortfall_expense_id).eq('vendor_id', vendorId)
      if (error) return { error: error.message, shortfall }
    } else {
      await admin.from('expenses').delete().eq('id', ret.shortfall_expense_id).eq('vendor_id', vendorId)
      await admin.from('supplier_returns').update({ shortfall_expense_id: null }).eq('id', returnId).eq('vendor_id', vendorId)
    }
    return { shortfall }
  }
  if (shortfall > 0) {
    const { data: exp, error } = await admin.from('expenses').insert({
      vendor_id: vendorId, expense_date: date || colomboToday(), category: 'supplier_return_loss',
      description: `Not credited on returned goods — ${ret.return_no}${ret.reason ? ' (' + ret.reason + ')' : ''}`,
      amount: shortfall, payment_method: 'none', reference: ret.return_no, created_by: userId,
    }).select('id').single()
    if (error) return { error: error.message, shortfall }
    await admin.from('supplier_returns').update({ shortfall_expense_id: exp.id }).eq('id', returnId).eq('vendor_id', vendorId)
  }
  return { shortfall }
}
