import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  return vendor
}

function generateInvoiceNo(vendorName: string) {
  const prefix = vendorName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X')
  const date = new Date()
  const d = String(date.getDate()).padStart(2, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const rand = String(Math.floor(Math.random() * 9999)).padStart(4, '0')
  return `${prefix}-${d}${m}-${rand}`
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
      .select('*, items:sale_items(id, product_name, product_sku, quantity, unit_price, total), payments:payments(id, amount, payment_method, cheque_number, created_at)')
      .eq('vendor_id', vendor.id)
      .eq('customer_id', customerId)
      .order('created_at', { ascending: false })
      .limit(100)
    const { data: cust } = await admin.from('customers').select('*').eq('id', customerId).single()
    return NextResponse.json({ sales: custSales || [], customer: cust, vendor })
  }

  let dateFilter: string | null = null
  const now = new Date()
  if (period === 'today') { dateFilter = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString() }
  else if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); dateFilter = d.toISOString() }
  else if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); dateFilter = d.toISOString() }

  let query = admin
    .from('sales')
    .select('*, items:sale_items(id, product_name, product_sku, quantity, unit_price, total), customer:customers(id, name, phone)')
    .eq('vendor_id', vendor.id)
    .order('created_at', { ascending: false })

  if (dateFilter) query = query.gte('created_at', dateFilter)
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
    const method = s.payment_method || 'cash'
    methodMap[method] = (methodMap[method] || 0) + parseFloat(s.total || 0)
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
    const { customerId, customerName, customerPhone, items, discount, payments: paymentLines, notes, useAdvance, applyToOutstanding } = body

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

    const invoiceNo = generateInvoiceNo(vendor.name)
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
    const { data: sale, error: saleError } = await admin.from('sales').insert({
      vendor_id: vendor.id, customer_id: resolvedCustomerId,
      invoice_no: invoiceNo, customer_name: customerName || 'Walk-in Customer',
      customer_phone: customerPhone || null, subtotal, discount: discount || 0,
      total, paid_amount: paidForThisBill, balance_due: billBalance,
      payment_method: primaryMethod, payment_status: paymentStatus, notes: notes || null,
    }).select().single()

    if (saleError) return NextResponse.json({ error: saleError.message }, { status: 400 })

    // Create sale items
    const saleItems = items.map((item: any) => ({
      sale_id: sale.id, product_id: item.productId, product_name: item.productName,
      product_sku: item.productSku || null, quantity: item.quantity,
      unit_price: item.unitPrice, total: item.quantity * item.unitPrice,
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

    // Step 6: Auto-deduct stock
    for (const item of items) {
      if (item.productId) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.productId).single()
        if (product) { await admin.from('products').update({ quantity: Math.max(0, product.quantity - item.quantity) }).eq('id', item.productId) }
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
    const { saleId } = body
    const { data: sale } = await admin.from('sales').select('*, items:sale_items(*)').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    for (const item of (sale.items || [])) {
      if (item.product_id) {
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
        if (product) { await admin.from('products').update({ quantity: product.quantity + item.quantity }).eq('id', item.product_id) }
      }
    }

    await admin.from('sales').update({ payment_status: 'voided', balance_due: 0 }).eq('id', saleId)
    return NextResponse.json({ success: true, message: 'Sale voided, stock restored' })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
