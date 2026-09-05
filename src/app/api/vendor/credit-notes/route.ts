import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustProductQuantity } from '@/lib/stock'
import { lockedNowMessage } from '@/lib/taxRates'
import { returnSellThrough } from '@/lib/sellThrough'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return vendor
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
  return null
}

// ── POST — Issue a credit note ────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { saleId, returnedItems, reason, refundMethod } = await req.json()
  // returnedItems: [{ saleItemId: string, quantity: number }]
  // refundMethod: 'advance' | 'cash' | undefined

  if (!saleId || !Array.isArray(returnedItems) || returnedItems.length === 0)
    return NextResponse.json({ error: 'saleId and returnedItems required' }, { status: 400 })

  const admin = createAdminClient()

  // Fetch original sale + items
  const { data: sale } = await admin
    .from('sales')
    .select('*, items:sale_items(*)')
    .eq('id', saleId)
    .eq('vendor_id', vendor.id)
    .single()

  if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
  if (!sale.tax_serial) return NextResponse.json({ error: 'Credit notes only apply to tax invoices (gazette serial required)' }, { status: 400 })
  if (!sale.invoice_entity_id) return NextResponse.json({ error: 'Sale has no invoice entity' }, { status: 400 })

  // 6-month validity check (gazette requirement).
  // setMonth overflows short months (Aug 31 +6mo → Mar 3) — clamp to month end.
  const invoiceDate = new Date(sale.date_supply || sale.created_at)
  const sixMonthsLater = new Date(invoiceDate)
  const origDay = sixMonthsLater.getDate()
  sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6)
  if (sixMonthsLater.getDate() < origDay) sixMonthsLater.setDate(0)
  if (new Date() > sixMonthsLater)
    return NextResponse.json({ error: 'Credit notes must be issued within 6 months of the original invoice (' + invoiceDate.toLocaleDateString('en-LK') + ')' }, { status: 400 })

  // A locked (filed) period takes no new tax documents
  const lockMsg = await lockedNowMessage(admin, vendor.id)
  if (lockMsg) return NextResponse.json({ error: lockMsg }, { status: 400 })

  // Get VAT rate from tax_config
  const { data: vatRow } = await admin.from('tax_config').select('value').eq('vendor_id', vendor.id).eq('key', 'vat_rate').single()
  const vatRate = vatRow ? parseFloat(vatRow.value) : 18

  // Build credit note items — cap at available quantity.
  // If the original invoice had a discount, prorate it across lines so the
  // credit never exceeds what the customer actually paid for those items.
  const saleSubtotal = parseFloat(sale.subtotal || 0)
  const discountFactor = saleSubtotal > 0 ? parseFloat(sale.total || 0) / saleSubtotal : 1
  let totalAmount = 0
  const cnItems: any[] = []

  for (const ri of returnedItems) {
    const item = (sale.items || []).find((i: any) => i.id === ri.saleItemId)
    if (!item) continue
    const maxQty = item.quantity - (item.returned_quantity || 0)
    const qty = Math.min(Math.max(0, ri.quantity), maxQty)
    if (qty <= 0) continue
    const unitPrice = Math.round(parseFloat(item.unit_price || 0) * discountFactor)
    const lineTotal = qty * unitPrice
    totalAmount += lineTotal
    cnItems.push({
      original_item_id: item.id,
      product_name: item.product_name,
      quantity: qty,
      unit_price: unitPrice,
      total: lineTotal,
      sscl_stream: item.sscl_stream || 'PART',
    })
  }

  if (totalAmount === 0 || cnItems.length === 0)
    return NextResponse.json({ error: 'No returnable items selected' }, { status: 400 })

  const vatAmount = Math.round(totalAmount * vatRate / (100 + vatRate))
  const netAmount = totalAmount - vatAmount

  // Reserve next credit note number (reuse invoice_sequences with period = 'credit')
  const { data: seqNum, error: seqError } = await admin.rpc('next_invoice_serial', {
    p_entity_id: sale.invoice_entity_id,
    p_period: 'credit',
  })
  if (seqError || seqNum == null)
    return NextResponse.json({ error: 'Failed to generate credit note number: ' + seqError?.message }, { status: 500 })

  const creditNoteNo = `CRN-${String(seqNum).padStart(5, '0')}`

  // Create the credit note header
  const { data: cn, error: cnError } = await admin
    .from('credit_notes')
    .insert({
      vendor_id: vendor.id,
      invoice_entity_id: sale.invoice_entity_id,
      original_sale_id: sale.id,
      original_serial: sale.tax_serial,
      credit_note_no: creditNoteNo,
      reason: reason || 'goods_returned',
      customer_name: sale.customer_name || null,
      customer_address: sale.customer_address || null,
      customer_tin: sale.customer_tin || null,
      net_amount: netAmount,
      vat_amount: vatAmount,
      total: totalAmount,
    })
    .select()
    .single()

  if (cnError) return NextResponse.json({ error: cnError.message }, { status: 500 })

  // Create credit note line items
  const { error: itemsError } = await admin
    .from('credit_note_items')
    .insert(cnItems.map(i => ({ ...i, credit_note_id: cn.id })))

  if (itemsError) {
    // Remove the half-created header so reports never see a CRN with no lines.
    // (The reserved CRN number is lost — acceptable vs. a phantom VAT reduction.)
    await admin.from('credit_notes').delete().eq('id', cn.id)
    return NextResponse.json({ error: itemsError.message }, { status: 500 })
  }

  // ── Side effects: stock restoration, sale totals, refund payment ─────────────
  const returnedAt = new Date().toISOString()

  // 3. Restore stock + FIFO cost layers + update sale_items.returned_quantity
  const mirroredReturns: { saleItemId: string; quantity: number }[] = []
  for (const ri of returnedItems) {
    const item = (sale.items || []).find((i: any) => i.id === ri.saleItemId)
    if (!item) continue
    const maxQty = item.quantity - (item.returned_quantity || 0)
    const qty = Math.min(Math.max(0, ri.quantity), maxQty)
    if (qty <= 0) continue
    mirroredReturns.push({ saleItemId: item.id, quantity: qty })

    // Restore product stock
    if (item.product_id) {
      await adjustProductQuantity(admin, item.product_id, vendor.id, qty)
      // Restore FIFO cost layer
      if (parseInt(item.unit_cost || 0) > 0) {
        await admin.rpc('restore_fifo_cost', {
          p_vendor_id: vendor.id,
          p_product_id: item.product_id,
          p_quantity: qty,
          p_unit_cost: parseInt(item.unit_cost),
          p_received_at: returnedAt.slice(0, 10),
        })
      }
    }

    // Update sale_items.returned_quantity
    await admin.from('sale_items').update({
      returned_quantity: (item.returned_quantity || 0) + qty,
    }).eq('id', item.id)
  }

  // Transferred parts: the sending shop's mirrored sale takes the same return
  // (its own receipt, no credit note — that shop is not VAT-registered).
  try { await returnSellThrough(admin, sale.id, mirroredReturns, vendor.callerUserId || null) }
  catch (e) { console.error('sell-through (credit note) mirror failed', sale.id, e) }

  // 4. Check if all items fully returned
  const { data: updatedItems } = await admin.from('sale_items')
    .select('quantity, returned_quantity').eq('sale_id', sale.id)
  const allReturned = (updatedItems || []).every((i: any) => (i.returned_quantity || 0) >= i.quantity)

  // 5. Update original sale: returned_amount + balance/paid + voided_at
  const currentBalance = parseFloat(sale.balance_due || 0)
  const currentPaid    = parseFloat(sale.paid_amount || 0)
  const balanceReduction = Math.min(totalAmount, currentBalance)
  const paidReduction    = totalAmount - balanceReduction
  const newBalance = Math.max(0, currentBalance - balanceReduction)
  const newPaid    = Math.max(0, currentPaid - paidReduction)

  const salesUpdate: Record<string, any> = {
    returned_amount:  (parseFloat(sale.returned_amount || 0) + totalAmount),
    balance_due:      newBalance,
    paid_amount:      newPaid,
    payment_status:   allReturned ? 'voided' : newBalance > 0 ? 'partial' : 'paid',
    notes: (sale.notes || '') + '\nCRN: ' + creditNoteNo + ' | ' + returnedAt,
  }
  if (allReturned) salesUpdate.voided_at = returnedAt
  await admin.from('sales').update(salesUpdate).eq('id', sale.id)

  // 6. Record refund payment entries (for cash reconciliation visibility)
  if (paidReduction > 0) {
    // Paid portion: money must physically move back to customer
    if (refundMethod === 'advance' && sale.customer_id) {
      const { data: customer } = await admin.from('customers')
        .select('advance_balance').eq('id', sale.customer_id).eq('vendor_id', vendor.id).single()
      if (customer) {
        await admin.from('customers').update({
          advance_balance: parseFloat(customer.advance_balance || 0) + paidReduction,
        }).eq('id', sale.customer_id).eq('vendor_id', vendor.id)
      }
    }
    await admin.from('payments').insert({
      sale_id: sale.id, vendor_id: vendor.id,
      customer_id: sale.customer_id || null,
      amount: -paidReduction,
      payment_method: refundMethod === 'advance' ? 'advance' : 'cash',
      notes: 'CRN: ' + creditNoteNo,
    })
  }
  if (balanceReduction > 0) {
    // Credit portion: outstanding debt cancelled — no cash movement
    await admin.from('payments').insert({
      sale_id: sale.id, vendor_id: vendor.id,
      customer_id: sale.customer_id || null,
      amount: -balanceReduction,
      payment_method: 'credit_return',
      notes: 'CRN (credit cancelled): ' + creditNoteNo,
    })
  }

  return NextResponse.json({
    creditNote: { ...cn, items: cnItems },
    creditNoteNo,
    allReturned,
    refundAmount: totalAmount,
  })
}

// ── GET — List credit notes (for VAT register / reports) ─────────────────────
export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  const admin = createAdminClient()

  let query = admin
    .from('credit_notes')
    .select('*, items:credit_note_items(*), original_sale:sales!original_sale_id(date_supply, created_at)')
    .eq('vendor_id', vendor.id)
    .order('issued_at', { ascending: true })

  if (from) query = query.gte('issued_at', `${from}T00:00:00.000Z`)
  if (to)   query = query.lte('issued_at', `${to}T23:59:59.999Z`)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ creditNotes: data || [] })
}
