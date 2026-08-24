import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { linkSaleToClaim } from '@/lib/claims'

// ─────────────────────────────────────────────────────────────────────────────
// Workshop Pulse → official invoices (WHEEL MART vendor, workshop entities).
//
// Called cross-origin by the Workshop Pulse app (same Supabase project) with
// the staff member's access token. Creates REAL sales in the shared tax
// system: gazette TAX INVOICEs on the REPR serial stream, or proprietor
// receipts on the WRCP series. Reuses the same tables, serial RPC, and VAT
// math as the WHEEL MART POS so VAT/SSCL reports consolidate automatically.
//
// Auth model: Authorization: Bearer <supabase access token>. The user must be
// an ACTIVE row in user_roles (the workshop app's staff list). No cookie auth —
// this endpoint is for the workshop app only, and it can only touch the two
// workshop entities (REPR / WPRO), never PART.
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = new Set([
  'https://workshop-pulse.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
])

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://workshop-pulse.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) })
}

const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']

export async function POST(req: NextRequest) {
  const headers = corsHeaders(req)
  const json = (body: any, status = 200) => NextResponse.json(body, { status, headers })

  // ── Auth: bearer token must belong to an active workshop staff member ──
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return json({ error: 'Not authenticated' }, 401)

  const admin = createAdminClient()
  const { data: { user }, error: authErr } = await admin.auth.getUser(token)
  if (authErr || !user?.email) return json({ error: 'Invalid session' }, 401)

  const email = user.email.toLowerCase()
  const { data: staffRow } = await admin
    .from('user_roles').select('role, is_active')
    .eq('email', email).eq('is_active', true).single()
  if (!staffRow && email !== 'smgiroshana@gmail.com') {
    return json({ error: 'Not workshop staff' }, 403)
  }

  let body: any
  try { body = await req.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const {
    entityKind,          // 'tax_invoice' (Pvt Ltd, REPR) | 'receipt' (Proprietor, WRCP)
    priceMode,           // 'incl' | 'excl' — whether item prices include VAT (tax invoices only)
    customerName, customerPhone, customerAddress, customerTin,
    customerVatRegistered, customerIsInsurance,
    vehicleNo, items, payments: paymentLines, discount, notes, jobRef,
    claimNo,
  } = body

  if (entityKind !== 'tax_invoice' && entityKind !== 'receipt') {
    return json({ error: 'entityKind must be tax_invoice or receipt' }, 400)
  }
  if (!Array.isArray(items) || items.length === 0) return json({ error: 'No items' }, 400)
  if (!customerName?.trim()) return json({ error: 'Customer name required' }, 400)

  // ── Entity: this route can ONLY use the two workshop entities ──
  const wantCode = entityKind === 'tax_invoice' ? 'REPR' : 'WPRO'
  const { data: entity } = await admin
    .from('invoice_entities')
    .select('id, vendor_id, name, address, tin, invoice_mode, serial_qqqq, receipt_prefix')
    .eq('serial_qqqq', wantCode).single()
  if (!entity) return json({ error: `Workshop entity ${wantCode} not configured` }, 500)
  const vendorId = entity.vendor_id

  // ── VAT rate + item normalisation (integer LKR) ──
  const todayCmb = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const { data: vatHist } = await admin.from('tax_rate_history')
    .select('value').eq('vendor_id', vendorId).eq('key', 'vat_rate')
    .lte('effective_from', todayCmb)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()
  const { data: vatRow } = vatHist ? { data: null } : await admin
    .from('tax_config').select('value')
    .eq('vendor_id', vendorId).eq('key', 'vat_rate').single()
  const vatRate = vatHist ? parseFloat(vatHist.value) : vatRow ? parseFloat(vatRow.value) : 18

  const isTaxInvoice = entityKind === 'tax_invoice'
  const exclMode = isTaxInvoice && priceMode === 'excl'
  const normItems: { description: string; qty: number; unitPrice: number; stream: 'PART' | 'SVC' }[] = []
  for (const it of items) {
    const qty = Math.round(Number(it.qty))
    let price = Math.round(Number(it.unitPrice))
    if (!Number.isFinite(qty) || qty < 1) return json({ error: `Invalid quantity for "${it.description || 'item'}"` }, 400)
    if (!Number.isFinite(price) || price < 0) return json({ error: `Invalid price for "${it.description || 'item'}"` }, 400)
    // excl mode: quoted price is VAT-exclusive (insurance approvals) — gross it up
    if (exclMode) price = Math.round(price * (100 + vatRate) / 100)
    normItems.push({
      description: String(it.description || 'Item').trim(),
      qty, unitPrice: price,
      stream: it.stream === 'PART' ? 'PART' : 'SVC',
    })
  }
  for (const pl of (paymentLines || [])) {
    const amt = Number(pl.amount)
    if (pl.amount !== '' && pl.amount != null && (!Number.isFinite(amt) || amt < 0)) {
      return json({ error: 'Invalid payment amount' }, 400)
    }
  }

  const subtotal = normItems.reduce((s, i) => s + i.qty * i.unitPrice, 0)
  // In excl mode the discount is quoted VAT-exclusive too (insurance letters) —
  // gross it up like the items so the VAT-inclusive total stays consistent
  let rawDiscount = Math.max(0, Math.round(Number(discount) || 0))
  if (exclMode && rawDiscount > 0) rawDiscount = Math.round(rawDiscount * (100 + vatRate) / 100)
  const roundedDiscount = Math.min(subtotal, rawDiscount)
  const total = Math.max(0, subtotal - roundedDiscount)

  // ── Customer: find by phone or create under the vendor ──
  let customerId: string | null = null
  if (customerPhone?.trim()) {
    const { data: existing } = await admin.from('customers').select('id')
      .eq('vendor_id', vendorId).eq('phone', customerPhone.trim()).single()
    if (existing) customerId = existing.id
  }
  if (!customerId) {
    const { data: byName } = await admin.from('customers').select('id')
      .eq('vendor_id', vendorId).ilike('name', customerName.trim()).limit(1)
    if (byName?.length) customerId = byName[0].id
  }
  if (!customerId) {
    const { data: newCust } = await admin.from('customers').insert({
      vendor_id: vendorId, name: customerName.trim(),
      phone: customerPhone?.trim() || null, whatsapp: customerPhone?.trim() || null,
    }).select('id').single()
    if (newCust) customerId = newCust.id
  }
  if (customerId && isTaxInvoice) {
    const patch: any = {}
    if (customerAddress?.trim()) patch.address = customerAddress.trim()
    if (customerVatRegistered !== undefined) patch.vat_registered = !!customerVatRegistered
    if (customerTin?.trim() && customerVatRegistered) patch.tin = customerTin.trim()
    if (customerIsInsurance !== undefined) patch.is_insurance = !!customerIsInsurance
    if (Object.keys(patch).length > 0) {
      await admin.from('customers').update(patch).eq('id', customerId).eq('vendor_id', vendorId)
    }
  }

  // ── Serial: same atomic RPC + formats as the POS ──
  const now = new Date()
  let period: string
  let format: (n: number) => string
  if (isTaxInvoice) {
    period = `${now.getFullYear().toString().slice(-2)}${MONTHS[now.getMonth()]}`
    format = (n) => `${period}_${entity.serial_qqqq}_${String(n).padStart(5, '0')}`
  } else {
    period = 'receipt'
    format = (n) => `${entity.receipt_prefix}-${String(n).padStart(5, '0')}`
  }
  const { data: seq, error: seqErr } = await admin.rpc('next_invoice_serial', {
    p_entity_id: entity.id, p_period: period,
  })
  if (seqErr || seq == null) return json({ error: 'Serial generation failed: ' + (seqErr?.message || 'null') }, 500)
  const serialNo = format(seq as number)
  const taxSerial = isTaxInvoice ? serialNo : null
  const receiptNo = isTaxInvoice ? null : serialNo

  // ── VAT (extracted from VAT-inclusive totals, same as POS) ──
  const vatAmount = Math.round(total * vatRate / (100 + vatRate))
  const netAmount = total - vatAmount

  // ── Payments / status ──
  // payFullCash: the client can't pre-compute the grossed-up total in excl
  // mode, so it can ask for "paid in full, cash" and we fill the amount here
  const effectivePayments = body.payFullCash === true
    ? [{ method: body.payMethod || 'cash', amount: total }]
    : (paymentLines || [])
  const cashPaid = effectivePayments.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
  const paidForBill = Math.min(total, cashPaid)
  const balance = Math.max(0, total - paidForBill)
  const paymentStatus = balance === 0 ? 'paid' : paidForBill > 0 ? 'partial' : 'credit'
  const primaryMethod = (paymentLines?.length ? paymentLines[0].method : null) || (balance > 0 ? 'credit' : 'cash')

  const todayStr = now.toISOString().split('T')[0]
  const saleRecord: any = {
    vendor_id: vendorId, customer_id: customerId,
    invoice_no: serialNo, customer_name: customerName.trim(),
    customer_phone: customerPhone?.trim() || null,
    subtotal, discount: roundedDiscount, total,
    paid_amount: paidForBill, balance_due: balance,
    payment_method: primaryMethod, payment_status: paymentStatus,
    notes: [jobRef ? `Workshop ${jobRef}` : null, notes || null].filter(Boolean).join(' — ') || null,
    vehicle_no: vehicleNo || null,
    invoice_entity_id: entity.id,
    document_type: entityKind,
    receipt_no: receiptNo, tax_serial: taxSerial,
    net_amount: netAmount, vat_amount: vatAmount,
    date_supply: todayStr,
  }
  if (isTaxInvoice) {
    saleRecord.customer_address = customerAddress?.trim() || null
    saleRecord.customer_tin = (customerVatRegistered && customerTin?.trim()) ? customerTin.trim() : null
  }

  const { data: sale, error: saleErr } = await admin.from('sales').insert(saleRecord).select().single()
  if (saleErr) {
    // Serial already minted — preserve it as a VOID row so the sequence stays gapless
    await admin.from('sales').insert({
      vendor_id: vendorId, invoice_no: serialNo, customer_name: 'VOID',
      subtotal: 0, discount: 0, total: 0, net_amount: 0, vat_amount: 0,
      paid_amount: 0, balance_due: 0,
      payment_method: 'cash', payment_status: 'voided', voided_at: new Date().toISOString(),
      invoice_entity_id: entity.id, document_type: entityKind,
      tax_serial: taxSerial, receipt_no: receiptNo,
      notes: 'VOID — workshop sale failed to save: ' + saleErr.message,
    }).then(() => {}, () => {})
    return json({ error: saleErr.message }, 400)
  }

  // Claim spine: an insurance job's invoice is tagged with its claim so the
  // repair bill and the parts bill meet on one claim record. Best-effort.
  let claimWarning: string | null = null
  if ((claimNo || customerIsInsurance) && customerId) {
    const link = await linkSaleToClaim(admin, vendorId, sale.id, customerId, claimNo,
      { vehicleNo: vehicleNo || null, jobRef: jobRef || null, createdBy: 'workshop' })
    claimWarning = link.warning
  }

  const saleItems = normItems.map(i => ({
    sale_id: sale.id, product_id: null, product_name: i.description,
    product_sku: null, quantity: i.qty, unit_price: i.unitPrice,
    unit_cost: null, total: i.qty * i.unitPrice,
    sscl_stream: i.stream,
  }))
  const { error: itemsErr } = await admin.from('sale_items').insert(saleItems)
  if (itemsErr) {
    await admin.from('sales').update({ payment_status: 'voided', voided_at: new Date().toISOString(), notes: 'VOID — workshop sale items failed to save' }).eq('id', sale.id)
    return json({ error: itemsErr.message }, 400)
  }

  const paymentRecords = effectivePayments
    .filter((p: any) => parseFloat(p.amount) > 0)
    .map((p: any) => ({
      sale_id: sale.id, vendor_id: vendorId, customer_id: customerId,
      amount: Math.round(parseFloat(p.amount)), payment_method: p.method || 'cash',
      notes: 'Workshop', cheque_number: p.chequeNumber || null,
    }))
  if (paymentRecords.length > 0) {
    const { error: payErr } = await admin.from('payments').insert(paymentRecords)
    if (payErr) console.error('workshop sale payments failed:', payErr.message)
  }

  return json({
    sale: {
      id: sale.id, invoice_no: serialNo, tax_serial: taxSerial, receipt_no: receiptNo,
      document_type: entityKind, subtotal, discount: roundedDiscount, total,
      net_amount: netAmount, vat_amount: vatAmount, vat_rate: vatRate,
      paid_amount: paidForBill, balance_due: balance,
      date_supply: todayStr, created_at: sale.created_at,
      items: normItems,
    },
    claimWarning,
    entity: { name: entity.name, address: entity.address, tin: entity.tin },
  })
}
