import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { recomputeSessionForDate } from '@/lib/cash'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, userId: user.id }
  return null
}

// ─── GET ──────────────────────────────────────────────────────────────────────
// GET ?supplier_id=UUID[&include_paid=true]   — list invoices for a supplier
// GET ?action=payments&invoice_id=UUID        — list payments for an invoice
export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = auth
  const admin = createAdminClient()

  const params = req.nextUrl.searchParams
  const action = params.get('action')

  // ── LIST PAYMENTS FOR AN INVOICE ─────────────────────────────────────────────
  if (action === 'payments') {
    const invoiceId = params.get('invoice_id')
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 })
    }

    // Verify the invoice belongs to this vendor
    const { data: inv, error: invErr } = await admin
      .from('supplier_invoices')
      .select('id')
      .eq('id', invoiceId)
      .eq('vendor_id', vendor.id)
      .single()

    if (invErr || !inv) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const { data: payments, error } = await admin
      .from('supplier_payments')
      .select('*')
      .eq('supplier_invoice_id', invoiceId)
      .eq('vendor_id', vendor.id)
      .order('payment_date', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ payments: payments || [] })
  }

  // ── LIST INVOICES FOR A SUPPLIER ─────────────────────────────────────────────
  const supplierId = params.get('supplier_id')
  if (!supplierId) {
    return NextResponse.json({ error: 'supplier_id is required' }, { status: 400 })
  }

  const includePaid = params.get('include_paid') === 'true'
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD

  let query = admin
    .from('supplier_invoices')
    .select('*')
    .eq('vendor_id', vendor.id)
    .eq('supplier_id', supplierId)
    .order('due_date', { ascending: true })

  if (!includePaid) {
    query = query.neq('status', 'paid')
  }

  const { data: invoices, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = invoices || []

  // Auto-update overdue status: due_date < today AND status in ('unpaid','partial') AND amount_paid < amount
  const overdueIds: string[] = rows
    .filter(
      (inv) =>
        (inv.status === 'unpaid' || inv.status === 'partial') &&
        (inv.due_date as string) < today &&
        (inv.amount_paid as number) < (inv.amount as number)
    )
    .map((inv) => inv.id as string)

  if (overdueIds.length > 0) {
    // Fire-and-forget in parallel — we still return the updated view below
    await admin
      .from('supplier_invoices')
      .update({ status: 'overdue' })
      .in('id', overdueIds)
      .eq('vendor_id', vendor.id)

    // Reflect the update in the returned rows (avoid a second round-trip)
    for (const row of rows) {
      if (overdueIds.includes(row.id as string)) {
        row.status = 'overdue'
      }
    }
  }

  return NextResponse.json({ invoices: rows })
}

// ─── POST ─────────────────────────────────────────────────────────────────────
// POST { action: 'create_invoice', ... }  — create a supplier invoice
// POST { action: 'record_payment', ... }  — record a payment against an invoice
// POST { action: 'delete_invoice', ... }  — delete an unpaid invoice
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor, userId } = auth
  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  // ── CREATE INVOICE ───────────────────────────────────────────────────────────
  if (action === 'create_invoice') {
    const { supplier_id, invoice_no, invoice_date, due_date, amount, notes, grn_id } = body as {
      supplier_id: string
      invoice_no: string
      invoice_date: string
      due_date: string
      amount: number
      notes?: string
      grn_id?: string
    }

    if (!supplier_id || !invoice_no || !invoice_date || !due_date || amount === undefined) {
      return NextResponse.json(
        { error: 'supplier_id, invoice_no, invoice_date, due_date, and amount are required' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive integer (whole LKR)' }, { status: 400 })
    }

    // Validate supplier belongs to this vendor
    const { data: supplier, error: supErr } = await admin
      .from('suppliers')
      .select('id')
      .eq('id', supplier_id)
      .eq('vendor_id', vendor.id)
      .single()

    if (supErr || !supplier) {
      return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })
    }

    const { data: invoice, error } = await admin
      .from('supplier_invoices')
      .insert({
        vendor_id: vendor.id,
        supplier_id,
        invoice_no,
        invoice_date,
        due_date,
        amount,
        amount_paid: 0,
        status: 'unpaid',
        notes: notes ?? null,
        grn_id: grn_id ?? null,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, invoice })
  }

  // ── RECORD PAYMENT ───────────────────────────────────────────────────────────
  if (action === 'record_payment') {
    const { invoice_id, supplier_id, amount, payment_date, method, reference, notes } = body as {
      invoice_id: string
      supplier_id: string
      amount: number
      payment_date: string
      method: 'cash' | 'online' | 'cheque' | 'bank' | 'card'
      reference?: string
      notes?: string
    }

    if (!invoice_id || !supplier_id || amount === undefined || !payment_date || !method) {
      return NextResponse.json(
        { error: 'invoice_id, supplier_id, amount, payment_date, and method are required' },
        { status: 400 }
      )
    }

    if (!Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive integer (whole LKR)' }, { status: 400 })
    }

    // Fetch the invoice and verify vendor ownership
    const { data: invoice, error: invErr } = await admin
      .from('supplier_invoices')
      .select('id, vendor_id, amount, amount_paid, status')
      .eq('id', invoice_id)
      .eq('vendor_id', vendor.id)
      .single()

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    const remaining = (invoice.amount as number) - (invoice.amount_paid as number)
    if (amount > remaining) {
      return NextResponse.json(
        { error: `Payment amount (${amount}) exceeds remaining balance (${remaining})` },
        { status: 400 }
      )
    }

    // Payment control (owner rule): cheque and online-transfer payments get an
    // 8-digit system confirmation number. Cheques: the operator writes it on
    // the cheque book slip — the owner signs only numbered slips. Online
    // transfers: the operator types it into the transfer's remarks field, so
    // the bank statement itself carries the traceable number.
    // ('bank'/'card' accepted as legacy spellings of online.)
    const methodNorm = String(method).toLowerCase()
    const isCheque = methodNorm.includes('cheque')
    const isOnline = methodNorm === 'online' || methodNorm.includes('bank') || methodNorm === 'card'
    if (isCheque && !reference?.trim()) {
      return NextResponse.json({ error: 'Cheque number is required for cheque payments' }, { status: 400 })
    }
    const paymentConfirmNo = (isCheque || isOnline)
      ? String(Math.floor(10000000 + Math.random() * 90000000))
      : null

    const methodCanon = isCheque ? 'cheque' : isOnline ? 'online' : 'cash'

    // Insert the payment record
    const { error: payErr } = await admin.from('supplier_payments').insert({
      vendor_id: vendor.id,
      supplier_id,
      supplier_invoice_id: invoice_id,
      amount,
      payment_date,
      method: methodCanon,
      reference: reference ?? null,
      notes: notes ?? null,
      payment_confirm_no: paymentConfirmNo,
      created_by: userId,
    })

    if (payErr) return NextResponse.json({ error: payErr.message }, { status: 500 })

    // Recalculate invoice totals and status
    const newAmountPaid = (invoice.amount_paid as number) + amount
    const newStatus: 'paid' | 'partial' =
      newAmountPaid >= (invoice.amount as number) ? 'paid' : 'partial'

    const { error: updateErr } = await admin
      .from('supplier_invoices')
      .update({ amount_paid: newAmountPaid, status: newStatus })
      .eq('id', invoice_id)
      .eq('vendor_id', vendor.id)

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

    // Cash left the drawer — that day's expected count must know
    if (methodCanon === 'cash') await recomputeSessionForDate(admin, vendor.id, payment_date)

    return NextResponse.json({ ok: true, confirm_no: paymentConfirmNo, confirm_kind: isCheque ? 'cheque' : isOnline ? 'online' : null })
  }

  // ── DELETE INVOICE ───────────────────────────────────────────────────────────
  if (action === 'delete_invoice') {
    const { invoice_id } = body as { invoice_id: string }

    if (!invoice_id) {
      return NextResponse.json({ error: 'invoice_id is required' }, { status: 400 })
    }

    // Fetch invoice and verify ownership
    const { data: invoice, error: invErr } = await admin
      .from('supplier_invoices')
      .select('id, amount_paid')
      .eq('id', invoice_id)
      .eq('vendor_id', vendor.id)
      .single()

    if (invErr || !invoice) {
      return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    }

    if ((invoice.amount_paid as number) > 0) {
      return NextResponse.json(
        { error: 'Cannot delete an invoice that has payments recorded' },
        { status: 400 }
      )
    }

    const { error } = await admin
      .from('supplier_invoices')
      .delete()
      .eq('id', invoice_id)
      .eq('vendor_id', vendor.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
