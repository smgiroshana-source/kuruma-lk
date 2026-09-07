// ─────────────────────────────────────────────────────────────────────────────
// Supplier prepayments
//
// A payment recorded with no invoice sits on the supplier's account
// (suppliers.advance_balance) and settles their next invoices. Two entry
// points create invoices — the payables screen and a posted GRN — and both
// must settle by the same rule, so the rule lives here and both call it.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

/** Move the supplier's unapplied prepayment by `delta`, never below zero. Optimistic; retries on a concurrent write. */
export async function bumpSupplierAdvance(admin: Admin, vendorId: string, supplierId: string, delta: number): Promise<number | null> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { data: s } = await admin.from('suppliers').select('advance_balance').eq('id', supplierId).eq('vendor_id', vendorId).single()
    if (!s) return null
    const cur = Number(s.advance_balance || 0)
    const next = cur + delta
    if (next < 0) return null
    const { data: ok } = await admin.from('suppliers').update({ advance_balance: next })
      .eq('id', supplierId).eq('vendor_id', vendorId).eq('advance_balance', cur).select('id')
    if (ok && ok.length > 0) return next
  }
  return null
}

/**
 * Settle as much of an invoice as the supplier's prepayment covers.
 * Returns the amount applied (0 when there is no prepayment or nothing owed).
 * No cash moves: the cash left when the prepayment was recorded.
 */
export async function applySupplierAdvance(admin: Admin, vendorId: string, invoiceId: string, userId: string | null): Promise<{ applied: number; remaining: number }> {
  const { data: inv } = await admin.from('supplier_invoices')
    .select('id, supplier_id, amount, amount_paid, credit_total, status')
    .eq('id', invoiceId).eq('vendor_id', vendorId).single()
  if (!inv) return { applied: 0, remaining: 0 }
  const owed = Number(inv.amount) - Number(inv.amount_paid || 0) - Number(inv.credit_total || 0)
  if (owed <= 0) return { applied: 0, remaining: 0 }

  const { data: sup } = await admin.from('suppliers').select('advance_balance').eq('id', inv.supplier_id).eq('vendor_id', vendorId).single()
  const credit = Number(sup?.advance_balance || 0)
  const applied = Math.min(credit, owed)
  if (applied <= 0) return { applied: 0, remaining: owed }

  // Take it off the account first; if that loses a race, apply nothing.
  const left = await bumpSupplierAdvance(admin, vendorId, inv.supplier_id, -applied)
  if (left == null) return { applied: 0, remaining: owed }

  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) // Colombo date
  const { error: payErr } = await admin.from('supplier_payments').insert({
    vendor_id: vendorId, supplier_id: inv.supplier_id, supplier_invoice_id: inv.id,
    amount: applied, payment_date: today, method: 'advance',
    notes: 'Settled from prepayment on account', created_by: userId,
  })
  if (payErr) {
    await bumpSupplierAdvance(admin, vendorId, inv.supplier_id, applied) // give it back
    return { applied: 0, remaining: owed }
  }
  const newPaid = Number(inv.amount_paid || 0) + applied
  const settled = newPaid + Number(inv.credit_total || 0)
  await admin.from('supplier_invoices')
    .update({ amount_paid: newPaid, status: settled >= Number(inv.amount) ? 'paid' : 'partial' })
    .eq('id', inv.id).eq('vendor_id', vendorId)
  return { applied, remaining: owed - applied }
}
