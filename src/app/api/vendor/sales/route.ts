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

  // Find the highest invoice number across ALL sales for this vendor
  const { data: allSales } = await admin
    .from('sales')
    .select('invoice_no')
    .eq('vendor_id', vendorId)

  let maxNum = 0
  if (allSales) {
    for (const sale of allSales) {
      const match = (sale.invoice_no || '').match(/-(\d+)$/)
      if (match) {
        const num = parseInt(match[1])
        if (num > maxNum) maxNum = num
      }
    }
  }

  return `${prefix}-${String(maxNum + 1).padStart(5, '0')}`
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
  const activeSales = allSales.filter((s: any) => s.payment_status !== 'voided' && s.payment_status !== 'draft')
  // Exclude opening balance entries from sales stats (they're past transaction records, not actual sales)
  const isOpeningBalance = (s: any) => (s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')
  const realSales = activeSales.filter((s: any) => !isOpeningBalance(s))
  const totalRevenue = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.total || 0), 0)
  const totalPaid = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.paid_amount || 0), 0)
  const totalCredit = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.balance_due || 0), 0)
  const totalSales = realSales.length
  const totalItems = realSales.reduce((sum: number, s: any) => sum + (s.items?.reduce((is: number, i: any) => is + i.quantity, 0) || 0), 0)
  const totalDiscount = realSales.reduce((sum: number, s: any) => sum + parseFloat(s.discount || 0), 0)

  // Top selling products
  const productMap: Record<string, { name: string; sku: string; qty: number; revenue: number }> = {}
  realSales.forEach((s: any) => {
    (s.items || []).forEach((i: any) => {
      if (i.product_sku === 'OPENING-BAL') return
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

  // Fetch credit collections received in this period (payments on older invoices)
  let collectionsToday: any[] = []
  const periodStart = fromDate ? new Date(fromDate).toISOString() : dateFilter
  const periodEnd = toDate ? (() => { const e = new Date(toDate); e.setDate(e.getDate() + 1); return e.toISOString() })() : null
  if (periodStart) {
    // Get ALL payments made in this period (on any invoice, including older ones)
    let pQuery = admin
      .from('payments')
      .select('id, amount, payment_method, cheque_number, created_at, sale_id, sales!inner(id, invoice_no, customer_name, customer_id, vendor_id, created_at, customer:customers(name, phone), items:sale_items(product_sku))')
      .eq('sales.vendor_id', vendor.id)
      .gte('created_at', periodStart)
    if (periodEnd) pQuery = pQuery.lt('created_at', periodEnd)
    const { data: periodPayments } = await pQuery.limit(500)
    // Filter to: payments on older invoices (credit collections) OR payments on Opening Balance invoices
    collectionsToday = (periodPayments || []).filter((p: any) => {
      const saleDate = p.sales?.created_at
      if (!saleDate) return false
      // Check if this is an Opening Balance invoice
      const isOpeningBalance = (p.sales?.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')
      if (isOpeningBalance) return true // Opening balance payments always count as collections
      if (saleDate < periodStart) return true // Payment on older sale
      return false
    }).map((p: any) => ({
      id: p.id,
      amount: parseFloat(p.amount || 0),
      payment_method: p.payment_method,
      cheque_number: p.cheque_number,
      created_at: p.created_at,
      sale_id: p.sale_id,
      invoice_no: p.sales?.invoice_no,
      customer_name: p.sales?.customer?.name || p.sales?.customer_name || 'Unknown',
    }))
  }
  // Separate positive collections from negative (returns/refunds)
  const positiveCollections = collectionsToday.filter((c: any) => c.amount > 0)
  const returnsInPeriod = collectionsToday.filter((c: any) => c.amount < 0).map((c: any) => ({ ...c, amount: Math.abs(c.amount) }))
  const totalCollections = positiveCollections.reduce((s: number, c: any) => s + c.amount, 0)
  const totalReturns = returnsInPeriod.reduce((s: number, c: any) => s + c.amount, 0)

  // Also check for returns made in this period on same-period invoices (not just older ones)
  // These show up as negative payments on same-day sales
  if (periodStart) {
    let rQuery = admin
      .from('payments')
      .select('id, amount, payment_method, notes, created_at, sale_id, sales!inner(id, invoice_no, customer_name, vendor_id, customer:customers(name))')
      .eq('sales.vendor_id', vendor.id)
      .lt('amount', 0)
      .gte('created_at', periodStart)
    if (periodEnd) rQuery = rQuery.lt('created_at', periodEnd)
    const { data: returnPayments } = await rQuery.limit(200)
    const existingIds = new Set(returnsInPeriod.map((r: any) => r.id))
    ;(returnPayments || []).filter((p: any) => !existingIds.has(p.id)).forEach((p: any) => {
      returnsInPeriod.push({
        id: p.id, amount: Math.abs(parseFloat(p.amount || 0)),
        payment_method: p.payment_method, created_at: p.created_at, sale_id: p.sale_id,
        invoice_no: p.sales?.invoice_no, customer_name: p.sales?.customer?.name || p.sales?.customer_name || 'Unknown',
        notes: p.notes || '',
      })
    })
  }
  const totalReturnsAll = returnsInPeriod.reduce((s: number, c: any) => s + c.amount, 0)

  return NextResponse.json({
    sales: allSales,
    stats: { totalRevenue, totalPaid, totalCredit, totalSales, totalItems, totalDiscount, avgSale: totalSales > 0 ? totalRevenue / totalSales : 0, totalCollections, totalReturns: totalReturnsAll },
    collectionsToday: positiveCollections,
    returnsInPeriod,
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
    const { customerId, customerName, customerPhone, items, discount, payments: paymentLines, notes, useAdvance, applyToOutstanding, saleDate, vehicleNo } = body

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
      payment_method: primaryMethod, payment_status: paymentStatus,
      notes: notes || null,
      vehicle_no: vehicleNo || null,
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

    // Calculate total amount due across ALL invoices for this customer and save to DB
    let totalAmountDue = 0
    if (customerId) {
      const { data: allCustomerSales } = await admin
        .from('sales')
        .select('balance_due')
        .eq('vendor_id', vendor.id)
        .eq('customer_id', customerId)
        .neq('payment_status', 'voided')
        .gt('balance_due', 0)
      totalAmountDue = (allCustomerSales || []).reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0)
      // Save snapshot to the sale record
      await admin.from('sales').update({ total_amount_due: totalAmountDue }).eq('id', sale.id)
    }

    // Re-fetch with updated total_amount_due
    const { data: finalSale } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('id', sale.id).single()

    return NextResponse.json({
      success: true, sale: finalSale || completeSale,
      advanceUsed: advanceUsedForBill,
      appliedToOutstanding: excessAppliedToOutstanding,
      settledInvoices,
      newAdvance: finalAdvance,
      totalAmountDue,
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
      // Record refund payments for ALL portions
      // Cash/advance portion (money that needs to move back)
      if (paidReduction > 0) {
        await admin.from('payments').insert({
          sale_id: saleId, vendor_id: vendor.id,
          amount: -paidReduction,
          payment_method: refundMethod === 'advance' ? 'advance' : 'cash',
          notes: 'RETURN: ' + returnedDetails.join(', ')
        })
      }
      // Credit portion (balance that was owed but now cancelled — no money moves)
      if (balanceReduction > 0) {
        await admin.from('payments').insert({
          sale_id: saleId, vendor_id: vendor.id,
          amount: -balanceReduction,
          payment_method: 'credit_return',
          notes: 'RETURN (credit cancelled): ' + returnedDetails.join(', ')
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

  if (action === 'create_draft') {
    const { customerId, customerName, customerPhone, items, notes, vehicleNo } = body
    if (!items || items.length === 0) return NextResponse.json({ error: 'No items' }, { status: 400 })

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

    // No invoice number assigned yet — it will be assigned when the draft is finalised.
    // Using null preserves the invoice number sequence (no gaps from returned drafts).
    const subtotal = items.reduce((s: number, i: any) => s + (i.quantity * (i.unitPrice || 0)), 0)

    const { data: draft, error } = await admin.from('sales').insert({
      vendor_id: vendor.id, customer_id: resolvedCustomerId,
      invoice_no: null, customer_name: customerName || 'Walk-in Customer',
      customer_phone: customerPhone || null, subtotal, discount: 0,
      total: subtotal, paid_amount: 0, balance_due: 0,
      payment_method: 'cash', payment_status: 'draft',
      vehicle_no: vehicleNo || null,
      notes: notes ? ('ON APPROVAL\n' + notes) : 'ON APPROVAL',
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const saleItems = items.map((item: any) => ({
      sale_id: draft.id, product_id: item.productId,
      product_name: item.productName, product_sku: item.productSku || null,
      quantity: item.quantity, unit_price: item.unitPrice || 0,
      unit_cost: item.unitCost || null, total: item.quantity * (item.unitPrice || 0),
    }))
    await admin.from('sale_items').insert(saleItems)

    // Reduce stock — items are physically leaving the shop
    for (const item of items) {
      if (item.productId) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.productId).eq('vendor_id', vendor.id).single()
        if (product) await admin.from('products').update({ quantity: Math.max(0, product.quantity - item.quantity) }).eq('id', item.productId).eq('vendor_id', vendor.id)
      }
    }

    return NextResponse.json({ success: true, draft, message: 'On Approval draft created — stock reserved' })
  }

  if (action === 'return_draft_item') {
    // Return a single item from a draft (on-approval) — restore its stock and remove it.
    // If it was the last item, void the entire draft.
    const { saleId, saleItemId } = body
    const { data: draft } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.payment_status !== 'draft') return NextResponse.json({ error: 'Not a draft' }, { status: 400 })

    const item = (draft.items || []).find((i: any) => i.id === saleItemId)
    if (!item) return NextResponse.json({ error: 'Item not found in draft' }, { status: 404 })

    // Restore stock for this item
    if (item.product_id) {
      const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
      if (product) await admin.from('products').update({ quantity: product.quantity + item.quantity }).eq('id', item.product_id)
    }

    // Remove this item from the draft
    await admin.from('sale_items').delete().eq('id', saleItemId)

    // Check if any items remain
    const remainingItems = (draft.items || []).filter((i: any) => i.id !== saleItemId)
    if (remainingItems.length === 0) {
      // Last item — delete the draft entirely (no invoice was ever assigned, nothing to keep)
      await admin.from('sales').delete().eq('id', saleId)
      return NextResponse.json({ success: true, voided: true, message: item.product_name + ' returned — draft deleted (no items left)' })
    } else {
      // Update draft totals
      const newSubtotal = remainingItems.reduce((s: number, i: any) => s + parseFloat(i.total || 0), 0)
      await admin.from('sales').update({
        subtotal: newSubtotal, total: newSubtotal,
        notes: (draft.notes || '') + '\nITEM RETURNED: ' + item.product_name + ' ×' + item.quantity,
      }).eq('id', saleId)
      return NextResponse.json({ success: true, voided: false, message: item.product_name + ' ×' + item.quantity + ' returned — stock restored' })
    }
  }

  if (action === 'return_draft') {
    const { saleId } = body
    const { data: draft } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.payment_status !== 'draft') return NextResponse.json({ error: 'Not a draft' }, { status: 400 })

    // Restore stock for all items
    for (const item of (draft.items || [])) {
      if (item.product_id) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
        if (product) await admin.from('products').update({ quantity: product.quantity + item.quantity }).eq('id', item.product_id)
      }
    }

    // Delete the draft entirely — no invoice was ever assigned so nothing to archive
    await admin.from('sale_items').delete().eq('sale_id', saleId)
    await admin.from('sales').delete().eq('id', saleId)

    return NextResponse.json({ success: true, message: 'All items returned — draft deleted' })
  }

  if (action === 'cleanup_void_drafts') {
    // One-time cleanup: delete voided On Approval records (total=0) that were created
    // before the new delete-on-return behaviour was introduced. Safe to re-run.
    const { data: oldVoids } = await admin
      .from('sales')
      .select('id')
      .eq('vendor_id', vendor.id)
      .eq('payment_status', 'voided')
      .eq('total', 0)
    if (oldVoids && oldVoids.length > 0) {
      const ids = oldVoids.map((s: any) => s.id)
      await admin.from('sale_items').delete().in('sale_id', ids)
      await admin.from('sales').delete().in('id', ids)
    }
    return NextResponse.json({ success: true, deleted: oldVoids?.length || 0 })
  }

  if (action === 'finalize_draft') {
    const { saleId, customerId: bodyCustomerId, useAdvance, items: finalItems, payments: paymentLines, discount, vehicleNo, notes, saleDate, customerName, customerPhone } = body
    const { data: draft } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    if (draft.payment_status !== 'draft') return NextResponse.json({ error: 'Not a draft' }, { status: 400 })

    const resolvedCustomerId = bodyCustomerId || draft.customer_id || null

    // Update each item with final negotiated price
    for (const fi of (finalItems || [])) {
      if (!fi.id) continue
      await admin.from('sale_items').update({
        unit_price: fi.unitPrice,
        total: fi.quantity * fi.unitPrice,
      }).eq('id', fi.id).eq('sale_id', saleId)
    }

    const subtotal = (finalItems || []).reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0)
    const discountAmt = discount || 0
    const total = Math.max(0, subtotal - discountAmt)

    // Check customer advance (same logic as create_sale)
    let customerAdvance = 0
    if (resolvedCustomerId && useAdvance) {
      const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', resolvedCustomerId).single()
      customerAdvance = parseFloat(cust?.advance_balance || 0)
    }

    const cashPaid = (paymentLines || []).reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
    const advanceUsedForBill = useAdvance && customerAdvance > 0
      ? Math.min(customerAdvance, Math.max(0, total - cashPaid))
      : 0

    const paidForThisBill = Math.min(total, cashPaid + advanceUsedForBill)
    const billBalance = Math.max(0, total - paidForThisBill)
    const excessPayment = Math.max(0, (cashPaid + advanceUsedForBill) - total)

    let paymentStatus = 'paid'
    if (billBalance > 0 && paidForThisBill > 0) paymentStatus = 'partial'
    else if (billBalance > 0 && paidForThisBill === 0) paymentStatus = 'credit'

    const primaryMethod = paymentLines && paymentLines.length > 0
      ? paymentLines.sort((a: any, b: any) => (parseFloat(b.amount) || 0) - (parseFloat(a.amount) || 0))[0].method || 'cash'
      : (advanceUsedForBill > 0 ? 'advance' : billBalance > 0 ? 'credit' : 'cash')

    // Assign the real invoice number now (draft had none)
    const invoiceNo = await generateInvoiceNo(vendor.id, vendor.name)

    // Stamp the finalization date (not draft creation date) so it lands in today's reports
    await admin.from('sales').update({
      invoice_no: invoiceNo,
      subtotal, discount: discountAmt, total,
      paid_amount: paidForThisBill, balance_due: billBalance,
      payment_status: paymentStatus,
      payment_method: primaryMethod,
      vehicle_no: vehicleNo || draft.vehicle_no,
      notes: notes || draft.notes?.replace('ON APPROVAL\n', '').replace('ON APPROVAL', '').trim() || null,
      created_at: saleDate ? new Date(saleDate).toISOString() : new Date().toISOString(),
      customer_name: customerName || draft.customer_name,
      customer_phone: customerPhone || draft.customer_phone,
    }).eq('id', saleId)

    // Record cash/cheque/bank payment lines
    for (const pl of (paymentLines || [])) {
      if (parseFloat(pl.amount) > 0) {
        await admin.from('payments').insert({
          sale_id: saleId, vendor_id: vendor.id, customer_id: resolvedCustomerId,
          amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
          bank_ref: pl.bankRef || null, cheque_number: pl.chequeNumber || null,
          cheque_date: pl.chequeDate || null,
        })
      }
    }

    // Record advance usage
    if (advanceUsedForBill > 0) {
      await admin.from('payments').insert({
        sale_id: saleId, vendor_id: vendor.id, customer_id: resolvedCustomerId,
        amount: advanceUsedForBill, payment_method: 'advance',
        notes: 'Used from advance balance',
      })
    }

    // Handle overpayment: apply to outstanding invoices → remaining to advance
    const settledInvoices: string[] = []
    let excessAppliedToOutstanding = 0
    if (resolvedCustomerId) {
      if (excessPayment > 0) {
        const { data: outstandingSales } = await admin
          .from('sales')
          .select('id, invoice_no, total, paid_amount, balance_due')
          .eq('vendor_id', vendor.id)
          .eq('customer_id', resolvedCustomerId)
          .gt('balance_due', 0)
          .neq('payment_status', 'voided')
          .neq('id', saleId)
          .order('created_at', { ascending: true })

        let remaining = excessPayment
        for (const oldSale of (outstandingSales || [])) {
          if (remaining <= 0) break
          const oldBalance = parseFloat(oldSale.balance_due)
          const applyAmount = Math.min(remaining, oldBalance)
          await admin.from('payments').insert({
            sale_id: oldSale.id, vendor_id: vendor.id, customer_id: resolvedCustomerId,
            amount: applyAmount, payment_method: 'settlement',
            notes: `Auto-applied from invoice ${draft.invoice_no}`,
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
        // Remaining excess + whatever advance wasn't used for the bill → new advance balance
        const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill) + remaining
        await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId)
      } else {
        // No overpayment — just deduct the advance that was used
        if (advanceUsedForBill > 0) {
          const newAdvance = Math.max(0, customerAdvance - advanceUsedForBill)
          await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', resolvedCustomerId)
        }
      }
    }

    // Update total_amount_due snapshot on the sale
    if (resolvedCustomerId) {
      const { data: allCustomerSales } = await admin
        .from('sales').select('balance_due')
        .eq('vendor_id', vendor.id).eq('customer_id', resolvedCustomerId)
        .neq('payment_status', 'voided').neq('payment_status', 'draft').gt('balance_due', 0)
      const totalAmountDue = (allCustomerSales || []).reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0)
      await admin.from('sales').update({ total_amount_due: totalAmountDue }).eq('id', saleId)
    }

    // Re-fetch after all updates so total_amount_due is included
    const { data: finalizedSale } = await admin.from('sales').select('*, items:sale_items(*), payments:payments(*)').eq('id', saleId).single()

    let msg = `Invoice ${invoiceNo} finalized — ${paymentStatus}`
    if (advanceUsedForBill > 0) msg += ` | Rs.${advanceUsedForBill.toLocaleString()} from advance`
    if (excessAppliedToOutstanding > 0) msg += ` | Rs.${excessAppliedToOutstanding.toLocaleString()} applied to old invoices`
    if (settledInvoices.length > 0) msg += ` (cleared: ${settledInvoices.join(', ')})`

    return NextResponse.json({
      success: true, sale: finalizedSale,
      totalAmountDue: finalizedSale?.total_amount_due || 0,
      advanceUsed: advanceUsedForBill, appliedToOutstanding: excessAppliedToOutstanding,
      settledInvoices, message: msg,
    })
  }

  if (action === 'recalculate_amounts_due') {
    // Recalculates total_amount_due for every active invoice using a time-ordered
    // cumulative algorithm: each invoice gets the running sum of balance_due for
    // all of that customer's invoices up to and including its position (by created_at).
    //
    // Example for Sisil Motors (sorted oldest→newest):
    //   older invoices (389k outstanding)
    //   SAK-00178 (193k)  → total_amount_due = 389k + 193k = 582k  ✓
    //   SAK-00180 (125k)  → total_amount_due = 582k + 125k = 707k  ✓
    //   SAK-00181 ( 55k)  → total_amount_due = 707k +  55k = 762k  ✓
    //
    // This produces unique, progressive values per invoice rather than a single flat total.
    const { data: allSales } = await admin
      .from('sales').select('id, customer_id, balance_due, invoice_no')
      .eq('vendor_id', vendor.id)
      .neq('payment_status', 'voided')
      .neq('payment_status', 'draft')
      .order('invoice_no', { ascending: true })
    if (!allSales || allSales.length === 0) return NextResponse.json({ success: true, updated: 0 })

    // Group invoices by customer
    const customerSales: Record<string, any[]> = {}
    for (const s of allSales) {
      if (!s.customer_id) continue
      if (!customerSales[s.customer_id]) customerSales[s.customer_id] = []
      customerSales[s.customer_id].push(s)
    }

    // For each customer compute the cumulative balance_due (oldest → newest)
    let updated = 0
    for (const sales of Object.values(customerSales)) {
      let cumulative = 0
      for (const s of sales) {
        cumulative += parseFloat(s.balance_due || 0)
        await admin.from('sales').update({ total_amount_due: cumulative }).eq('id', s.id)
        updated++
      }
    }
    return NextResponse.json({ success: true, updated })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
