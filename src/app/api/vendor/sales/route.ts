import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return vendor
  // Check if staff member
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
  return null
}

async function generateInvoiceNo(vendorId: string, vendorName: string) {
  const admin = createAdminClient()
  const prefix = vendorName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')

  // Get last invoice for this vendor to determine next number
  const { data: lastSale } = await admin
    .from('sales')
    .select('invoice_no')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  let nextNum = 1
  if (lastSale?.invoice_no) {
    // Extract number from last invoice (format: PREFIX-NNNNN)
    const match = lastSale.invoice_no.match(/-(\d+)$/)
    if (match) nextNum = parseInt(match[1]) + 1
  }

  return `${prefix}-${String(nextNum).padStart(5, '0')}`
}

export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || 'all'
  const saleId = url.searchParams.get('id')

  if (saleId) {
    const { data: sale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*), customer:customers(id, name, phone, whatsapp)')
      .eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ sale, vendor })
  }

  // Customer purchase history
  const customerId = url.searchParams.get('customer_id')
  if (customerId) {
    const { data: custSales } = await admin
      .from('sales')
      .select('*, items:sale_items(id, product_name, product_sku, quantity, unit_price, total, returned_quantity), payments:payments(id, amount, payment_method, cheque_number, created_at)')
      .eq('vendor_id', vendor.id)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(100)
    const { data: cust } = await admin.from('customers').select('*').eq('id', customerId).single()
    return NextResponse.json({ sales: custSales || [], customer: cust, vendor })
  }

  // Support explicit from/to date range
  const fromDate = url.searchParams.get('from')
  const toDate = url.searchParams.get('to')

  let dateFilter: string | null = null
  const now = new Date()
  if (!fromDate) {
    if (period === 'today') { dateFilter = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }
    else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); dateFilter = d.toISOString() }
    else if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); dateFilter = d.toISOString() }
  }

  let query = admin
    .from('sales')
    .select('*, items:sale_items(id, product_name, product_sku, quantity, unit_price, unit_cost, total), customer:customers(id, name, phone), payments:payments(id, amount, payment_method)')
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })

  if (fromDate) query = query.gte('created_at', new Date(fromDate).toISOString())
  if (toDate) { const end = new Date(toDate); end.setDate(end.getDate() + 1); query = query.lt('created_at', end.toISOString()) }
  if (!fromDate && dateFilter) query = query.gte('created_at', dateFilter)
  const { data: sales } = await query.limit(500)

  const allSales = sales || []
  const activeSales = allSales.filter((s: any) => s.payment_status !== 'voided')
  const totalRevenue = activeSales.reduce((sum: number, s: any) => sum + parseFloat(s.total || 0), 0)
  const totalPaid = activeSales.reduce((sum: number, s: any) => sum + parseFloat(s.paid_amount || 0), 0)
  const totalCredit = activeSales.reduce((sum: number, s: any) => sum + parseFloat(s.balance_due || 0), 0)
  const totalSales = activeSales.length
  const totalItems = activeSales.reduce((sum: number, s: any) => sum + (s.items?.reduce((is: number, i: any) => is + i.quantity, 0) || 0), 0)
  const totalDiscount = activeSales.reduce((sum: number, s: any) => sum + parseFloat(s.discount || 0), 0)

  // Top selling products
  const productMap: Record<string, { name: string; sku: string; qty: number; revenue: number }> = {}
  activeSales.forEach((s: any) => {
    (s.items || []).forEach((i: any) => {
      const key = i.product_sku || i.product_name
      if (!productMap[key]) productMap[key] = { name: i.product_name, sku: i.product_sku || '', qty: 0, revenue: 0 }
      productMap[key].qty += i.quantity
      productMap[key].revenue += parseFloat(i.total || 0)
    })
  })
  const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

  // Payment method breakdown
  const methodMap: Record<string, number> = {}
  activeSales.forEach((s: any) => {
    if (s.payments && s.payments.length > 0) {
      s.payments.forEach((p: any) => {
        const method = p.payment_method || 'cash'
        methodMap[method] = (methodMap[method] || 0) + parseFloat(p.amount || 0)
      })
    } else {
      const method = s.payment_method || 'cash'
      methodMap[method] = (methodMap[method] || 0) + parseFloat(s.paid_amount || 0)
    }
    if (parseFloat(s.balance_due || 0) > 0) {
      methodMap['credit'] = (methodMap['credit'] || 0) + parseFloat(s.balance_due || 0)
    }
  })
  const paymentBreakdown = Object.entries(methodMap).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount)

  // Daily revenue (for chart) — last 30 days
  const dailyMap: Record<string, { date: string; revenue: number; count: number; paid: number }> = {}
  activeSales.forEach((s: any) => {
    const d = new Date(s.created_at).toISOString().slice(0, 10)
    if (!dailyMap[d]) dailyMap[d] = { date: d, revenue: 0, count: 0, paid: 0 }
    dailyMap[d].revenue += parseFloat(s.total || 0)
    dailyMap[d].count += 1
    dailyMap[d].paid += parseFloat(s.paid_amount || 0)
  })
  const dailyRevenue = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)).slice(-30)

  // Top customers
  const customerMap: Record<string, { name: string; phone: string; id: string; spent: number; count: number }> = {}
  activeSales.forEach((s: any) => {
    const name = s.customer?.name || s.customer_name || 'Walk-in'
    const id = s.customer_id || 'walkin'
    if (!customerMap[id]) customerMap[id] = { name, phone: s.customer?.phone || s.customer_phone || '', id, spent: 0, count: 0 }
    customerMap[id].spent += parseFloat(s.total || 0)
    customerMap[id].count += 1
  })
  const topCustomers = Object.values(customerMap).sort((a, b) => b.spent - a.spent).slice(0, 10)

  return NextResponse.json({
    sales: allSales,
    stats: { totalRevenue, totalPaid, totalCredit, totalSales, totalItems, totalDiscount, avgSale: totalSales > 0 ? totalRevenue / totalSales : 0 },
    topProducts,
    paymentBreakdown,
    dailyRevenue,
    topCustomers,
    vendor,
  })
}

export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  if (action === 'create_sale') {
    const { customerId, customerName, customerPhone, items, discount, payments: paymentLines, notes, useAdvance, applyToOutstanding, saleDate } = body

    if (!items || items.length === 0) return NextResponse.json({ error: 'No items in sale' }, { status: 400 })

    // Auto-create customer if name provided but no ID
    let resolvedCustomerId = customerId || null
    if (!resolvedCustomerId && customerName?.trim()) {
      if (customerPhone?.trim()) {
        const { data: existing } = await admin.from('customers').select('id')
          .eq('vendor_id', vendor.id).eq('phone', customerPhone.trim()).single()
        if (existing) resolvedCustomerId = existing.id
      }
      if (!resolvedCustomerId) {
        const { data: newCust } = await admin.from('customers').insert({
          vendor_id: vendor.id, name: customerName.trim(),
          phone: customerPhone?.trim() || null, whatsapp: customerPhone?.trim() || null,
        }).select().single()
        if (newCust) resolvedCustomerId = newCust.id
      }
    }

    const invoiceNo = await generateInvoiceNo(vendor.id, vendor.name)
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.unitPrice), 0)
    const total = Math.max(0, subtotal - (discount || 0))

    // Step 1: How much cash/cheque/bank was paid
    const cashPaid = (paymentLines || []).reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0)

    // Step 2: Check customer advance balance
    let customerAdvance = 0
    if (resolvedCustomerId) {
      const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', resolvedCustomerId).single()
      customerAdvance = parseFloat(cust?.advance_balance || 0)
    }

    // Step 3: Apply advance to THIS bill if enabled
    let advanceUsedForBill = 0
    if (useAdvance && customerAdvance > 0) {
      advanceUsedForBill = Math.min(customerAdvance, Math.max(0, total - cashPaid))
    }

    // Step 4: Total applied to this bill
    const paidForThisBill = Math.min(total, cashPaid + advanceUsedForBill)
    const billBalance = Math.max(0, total - paidForThisBill)
    const excessPayment = Math.max(0, (cashPaid + advanceUsedForBill) - total)

    let paymentStatus = 'paid'
    if (billBalance > 0 && paidForThisBill > 0) paymentStatus = 'partial'
    else if (billBalance > 0 && paidForThisBill === 0) paymentStatus = 'credit'

    const primaryMethod = paymentLines && paymentLines.length > 0
      ? paymentLines.sort((a: any, b: any) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))[0].method || 'cash'
      : (advanceUsedForBill > 0 ? 'advance' : billBalance > 0 ? 'credit' : 'cash')

    // Create sale
    const saleRecord: any = {
      vendor_id: vendor.id, customer_id: resolvedCustomerId,
      invoice_no: invoiceNo, customer_name: customerName || 'Walk-in Customer',
      customer_phone: customerPhone || null, subtotal, discount: discount || 0,
      total, paid_amount: paidForThisBill, balance_due: billBalance,
      payment_method: primaryMethod, payment_status: paymentStatus, notes: notes || null,
    }
    if (saleDate) saleRecord.created_at = new Date(saleDate).toISOString()

    const { data: sale, error: saleError } = await admin.from('sales').insert(saleRecord).select().single()

    if (saleError) return NextResponse.json({ error: saleError.message }, { status: 400 })

    // Create sale items
    const saleItems = items.map((item: any) => ({
      sale_id: sale.id, product_id: item.productId, product_name: item.productName,
      product_sku: item.productSku || null, quantity: item.quantity,
      unit_price: item.unitPrice, unit_cost: item.unitCost || null,
      total: item.quantity * item.unitPrice,
    }))
    const { error: itemsError } = await admin.from('sale_items').insert(saleItems)
    if (itemsError) { await admin.from('sales').delete().eq('id', sale.id); return NextResponse.json({ error: itemsError.message }, { status: 400 }) }

    // Record cash/cheque/bank payment lines
    if (paymentLines && paymentLines.length > 0) {
      for (const pl of paymentLines) {
        if (parseFloat(pl.amount) > 0) {
          await admin.from('payments').insert({
            sale_id: sale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
            amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
            cheque_number: pl.chequeNumber || null, cheque_date: pl.chequeDate || null,
            bank_ref: pl.bankRef || null, notes: pl.notes || null,
          })
        }
      }
    }

    // Record advance usage
    if (advanceUsedForBill > 0) {
      await admin.from('payments').insert({
        sale_id: sale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
        amount: advanceUsedForBill, payment_method: 'advance',
        notes: 'Used from advance balance',
      })
    }

    // Step 5: If there's excess payment AND outstanding invoices, apply to oldest first
    let excessAppliedToOutstanding = 0
    const settledInvoices: string[] = []
    if (excessPayment > 0 && resolvedCustomerId && applyToOutstanding !== false) {
      const { data: outstandingSales } = await admin
        .from('sales')
        .select('id, invoice_no, total, paid_amount, balance_due')
        .eq('vendor_id', vendor.id)
        .eq('customer_id', resolvedCustomerId)
        .gt('balance_due', 0)
        .neq('payment_status', 'voided')
        .neq('id', sale.id)
        .order('created_at', { ascending: true })

      let remaining = excessPayment
      for (const oldSale of (outstandingSales || [])) {
        if (remaining <= 0) break
        const oldBalance = parseFloat(oldSale.balance_due)
        const applyAmount = Math.min(remaining, oldBalance)

        await admin.from('payments').insert({
          sale_id: oldSale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
          amount: applyAmount, payment_method: 'settlement',
          notes: `Auto-applied from invoice ${invoiceNo}`,
        })

        const newOldPaid = parseFloat(oldSale.paid_amount) + applyAmount
        const newOldBalance = Math.max(0, oldBalance - applyAmount)
        await admin.from('sales').update({
          paid_amount: newOldPaid, balance_due: newOldBalance,
          payment_status: newOldBalance <= 0 ? 'paid' : 'partial',
        }).eq('id', oldSale.id)

        excessAppliedToOutstanding += applyAmount
        remaining -= applyAmount
        if (newOldBalance <= 0) settledInvoices.push(oldSale.invoice_no)
      }

      // Whatever is still remaining goes to advance
      if (remaining > 0 && resolvedCustomerId) {
        const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill) + remaining
        await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId)
      } else {
        // Just deduct what was used
        const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill)
        if (resolvedCustomerId) await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId)
      }
    } else {
      // No outstanding or not applying - excess goes straight to advance
      let newAdvance = Math.max(0, customerAdvance - advanceUsedForBill)
      if (excessPayment > 0) newAdvance += excessPayment
      if (resolvedCustomerId) await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId)
    }

    // Step 6: Auto-deduct stock (vendor_id guard prevents cross-vendor tampering)
    for (const item of items) {
      if (item.productId) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.productId).eq('vendor_id', vendor.id).single()
        if (product) { await admin.from('products').update({ quantity: Math.max(0, product.quantity - item.quantity) }).eq('id', item.productId).eq('vendor_id', vendor.id) }
      }
    }

    // Fetch complete sale
    const { data: completeSale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('id', sale.id).single()

    // Build message
    let msg = `Invoice ${invoiceNo}`
    if (paymentStatus === 'paid') msg += ' — Paid'
    else if (paymentStatus === 'partial') msg += ` — Rs.${billBalance.toLocaleString()} on credit`
    else msg += ` — Full credit Rs.${total.toLocaleString()}`
    if (advanceUsedForBill > 0) msg += ` | Rs.${advanceUsedForBill.toLocaleString()} from advance`
    if (excessAppliedToOutstanding > 0) msg += ` | Rs.${excessAppliedToOutstanding.toLocaleString()} applied to old invoices`
    if (settledInvoices.length > 0) msg += ` (cleared: ${settledInvoices.join(', ')})`
    const finalAdvance = excessPayment > excessAppliedToOutstanding ? excessPayment - excessAppliedToOutstanding : 0
    if (finalAdvance > 0) msg += ` | Rs.${finalAdvance.toLocaleString()} to advance`

    return NextResponse.json({
      success: true, sale: completeSale,
      advanceUsed: advanceUsedForBill,
      appliedToOutstanding: excessAppliedToOutstanding,
      settledInvoices,
      newAdvance: finalAdvance,
      message: msg,
    })
  }

  if (action === 'void_sale') {
    const { saleId, refundMethod } = body
    // refundMethod: 'advance' (credit to customer) | 'cash' (cash back, just record it)
    const { data: sale } = await admin.from('sales').select('*, items:sale_items(*), payments:payments(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (sale.payment_status === 'voided') return NextResponse.json({ error: 'Already voided' }, { status: 400 })

    // 1. Restore stock for each item
    for (const item of (sale.items || [])) {
      if (item.product_id) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
        if (product) await admin.from('products').update({ quantity: product.quantity + item.quantity }).eq('id', item.product_id)
      }
    }

    // 2. Calculate what was paid
    const payments = sale.payments || []
    const cashPaid = payments.filter((p: any) => ['cash','cheque','bank','card'].includes(p.payment_method)).reduce((s: number, p: any) => s + parseFloat(p.amount || 0), 0)
    const advanceUsed = payments.filter((p: any) => p.payment_method === 'advance').reduce((s: number, p: any) => s + parseFloat(p.amount || 0), 0)
    const balanceDue = parseFloat(sale.balance_due || 0)

    // 3. Handle customer balance adjustments
    if (sale.customer_id) {
      const { data: customer } = await admin.from('customers').select('advance_balance').eq('id', sale.customer_id).single()
      if (customer) {
        let newAdvance = parseFloat(customer.advance_balance || 0)

        // Restore advance that was used for this sale
        if (advanceUsed > 0) newAdvance += advanceUsed

        // If cash was paid, either refund to advance or just record cash back
        if (cashPaid > 0 && refundMethod === 'advance') {
          newAdvance += cashPaid
        }

        await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', sale.customer_id)

        // If sale had outstanding balance (credit), reduce it — already handled by voiding the sale
      }
    }

    // 4. Reverse any auto-settlements that were applied FROM this sale to older invoices
    const autoSettledPayments = payments.filter((p: any) => p.payment_method === 'settlement' && p.sale_id !== sale.id)
    // These live on the OLD sales, not this one — find them by notes referencing our invoice
    const { data: settlementPayments } = await admin
      .from('payments')
      .select('id, sale_id, amount')
      .eq('vendor_id', vendor.id)
      .eq('payment_method', 'settlement')
      .ilike('notes', `%from invoice ${sale.invoice_no}%`)
    if (settlementPayments && settlementPayments.length > 0) {
      for (const sp of settlementPayments) {
        // Reverse the balance on the old sale
        const { data: oldSale } = await admin.from('sales').select('paid_amount, balance_due, total').eq('id', sp.sale_id).single()
        if (oldSale) {
          const restoredBalance = parseFloat(oldSale.balance_due) + parseFloat(sp.amount)
          const restoredPaid = Math.max(0, parseFloat(oldSale.paid_amount) - parseFloat(sp.amount))
          await admin.from('sales').update({
            paid_amount: restoredPaid,
            balance_due: restoredBalance,
            payment_status: restoredBalance > 0 ? (restoredPaid > 0 ? 'partial' : 'credit') : 'paid',
          }).eq('id', sp.sale_id)
        }
        // Delete the settlement payment record
        await admin.from('payments').delete().eq('id', sp.id)
      }
    }

    // 5. Mark sale as voided
    await admin.from('sales').update({
      payment_status: 'voided',
      balance_due: 0,
      notes: (sale.notes || '') + '\nVOIDED: ' + new Date().toISOString() + (refundMethod === 'advance' ? ' | Refund to advance' : ' | Cash refund')
    }).eq('id', saleId)

    const messages = ['Sale voided, stock restored']
    if (advanceUsed > 0) messages.push(`Rs.${advanceUsed.toLocaleString()} advance restored`)
    if (cashPaid > 0 && refundMethod === 'advance') messages.push(`Rs.${cashPaid.toLocaleString()} added to advance`)
    if (cashPaid > 0 && refundMethod !== 'advance') messages.push(`Rs.${cashPaid.toLocaleString()} cash to refund`)
    if (balanceDue > 0) messages.push(`Rs.${balanceDue.toLocaleString()} outstanding cleared`)

    return NextResponse.json({ success: true, message: messages.join('. '), advanceRestored: advanceUsed, cashRefund: refundMethod !== 'advance' ? cashPaid : 0, creditedToAdvance: (refundMethod === 'advance' ? cashPaid : 0) + advanceUsed })
  }

  // ─── RETURN ITEMS (partial or full) ───
  if (action === 'return_items') {
    const { saleId, returnItems, refundMethod } = body
    // returnItems: [{ saleItemId, quantity }]
    // refundMethod: 'advance' | 'cash'
    if (!saleId || !returnItems || !Array.isArray(returnItems) || returnItems.length === 0)
      return NextResponse.json({ error: 'No items to return' }, { status: 400 })

    const { data: sale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    if (sale.payment_status === 'voided') return NextResponse.json({ error: 'Sale is already voided' }, { status: 400 })

    let totalRefund = 0
    const returnedDetails: string[] = []

    // 1. Process each return item
    for (const ri of returnItems) {
      const saleItem = (sale.items || []).find((si: any) => si.id === ri.saleItemId)
      if (!saleItem) continue
      const returnQty = Math.min(ri.quantity, saleItem.quantity - (saleItem.returned_quantity || 0))
      if (returnQty <= 0) continue

      const refundAmount = returnQty * parseFloat(saleItem.unit_price)
      totalRefund += refundAmount

      // Restore stock
      if (saleItem.product_id) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', saleItem.product_id).single()
        if (product) await admin.from('products').update({ quantity: product.quantity + returnQty }).eq('id', saleItem.product_id)
      }

      // Update sale item returned quantity
      await admin.from('sale_items').update({
        returned_quantity: (saleItem.returned_quantity || 0) + returnQty
      }).eq('id', saleItem.id)

      returnedDetails.push(saleItem.product_name + ' x' + returnQty)
    }

    if (totalRefund <= 0)
      return NextResponse.json({ error: 'Nothing to return' }, { status: 400 })

    // 2. Update sale totals
    const currentPaid = parseFloat(sale.paid_amount || 0)
    const currentTotal = parseFloat(sale.total)
    const currentBalance = parseFloat(sale.balance_due || 0)
    const newTotal = Math.max(0, currentTotal - totalRefund)
    const newSubtotal = Math.max(0, parseFloat(sale.subtotal) - totalRefund)
    // Refund reduces balance first (credit), then paid_amount (cash already received)
    const balanceReduction = Math.min(totalRefund, currentBalance)
    const paidReduction = totalRefund - balanceReduction
    const newBalanceDue = Math.max(0, currentBalance - balanceReduction)
    const newPaidAmount = Math.max(0, currentPaid - paidReduction)

    // Check if all items fully returned
    const { data: updatedItems } = await admin.from('sale_items').select('quantity, returned_quantity').eq('sale_id', saleId)
    const allReturned = (updatedItems || []).every((i: any) => (i.returned_quantity || 0) >= i.quantity)

    await admin.from('sales').update({
      total: newTotal,
      subtotal: newSubtotal,
      paid_amount: newPaidAmount,
      balance_due: newBalanceDue,
      payment_status: allReturned ? 'voided' : newBalanceDue > 0 ? 'partial' : 'paid',
      notes: (sale.notes || '') + '\nRETURN: ' + new Date().toISOString() + ' | ' + returnedDetails.join(', ') + ' | Rs.' + totalRefund.toLocaleString() + (refundMethod === 'advance' ? ' to advance' : ' cash refund')
    }).eq('id', saleId)

    // 3. Handle refund to customer
    if (sale.customer_id && totalRefund > 0) {
      if (refundMethod === 'advance') {
        const { data: customer } = await admin.from('customers').select('advance_balance').eq('id', sale.customer_id).single()
        if (customer) {
          // Only add the portion that was actually paid (not the portion that just cancels outstanding debt)
          await admin.from('customers').update({
            advance_balance: parseFloat(customer.advance_balance || 0) + paidReduction
          }).eq('id', sale.customer_id)
        }
      }
      // Record refund payment (only the cash portion that actually needs to be returned)
      if (paidReduction > 0) {
        await admin.from('payments').insert({
          sale_id: saleId, vendor_id: vendor.id,
          amount: -paidReduction,
          payment_method: refundMethod === 'advance' ? 'advance' : 'cash',
          notes: 'RETURN: ' + returnedDetails.join(', ')
        })
      }
    }

    return NextResponse.json({
      success: true,
      refundAmount: totalRefund,
      cashRefund: paidReduction,
      allReturned,
      message: 'Returned: ' + returnedDetails.join(', ') + '. Total value: Rs.' + totalRefund.toLocaleString() + (paidReduction > 0 ? (refundMethod === 'advance' ? ` | Rs.${paidReduction.toLocaleString()} added to advance` : ` | Rs.${paidReduction.toLocaleString()} cash back`) : '')
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
