import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Where a customer's credit on account originally came from.
 *
 * A tax invoice should not show "ADVANCE" as a payment method (owner,
 * 2026-09-05): the money was cash or a bank transfer when it arrived, and the
 * invoice names that. The ledger still records the line as 'advance' so the
 * day's cash and bank totals are not counted twice; this only decides the
 * label, stored on the payment row as source_method at the moment the credit
 * is spent.
 *
 * Credit is created two ways, and we take whichever happened most recently:
 *   - a return refunded to advance: a negative 'advance' payment row on the
 *     returned sale — the source is how that sale was originally paid;
 *   - an overpayment: a sale whose cash/bank lines exceed its total — the
 *     source is the method of those lines.
 * Dominant method wins when a sale mixed several. Cash when nothing is found.
 */
export async function resolveAdvanceSource(admin: SupabaseClient<any, any, any>, vendorId: string, customerId: string): Promise<string> {
  const REAL = ['cash', 'bank', 'cheque', 'card']
  const dominant = (rows: any[]): string | null => {
    const sum: Record<string, number> = {}
    for (const p of rows) {
      const m = String(p.payment_method || '').toLowerCase()
      const a = parseFloat(p.amount || 0)
      if (!REAL.includes(m) || a <= 0) continue
      sum[m] = (sum[m] || 0) + a
    }
    const best = Object.entries(sum).sort((a, b) => b[1] - a[1])[0]
    return best ? best[0] : null
  }

  // (a) most recent refund-to-advance
  const { data: refund } = await admin.from('payments')
    .select('sale_id, created_at')
    .eq('vendor_id', vendorId).eq('customer_id', customerId)
    .eq('payment_method', 'advance').lt('amount', 0)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  let fromRefund: { at: string; method: string } | null = null
  if (refund?.sale_id) {
    const { data: orig } = await admin.from('payments').select('amount, payment_method').eq('sale_id', refund.sale_id)
    const m = dominant(orig || [])
    if (m) fromRefund = { at: refund.created_at, method: m }
  }

  // (b) most recent overpayment
  const { data: recent } = await admin.from('sales')
    .select('id, total, created_at, payments:payments(amount, payment_method)')
    .eq('vendor_id', vendorId).eq('customer_id', customerId)
    .neq('payment_status', 'voided')
    .order('created_at', { ascending: false }).limit(20)
  let fromOverpay: { at: string; method: string } | null = null
  for (const s of (recent || [])) {
    const real = (s.payments || []).filter((p: any) => REAL.includes(String(p.payment_method || '').toLowerCase()) && parseFloat(p.amount) > 0)
    const paid = real.reduce((t: number, p: any) => t + parseFloat(p.amount), 0)
    if (paid > parseFloat(s.total || 0)) {
      const m = dominant(real)
      if (m) { fromOverpay = { at: s.created_at, method: m }; break }
    }
  }

  if (fromRefund && fromOverpay) return fromRefund.at >= fromOverpay.at ? fromRefund.method : fromOverpay.method
  return fromRefund?.method || fromOverpay?.method || 'cash'
}
