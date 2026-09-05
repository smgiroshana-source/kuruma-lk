// ─────────────────────────────────────────────────────────────────────────────
// Transfer sell-through
//
// Sakura moves a part to WHEEL MART with a transfer cost. Nothing is booked at
// that moment — the part only changed shelves. When WHEEL MART sells it, Sakura
// has sold it too: to WHEEL MART, at the transfer cost, on that day. This
// module raises that sale in the SOURCE shop's books as an ordinary credit
// sale to the customer that stands for the receiving shop, and mirrors a void
// or return of the receiving shop's sale back onto it.
//
// Why a real sale row and not report arithmetic: the owner wants it on the
// daily report, on the period Sales Report, and (implicitly) on the
// customer's ledger and commission run. A row does all four for free and
// stays consistent under every filter; a computed overlay has to be re-done
// in each place and drifts.
//
// Rules:
//   - Only transfers with a transfer_cost take part. Blank cost = plain move.
//   - Units are drawn down oldest-accepted-transfer first, capped at what was
//     transferred (the receiving shop may have stocked the SKU already).
//   - The source shop's STOCK is never touched here. It left at transfer time.
//   - Dated the same instant as the receiving shop's sale, so it lands in the
//     same day's report on both sides. entered_at (DB-stamped) still records
//     when it was actually raised, so a backdated sale shows as retroactive.
//   - Best effort: a failure here must never fail the receiving shop's sale.
//     Callers wrap it and surface the warning.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'

type Admin = SupabaseClient<any, any, any>

export interface SellThroughResult {
  /** Source-shop sales raised, one per source vendor (normally one). */
  raised: { vendorName: string; invoiceNo: string; total: number }[]
  warning: string | null
}

/** Same series as the source shop's till receipts: SAK-00890 follows SAK-00889. */
async function nextInvoiceNo(admin: Admin, vendorId: string, vendorName: string): Promise<string> {
  const prefix = vendorName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')
  const { data: seq, error } = await admin.rpc('next_vendor_seq', { p_vendor_id: vendorId, p_series: 'regular' })
  if (error || seq == null) throw new Error(`invoice sequence unavailable: ${error?.message || 'no value'}`)
  return `${prefix}-${String(seq).padStart(5, '0')}`
}

/**
 * The customer row in the source shop's books that IS the receiving shop.
 * Sakura already bills "Macforce Auto Engineering" on credit; the migration
 * tied that row to the WHEEL MART vendor. If nothing is linked yet, create one
 * from the vendor's name and link it, so the ledger has a single home.
 */
async function customerForVendor(admin: Admin, sourceVendorId: string, destVendorId: string, destVendorName: string) {
  const { data: linked } = await admin.from('customers')
    .select('id, name, phone')
    .eq('vendor_id', sourceVendorId).eq('linked_vendor_id', destVendorId)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (linked) return linked
  const { data: created, error } = await admin.from('customers')
    .insert({ vendor_id: sourceVendorId, name: destVendorName, linked_vendor_id: destVendorId })
    .select('id, name, phone').single()
  if (error || !created) throw new Error(`could not create customer for ${destVendorName}: ${error?.message}`)
  return created
}

/** Draw `qty` units down from a transfer with an optimistic conditional update. */
async function claimUnits(admin: Admin, transferId: string, qty: number): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: t } = await admin.from('stock_transfers')
      .select('quantity, sold_through_quantity, status').eq('id', transferId).single()
    if (!t || t.status !== 'accepted') return 0
    const free = t.quantity - (t.sold_through_quantity || 0)
    const take = Math.min(free, qty)
    if (take <= 0) return 0
    const { data: ok } = await admin.from('stock_transfers')
      .update({ sold_through_quantity: (t.sold_through_quantity || 0) + take })
      .eq('id', transferId).eq('sold_through_quantity', t.sold_through_quantity || 0)
      .select('id')
    if (ok && ok.length > 0) return take
  }
  return 0
}

async function releaseUnits(admin: Admin, transferId: string, qty: number) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: t } = await admin.from('stock_transfers')
      .select('sold_through_quantity').eq('id', transferId).single()
    if (!t) return
    const cur = t.sold_through_quantity || 0
    const { data: ok } = await admin.from('stock_transfers')
      .update({ sold_through_quantity: Math.max(0, cur - qty) })
      .eq('id', transferId).eq('sold_through_quantity', cur)
      .select('id')
    if (ok && ok.length > 0) return
  }
}

/**
 * Called after a sale is finalised at the receiving shop (items inserted,
 * stock deducted). Raises the source shop's sale for any transferred units
 * among the items.
 */
export async function recordSellThrough(
  admin: Admin,
  destVendorId: string,
  destSale: { id: string; invoice_no: string; created_at: string | null },
  destItems: { id: string; product_id: string | null; quantity: number }[],
  callerUserId: string | null,
): Promise<SellThroughResult> {
  const result: SellThroughResult = { raised: [], warning: null }
  const productItems = destItems.filter(i => i.product_id && i.quantity > 0)
  if (productItems.length === 0) return result

  // Transfers that landed these products here, with a cost, and units left to bill
  const productIds = Array.from(new Set(productItems.map(i => i.product_id as string)))
  const { data: transfers } = await admin.from('stock_transfers')
    .select('id, from_vendor_id, from_product_id, from_product_sku, from_product_name, to_product_id, quantity, sold_through_quantity, transfer_cost, product_snapshot, accepted_at')
    .eq('to_vendor_id', destVendorId).eq('status', 'accepted')
    .in('to_product_id', productIds)
    .not('transfer_cost', 'is', null)
    .order('accepted_at', { ascending: true })
  const usable = (transfers || []).filter((t: any) => t.transfer_cost > 0 && (t.quantity - (t.sold_through_quantity || 0)) > 0)
  if (usable.length === 0) return result

  // Allocate each sold line across its transfers, oldest first
  type Line = { transfer: any; destItemId: string; qty: number }
  const lines: Line[] = []
  for (const item of productItems) {
    let need = item.quantity
    for (const t of usable) {
      if (need <= 0) break
      if (t.to_product_id !== item.product_id) continue
      const got = await claimUnits(admin, t.id, need)
      if (got > 0) { lines.push({ transfer: t, destItemId: item.id, qty: got }); need -= got }
    }
  }
  if (lines.length === 0) return result

  // Group by source vendor (normally one)
  const bySource = new Map<string, Line[]>()
  for (const l of lines) {
    const k = l.transfer.from_vendor_id
    if (!bySource.has(k)) bySource.set(k, [])
    bySource.get(k)!.push(l)
  }

  const { data: vendors } = await admin.from('vendors').select('id, name')
    .in('id', [destVendorId, ...Array.from(bySource.keys())])
  const nameOf = (id: string) => (vendors || []).find((v: any) => v.id === id)?.name || 'Shop'
  const destName = nameOf(destVendorId)

  for (const [sourceVendorId, srcLines] of Array.from(bySource.entries())) {
    try {
      const sourceName = nameOf(sourceVendorId)
      const customer = await customerForVendor(admin, sourceVendorId, destVendorId, destName)
      const invoiceNo = await nextInvoiceNo(admin, sourceVendorId, sourceName)
      const total = srcLines.reduce((s, l) => s + l.qty * l.transfer.transfer_cost, 0)

      // What the receiving shop already owes the source, for the ledger snapshot
      const { data: owed } = await admin.from('sales').select('balance_due')
        .eq('vendor_id', sourceVendorId).eq('customer_id', customer.id)
        .neq('payment_status', 'voided').gt('balance_due', 0)
      const totalAmountDue = (owed || []).reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0) + total

      const { data: sale, error: saleErr } = await admin.from('sales').insert({
        vendor_id: sourceVendorId, customer_id: customer.id,
        invoice_no: invoiceNo, customer_name: customer.name, customer_phone: customer.phone || null,
        subtotal: total, discount: 0, total,
        paid_amount: 0, balance_due: total, total_amount_due: totalAmountDue,
        payment_method: 'credit', payment_status: 'credit',
        notes: `Sold through ${destName} — their invoice ${destSale.invoice_no}. Transferred part billed at the transfer cost.`,
        created_at: destSale.created_at || new Date().toISOString(),
        created_by: callerUserId,
        sell_through_of_sale_id: destSale.id,
      }).select('id').single()
      if (saleErr || !sale) throw new Error(saleErr?.message || 'sale insert failed')

      // The source product may have been deleted since; the line still stands.
      const srcProductIds = Array.from(new Set(srcLines.map(l => l.transfer.from_product_id).filter(Boolean)))
      const { data: existing } = srcProductIds.length > 0
        ? await admin.from('products').select('id').in('id', srcProductIds)
        : { data: [] as any[] }
      const exists = new Set((existing || []).map((p: any) => p.id))

      const items = srcLines.map(l => {
        const snapCost = parseInt(l.transfer.product_snapshot?.cost || 0)
        return {
          sale_id: sale.id,
          product_id: exists.has(l.transfer.from_product_id) ? l.transfer.from_product_id : null,
          product_name: l.transfer.from_product_name,
          product_sku: l.transfer.from_product_sku || null,
          quantity: l.qty,
          unit_price: l.transfer.transfer_cost,
          // Sakura rarely carries a cost; when it does, the snapshot taken at
          // transfer time is the honest figure for margin on this line.
          unit_cost: snapCost > 0 ? snapCost : null,
          total: l.qty * l.transfer.transfer_cost,
          sscl_stream: 'PART',
          sell_through_transfer_id: l.transfer.id,
          sell_through_of_item_id: l.destItemId,
        }
      })
      const { error: itemsErr } = await admin.from('sale_items').insert(items)
      if (itemsErr) {
        await admin.from('sales').delete().eq('id', sale.id)
        throw new Error(itemsErr.message)
      }
      result.raised.push({ vendorName: sourceName, invoiceNo, total })
    } catch (e: any) {
      // Give the units back so a retry (or a later sale) can bill them.
      for (const l of srcLines) await releaseUnits(admin, l.transfer.id, l.qty)
      result.warning = `Could not raise the ${nameOf(sourceVendorId)} invoice for the transferred part: ${e?.message || e}`
      console.error('sell-through failed', destSale.id, e)
    }
  }
  return result
}

/**
 * The receiving shop voided its sale. Void the mirrored source sale(s): no
 * stock moves (none moved on the way in), the transfer units are freed, and
 * anything the receiving shop had already paid on it goes to their advance.
 */
export async function voidSellThrough(admin: Admin, destSaleId: string, callerUserId: string | null): Promise<string[]> {
  const { data: mirrors } = await admin.from('sales')
    .select('id, vendor_id, invoice_no, customer_id, paid_amount, notes, items:sale_items(id, quantity, returned_quantity, sell_through_transfer_id)')
    .eq('sell_through_of_sale_id', destSaleId).neq('payment_status', 'voided')
  const voided: string[] = []
  for (const m of (mirrors || [])) {
    const { data: claim } = await admin.from('sales').update({ payment_status: 'voided' })
      .eq('id', m.id).neq('payment_status', 'voided').select('id').maybeSingle()
    if (!claim) continue
    for (const it of (m.items || [])) {
      const live = it.quantity - (it.returned_quantity || 0)
      if (it.sell_through_transfer_id && live > 0) await releaseUnits(admin, it.sell_through_transfer_id, live)
    }
    const paid = parseFloat(m.paid_amount || 0)
    if (paid > 0 && m.customer_id) {
      const { data: c } = await admin.from('customers').select('advance_balance').eq('id', m.customer_id).single()
      if (c) await admin.from('customers').update({ advance_balance: parseFloat(c.advance_balance || 0) + paid }).eq('id', m.customer_id)
    }
    const at = new Date().toISOString()
    await admin.from('sales').update({
      payment_status: 'voided', voided_at: at, voided_by: callerUserId, balance_due: 0,
      notes: (m.notes || '') + '\nVOIDED: ' + at + ' | Their sale was voided' + (paid > 0 ? ' | Rs.' + paid.toLocaleString() + ' to advance' : ''),
    }).eq('id', m.id)
    voided.push(m.invoice_no)
  }
  return voided
}

/**
 * The receiving shop returned some units of its sale (till return or credit
 * note). Mirror the return onto the source sale line by line, at the transfer
 * cost, counted on the day it happens — the same period rule as every other
 * return. Units go back to the transfer so they can be billed again if resold.
 */
export async function returnSellThrough(
  admin: Admin,
  destSaleId: string,
  returned: { saleItemId: string; quantity: number }[],
  callerUserId: string | null,
): Promise<string[]> {
  if (returned.length === 0) return []
  const { data: mirrors } = await admin.from('sales')
    .select('id, vendor_id, invoice_no, customer_id, subtotal, total, paid_amount, balance_due, returned_amount, notes, items:sale_items(id, product_name, quantity, unit_price, returned_quantity, sell_through_transfer_id, sell_through_of_item_id)')
    .eq('sell_through_of_sale_id', destSaleId).neq('payment_status', 'voided')
  const touched: string[] = []
  for (const m of (mirrors || [])) {
    let refund = 0
    const details: string[] = []
    for (const r of returned) {
      const line = (m.items || []).find((i: any) => i.sell_through_of_item_id === r.saleItemId)
      if (!line) continue
      const prev = line.returned_quantity || 0
      const qty = Math.min(r.quantity, line.quantity - prev)
      if (qty <= 0) continue
      let claim = admin.from('sale_items').update({ returned_quantity: prev + qty }).eq('id', line.id)
      claim = line.returned_quantity == null ? claim.is('returned_quantity', null) : claim.eq('returned_quantity', line.returned_quantity)
      const { data: ok } = await claim.select('id')
      if (!ok || ok.length === 0) continue
      refund += qty * parseFloat(line.unit_price)
      details.push(line.product_name + ' x' + qty)
      if (line.sell_through_transfer_id) await releaseUnits(admin, line.sell_through_transfer_id, qty)
    }
    if (refund <= 0) continue

    const curPaid = parseFloat(m.paid_amount || 0), curBal = parseFloat(m.balance_due || 0)
    refund = Math.min(refund, curPaid + curBal)
    const balRed = Math.min(refund, curBal)
    const paidRed = Math.min(refund - balRed, curPaid)
    const newBal = Math.max(0, curBal - balRed), newPaid = Math.max(0, curPaid - paidRed)
    const at = new Date().toISOString()
    await admin.from('sales').update({
      paid_amount: newPaid, balance_due: newBal,
      returned_amount: Math.round(parseFloat(m.returned_amount || 0) + refund),
      payment_status: newBal > 0 ? 'partial' : 'paid',
      notes: (m.notes || '') + '\nRETURN: ' + at + ' | ' + details.join(', ') + ' | Rs.' + refund.toLocaleString() + ' | Returned at their shop',
    }).eq('id', m.id)
    if (paidRed > 0) {
      if (m.customer_id) {
        const { data: c } = await admin.from('customers').select('advance_balance').eq('id', m.customer_id).single()
        if (c) await admin.from('customers').update({ advance_balance: parseFloat(c.advance_balance || 0) + paidRed }).eq('id', m.customer_id)
      }
      await admin.from('payments').insert({
        created_by: callerUserId, sale_id: m.id, vendor_id: m.vendor_id, customer_id: m.customer_id,
        amount: -paidRed, payment_method: 'advance', notes: 'RETURN: ' + details.join(', '),
      })
    }
    if (balRed > 0) {
      await admin.from('payments').insert({
        created_by: callerUserId, sale_id: m.id, vendor_id: m.vendor_id, customer_id: m.customer_id,
        amount: -balRed, payment_method: 'credit_return', notes: 'RETURN (credit cancelled): ' + details.join(', '),
      })
    }
    touched.push(m.invoice_no)
  }
  return touched
}
