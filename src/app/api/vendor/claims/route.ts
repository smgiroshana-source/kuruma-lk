import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// ─────────────────────────────────────────────────────────────────────────────
// Insurance claims — stage 1: the claim spine.
//
// A claim ties together everything one accident sends to one insurer:
//   · our PART invoice, our REPR invoice (sales rows, claim_id)
//   · outside vendors' pass-through bills (claim_third_party_bills)
//
// Pass-through bills carry TWO amounts: bill_amount (what the insurer sees and
// reimburses) and paid_amount (what actually left our pocket). The spread on a
// vendor-discounted bill is real profit and is visible only because both are
// captured. Nothing here ever touches VAT or SSCL — these bills are not our
// supply.
//
// Stage 2 adds settlements (discharge voucher allocation) and shortfall
// classification on top of these records.
// ─────────────────────────────────────────────────────────────────────────────

async function getCaller() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, role: 'owner', email: user.email || '' }
  const { data: s } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (s?.vendor) return { vendor: s.vendor, role: s.role || 'cashier', email: user.email || '' }
  return null
}

const r0 = (n: any) => Math.round(Number(n) || 0)

async function claimWithDetail(admin: any, vendorId: string, claim: any) {
  const [{ data: sales }, { data: bills }, { data: insurer }] = await Promise.all([
    admin.from('sales')
      .select('id, invoice_no, tax_serial, receipt_no, document_type, invoice_entity_id, total, net_amount, vat_amount, paid_amount, balance_due, payment_status, created_at, entity:invoice_entities(serial_qqqq, name)')
      .eq('claim_id', claim.id).eq('vendor_id', vendorId).order('created_at'),
    admin.from('claim_third_party_bills').select('*').eq('claim_id', claim.id).order('created_at'),
    admin.from('customers').select('id, name, tin').eq('id', claim.insurer_customer_id).single(),
  ])
  const liveSales = (sales || []).filter((x: any) => x.payment_status !== 'voided')
  const invoiced = liveSales.reduce((t: number, x: any) => t + r0(x.total), 0)
  const received = liveSales.reduce((t: number, x: any) => t + r0(x.paid_amount), 0)
  const billsSubmitted = (bills || []).reduce((t: number, b: any) => t + r0(b.bill_amount), 0)
  const billsReimbursed = (bills || []).reduce((t: number, b: any) => t + r0(b.reimbursed_amount), 0)
  return {
    ...claim,
    insurer: insurer ? { id: insurer.id, name: insurer.name, tin: insurer.tin } : null,
    sales: sales || [],
    bills: bills || [],
    totals: {
      invoiced, received, invoiceBalance: invoiced - received,
      billsSubmitted, billsReimbursed, billsOutstanding: billsSubmitted - billsReimbursed,
      claimedTotal: invoiced + billsSubmitted,
      receivedTotal: received + billsReimbursed,
      outstandingTotal: (invoiced - received) + (billsSubmitted - billsReimbursed),
    },
  }
}

export async function GET(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const status = url.searchParams.get('status')
  const q = url.searchParams.get('q')

  if (id) {
    const { data: claim } = await admin.from('insurance_claims')
      .select('*').eq('id', id).eq('vendor_id', caller.vendor.id).single()
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    return NextResponse.json({ claim: await claimWithDetail(admin, caller.vendor.id, claim) })
  }

  let query = admin.from('insurance_claims').select('*').eq('vendor_id', caller.vendor.id)
    .order('created_at', { ascending: false }).limit(200)
  if (status) query = query.eq('status', status)
  if (q?.trim()) query = query.or(`claim_no.ilike.%${q.trim()}%,vehicle_no.ilike.%${q.trim()}%`)
  const { data: claims, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const detailed = await Promise.all((claims || []).map(c => claimWithDetail(admin, caller.vendor.id, c)))
  return NextResponse.json({ claims: detailed })
}

export async function POST(req: NextRequest) {
  const caller = await getCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({} as any))
  const { action } = body

  if (action === 'create') {
    const { insurerCustomerId, claimNo, vehicleNo, jobRef, notes } = body
    if (!insurerCustomerId) return NextResponse.json({ error: 'Pick the insurance company' }, { status: 400 })
    if (!String(claimNo || '').trim()) return NextResponse.json({ error: 'Enter the claim number' }, { status: 400 })
    const { data: insurer } = await admin.from('customers')
      .select('id, is_insurance').eq('id', insurerCustomerId).eq('vendor_id', caller.vendor.id).single()
    if (!insurer?.is_insurance) return NextResponse.json({ error: 'That customer is not marked as an insurance company' }, { status: 400 })

    const { data: dupe } = await admin.from('insurance_claims').select('id')
      .eq('vendor_id', caller.vendor.id).eq('insurer_customer_id', insurerCustomerId)
      .ilike('claim_no', String(claimNo).trim()).maybeSingle()
    if (dupe) return NextResponse.json({ error: 'This claim number already exists for that insurer' }, { status: 409 })

    const { data, error } = await admin.from('insurance_claims').insert({
      vendor_id: caller.vendor.id, insurer_customer_id: insurerCustomerId,
      claim_no: String(claimNo).trim(), vehicle_no: vehicleNo?.trim() || null,
      workshop_job_ref: jobRef?.trim() || null, notes: notes?.trim() || null,
      created_by: caller.email,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, claim: data })
  }

  if (action === 'update') {
    const { claimId, status, vehicleNo, jobRef, notes } = body
    const patch: any = { updated_at: new Date().toISOString() }
    if (status !== undefined) {
      if (!['open', 'settling', 'closed'].includes(status)) return NextResponse.json({ error: 'Bad status' }, { status: 400 })
      patch.status = status
    }
    if (vehicleNo !== undefined) patch.vehicle_no = vehicleNo?.trim() || null
    if (jobRef !== undefined) patch.workshop_job_ref = jobRef?.trim() || null
    if (notes !== undefined) patch.notes = notes?.trim() || null
    const { error } = await admin.from('insurance_claims').update(patch)
      .eq('id', claimId).eq('vendor_id', caller.vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'add_bill') {
    const { claimId, supplierName, billRef, billAmount, paidAmount, fronted, note } = body
    if (!String(supplierName || '').trim()) return NextResponse.json({ error: 'Enter the vendor name' }, { status: 400 })
    const bill = r0(billAmount)
    if (bill <= 0) return NextResponse.json({ error: 'Enter the bill amount submitted to the insurer' }, { status: 400 })
    const { data: claim } = await admin.from('insurance_claims').select('id')
      .eq('id', claimId).eq('vendor_id', caller.vendor.id).single()
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })

    const isFronted = fronted !== false
    const paid = paidAmount === '' || paidAmount == null ? null : r0(paidAmount)
    // A bill we did not front has no paid amount — no money of ours moved.
    const { data, error } = await admin.from('claim_third_party_bills').insert({
      claim_id: claimId, vendor_id: caller.vendor.id,
      supplier_name: String(supplierName).trim(), bill_ref: billRef?.trim() || null,
      bill_amount: bill,
      paid_amount: isFronted ? (paid ?? bill) : null,
      fronted: isFronted,
      note: note?.trim() || null, created_by: caller.email,
    }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, bill: data })
  }

  if (action === 'delete_bill') {
    const { billId } = body
    const { data: bill } = await admin.from('claim_third_party_bills')
      .select('id, reimbursed_amount').eq('id', billId).eq('vendor_id', caller.vendor.id).single()
    if (!bill) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (r0(bill.reimbursed_amount) > 0) {
      return NextResponse.json({ error: 'This bill has reimbursement recorded — it cannot be deleted' }, { status: 400 })
    }
    const { error } = await admin.from('claim_third_party_bills').delete()
      .eq('id', billId).eq('vendor_id', caller.vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'link_sale') {
    const { claimId, invoiceNo } = body
    const { data: claim } = await admin.from('insurance_claims').select('id, insurer_customer_id, vehicle_no')
      .eq('id', claimId).eq('vendor_id', caller.vendor.id).single()
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    const needle = String(invoiceNo || '').trim()
    if (!needle) return NextResponse.json({ error: 'Enter the invoice number or serial' }, { status: 400 })
    const { data: sale } = await admin.from('sales')
      .select('id, invoice_no, tax_serial, customer_id, claim_id, payment_status')
      .eq('vendor_id', caller.vendor.id)
      .or(`invoice_no.eq.${needle},tax_serial.eq.${needle},receipt_no.eq.${needle}`)
      .maybeSingle()
    if (!sale) return NextResponse.json({ error: 'No invoice found with that number' }, { status: 404 })
    if (sale.payment_status === 'voided') return NextResponse.json({ error: 'That invoice is VOID' }, { status: 400 })
    if (sale.claim_id && sale.claim_id !== claimId) return NextResponse.json({ error: 'That invoice is already on another claim' }, { status: 409 })
    if (sale.customer_id !== claim.insurer_customer_id) {
      return NextResponse.json({ error: 'That invoice is not billed to this claim\'s insurer' }, { status: 400 })
    }
    const { error } = await admin.from('sales').update({ claim_id: claimId })
      .eq('id', sale.id).eq('vendor_id', caller.vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, linked: sale.tax_serial || sale.invoice_no })
  }

  if (action === 'unlink_sale') {
    const { saleId } = body
    const { error } = await admin.from('sales').update({ claim_id: null })
      .eq('id', saleId).eq('vendor_id', caller.vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'delete') {
    // Only an empty claim can be deleted — one with documents is history.
    const { claimId } = body
    const [{ count: salesCount }, { count: billCount }] = await Promise.all([
      admin.from('sales').select('*', { count: 'exact', head: true }).eq('claim_id', claimId),
      admin.from('claim_third_party_bills').select('*', { count: 'exact', head: true }).eq('claim_id', claimId),
    ])
    if ((salesCount || 0) > 0 || (billCount || 0) > 0) {
      return NextResponse.json({ error: 'This claim has invoices or bills on it — close it instead of deleting' }, { status: 400 })
    }
    const { error } = await admin.from('insurance_claims').delete()
      .eq('id', claimId).eq('vendor_id', caller.vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
