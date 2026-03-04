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

export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const url = new URL(req.url)
  const search = url.searchParams.get('search')
  const withCredit = url.searchParams.get('credit') === 'true'

  let query = admin.from('customers').select('*').eq('vendor_id', vendor.id).order('name')

  if (search && search.length >= 2) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
  }

  const { data: customers } = await query.limit(50)

  // If credit info requested, get outstanding balances
  if (withCredit && customers) {
    const customerIds = customers.map((c: any) => c.id)
    if (customerIds.length > 0) {
      const { data: sales } = await admin
        .from('sales')
        .select('customer_id, total, paid_amount, balance_due, payment_status')
        .eq('vendor_id', vendor.id)
        .in('customer_id', customerIds)
        .neq('payment_status', 'voided')

      const creditMap: Record<string, { totalBought: number; totalPaid: number; balance: number; salesCount: number }> = {}
      for (const sale of (sales || [])) {
        if (!creditMap[sale.customer_id]) creditMap[sale.customer_id] = { totalBought: 0, totalPaid: 0, balance: 0, salesCount: 0 }
        creditMap[sale.customer_id].totalBought += parseFloat(sale.total || 0)
        creditMap[sale.customer_id].totalPaid += parseFloat(sale.paid_amount || 0)
        creditMap[sale.customer_id].balance += parseFloat(sale.balance_due || 0)
        creditMap[sale.customer_id].salesCount++
      }

      const customersWithCredit = customers.map((c: any) => ({
        ...c,
        credit: creditMap[c.id] || { totalBought: 0, totalPaid: 0, balance: 0, salesCount: 0 },
        advance: parseFloat(c.advance_balance || 0),
      }))

      return NextResponse.json({ customers: customersWithCredit })
    }
  }

  return NextResponse.json({ customers: customers || [] })
}

export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  if (action === 'create') {
    const { name, phone, whatsapp, email, address, notes } = body
    if (!name?.trim()) return NextResponse.json({ error: 'Customer name required' }, { status: 400 })

    const { data: customer, error } = await admin.from('customers').insert({
      vendor_id: vendor.id, name: name.trim(), phone: phone || null,
      whatsapp: whatsapp || phone || null, email: email || null,
      address: address || null, notes: notes || null,
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, customer })
  }

  if (action === 'update') {
    const { customerId, data: updateData } = body
    const { data: existing } = await admin.from('customers').select('vendor_id').eq('id', customerId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await admin.from('customers').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', customerId)
    return NextResponse.json({ success: true, message: 'Customer updated' })
  }

  // Get all outstanding sales for a customer
  if (action === 'get_outstanding') {
    const { customerId } = body
    const { data: sales } = await admin
      .from('sales')
      .select('*, items:sale_items(*), payments:payments(*)')
      .eq('vendor_id', vendor.id)
      .eq('customer_id', customerId)
      .gt('balance_due', 0)
      .neq('payment_status', 'voided')
      .order('created_at', { ascending: true })

    return NextResponse.json({ sales: sales || [] })
  }

  // Auto-offset: apply advance against outstanding invoices (oldest first)
  if (action === 'auto_offset') {
    const { customerId } = body
    const { data: cust } = await admin.from('customers').select('*').eq('id', customerId).eq('vendor_id', vendor.id).single()
    if (!cust) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    let advance = parseFloat(cust.advance_balance || 0)
    if (advance <= 0) return NextResponse.json({ error: 'No advance balance to offset' }, { status: 400 })

    const { data: outstandingSales } = await admin
      .from('sales')
      .select('id, invoice_no, total, paid_amount, balance_due')
      .eq('vendor_id', vendor.id)
      .eq('customer_id', customerId)
      .gt('balance_due', 0)
      .neq('payment_status', 'voided')
      .order('created_at', { ascending: true })

    if (!outstandingSales || outstandingSales.length === 0) {
      return NextResponse.json({ error: 'No outstanding invoices to offset against' }, { status: 400 })
    }

    let totalApplied = 0
    const settledInvoices: string[] = []
    const partialInvoices: string[] = []

    for (const sale of outstandingSales) {
      if (advance <= 0) break
      const balance = parseFloat(sale.balance_due)
      const applyAmount = Math.min(advance, balance)

      await admin.from('payments').insert({
        sale_id: sale.id, vendor_id: vendor.id, customer_id: customerId,
        amount: applyAmount, payment_method: 'advance',
        notes: 'Auto-offset from advance balance',
      })

      const newPaid = parseFloat(sale.paid_amount) + applyAmount
      const newBalance = Math.max(0, balance - applyAmount)
      await admin.from('sales').update({
        paid_amount: newPaid, balance_due: newBalance,
        payment_status: newBalance <= 0 ? 'paid' : 'partial',
      }).eq('id', sale.id)

      totalApplied += applyAmount
      advance -= applyAmount
      if (newBalance <= 0) settledInvoices.push(sale.invoice_no)
      else partialInvoices.push(sale.invoice_no)
    }

    await admin.from('customers').update({ advance_balance: Math.max(0, advance) }).eq('id', customerId)

    let msg = `Rs.${totalApplied.toLocaleString()} offset from advance.`
    if (settledInvoices.length > 0) msg += ` Cleared: ${settledInvoices.join(', ')}.`
    if (partialInvoices.length > 0) msg += ` Partial: ${partialInvoices.join(', ')}.`
    if (advance > 0) msg += ` Remaining advance: Rs.${advance.toLocaleString()}.`
    else msg += ` Advance fully used.`

    return NextResponse.json({ success: true, message: msg })
  }

  // Bulk settle: apply a lump payment across multiple outstanding invoices (oldest first)
  if (action === 'bulk_settle') {
    const { customerId, payments: paymentLines } = body
    if (!paymentLines || paymentLines.length === 0) return NextResponse.json({ error: 'No payments provided' }, { status: 400 })

    const totalPayment = paymentLines.reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0)
    if (totalPayment <= 0) return NextResponse.json({ error: 'Payment must be positive' }, { status: 400 })

    const { data: outstandingSales } = await admin
      .from('sales')
      .select('id, invoice_no, total, paid_amount, balance_due')
      .eq('vendor_id', vendor.id)
      .eq('customer_id', customerId)
      .gt('balance_due', 0)
      .neq('payment_status', 'voided')
      .order('created_at', { ascending: true })

    const totalOutstanding = (outstandingSales || []).reduce((s: number, sale: any) => s + parseFloat(sale.balance_due), 0)

    // Record all payment lines (attached to first outstanding sale for audit)
    const firstSaleId = outstandingSales?.[0]?.id || null
    for (const pl of paymentLines) {
      if (parseFloat(pl.amount) > 0) {
        await admin.from('payments').insert({
          sale_id: firstSaleId, vendor_id: vendor.id, customer_id: customerId,
          amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
          cheque_number: pl.chequeNumber || null, cheque_date: pl.chequeDate || null,
          bank_ref: pl.bankRef || null, notes: pl.notes || 'Bulk settlement',
        })
      }
    }

    // Apply to invoices oldest first
    let remaining = totalPayment
    const settledInvoices: string[] = []

    for (const sale of (outstandingSales || [])) {
      if (remaining <= 0) break
      const balance = parseFloat(sale.balance_due)
      const applyAmount = Math.min(remaining, balance)

      const newPaid = parseFloat(sale.paid_amount) + applyAmount
      const newBalance = Math.max(0, balance - applyAmount)
      await admin.from('sales').update({
        paid_amount: newPaid, balance_due: newBalance,
        payment_status: newBalance <= 0 ? 'paid' : 'partial',
      }).eq('id', sale.id)

      remaining -= applyAmount
      if (newBalance <= 0) settledInvoices.push(sale.invoice_no)
    }

    // Excess goes to advance
    if (remaining > 0 && customerId) {
      const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', customerId).single()
      const currentAdvance = parseFloat(cust?.advance_balance || 0)
      await admin.from('customers').update({ advance_balance: currentAdvance + remaining }).eq('id', customerId)
    }

    const applied = totalPayment - remaining
    let msg = `Rs.${applied.toLocaleString()} applied to outstanding.`
    if (settledInvoices.length > 0) msg += ` Cleared: ${settledInvoices.join(', ')}.`
    if (remaining > 0) msg += ` Rs.${remaining.toLocaleString()} added to advance.`
    const newOutstanding = Math.max(0, totalOutstanding - applied)
    if (newOutstanding > 0) msg += ` Remaining outstanding: Rs.${newOutstanding.toLocaleString()}.`

    return NextResponse.json({ success: true, message: msg })
  }

  // Record a credit settlement payment (single invoice)
  if (action === 'settle_credit') {
    const { customerId, saleId, payments: paymentLines } = body

    if (!paymentLines || paymentLines.length === 0) {
      return NextResponse.json({ error: 'No payments provided' }, { status: 400 })
    }

    const totalPayment = paymentLines.reduce((sum: number, p: any) => sum + (parseFloat(p.amount) || 0), 0)
    if (totalPayment <= 0) return NextResponse.json({ error: 'Payment amount must be positive' }, { status: 400 })

    // Get the sale
    const { data: sale } = await admin.from('sales').select('*').eq('id', saleId).eq('vendor_id', vendor.id).single()
    if (!sale) return NextResponse.json({ error: 'Sale not found' }, { status: 404 })

    const currentBalance = parseFloat(sale.balance_due || 0)
    const overpayment = Math.max(0, totalPayment - currentBalance)

    // Insert payment records
    for (const pl of paymentLines) {
      if (parseFloat(pl.amount) > 0) {
        await admin.from('payments').insert({
          sale_id: saleId, vendor_id: vendor.id, customer_id: customerId,
          amount: parseFloat(pl.amount), payment_method: pl.method || 'cash',
          cheque_number: pl.chequeNumber || null, cheque_date: pl.chequeDate || null,
          bank_ref: pl.bankRef || null, notes: pl.notes || null,
        })
      }
    }

    // Update sale amounts
    const amountApplied = Math.min(totalPayment, currentBalance)
    const newPaid = parseFloat(sale.paid_amount || 0) + amountApplied
    const newBalance = Math.max(0, currentBalance - totalPayment)
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'

    await admin.from('sales').update({
      paid_amount: newPaid, balance_due: newBalance, payment_status: newStatus,
    }).eq('id', saleId)

    // If overpayment, add to customer advance
    if (overpayment > 0 && customerId) {
      const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', customerId).single()
      const currentAdvance = parseFloat(cust?.advance_balance || 0)
      await admin.from('customers').update({ advance_balance: currentAdvance + overpayment }).eq('id', customerId)
    }

    let msg = `Rs.${amountApplied.toLocaleString()} recorded. ${newBalance > 0 ? 'Balance: Rs.' + newBalance.toLocaleString() : 'Fully settled!'}`
    if (overpayment > 0) msg += ` | Rs.${overpayment.toLocaleString()} added to advance.`

    return NextResponse.json({ success: true, message: msg })
  }

  // Get customer advance balance
  if (action === 'get_customer') {
    const { customerId } = body
    const { data: customer } = await admin.from('customers').select('*').eq('id', customerId).eq('vendor_id', vendor.id).single()
    if (!customer) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ customer })
  }

  // Manually add advance (customer pays in advance without a sale)
  if (action === 'add_advance') {
    const { customerId, amount, paymentMethod, chequeNumber, chequeDate, bankRef, notes: advNotes } = body
    const advAmount = parseFloat(amount)
    if (!advAmount || advAmount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

    const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', customerId).eq('vendor_id', vendor.id).single()
    if (!cust) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const newAdvance = parseFloat(cust.advance_balance || 0) + advAmount
    await admin.from('customers').update({ advance_balance: newAdvance }).eq('id', customerId)

    // Record as a payment without a sale (for audit trail)
    await admin.from('payments').insert({
      sale_id: null, vendor_id: vendor.id, customer_id: customerId,
      amount: advAmount, payment_method: paymentMethod || 'cash',
      cheque_number: chequeNumber || null, cheque_date: chequeDate || null,
      bank_ref: bankRef || null, notes: advNotes || 'Advance payment',
    })

    return NextResponse.json({ success: true, message: `Rs.${advAmount.toLocaleString()} added. New advance: Rs.${newAdvance.toLocaleString()}` })
  }

  // Refund advance (return money to customer)
  if (action === 'refund_advance') {
    const { customerId, amount } = body
    const refundAmount = parseFloat(amount)
    if (!refundAmount || refundAmount <= 0) return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })

    const { data: cust } = await admin.from('customers').select('advance_balance').eq('id', customerId).eq('vendor_id', vendor.id).single()
    if (!cust) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const currentAdvance = parseFloat(cust.advance_balance || 0)
    if (refundAmount > currentAdvance) return NextResponse.json({ error: 'Refund exceeds advance balance' }, { status: 400 })

    await admin.from('customers').update({ advance_balance: currentAdvance - refundAmount }).eq('id', customerId)

    return NextResponse.json({ success: true, message: `Rs.${refundAmount.toLocaleString()} refunded. Remaining advance: Rs.${(currentAdvance - refundAmount).toLocaleString()}` })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
