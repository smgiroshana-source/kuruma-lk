import { NextRequest, NextResponse } from 'next/server'
import { roleAllows, forbidden, pgSafe, isUUID, MAX_UPLOAD_BYTES } from '@/lib/security'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// One rule for settling an invoice, shared with the supplier-returns route,
// which raises a credit note when goods go back.
import { recomputeSupplierInvoice as recomputeInvoice } from '@/lib/supplierInvoice'

// ─────────────────────────────────────────────────────────────────────────────
// Credit notes received FROM suppliers — settlement and quantity discounts,
// price adjustments, overcharges.
//
// Recorded exactly as the supplier's document reads, never computed. Suppliers
// round differently, discount only part of an invoice, and sometimes issue a
// note with no VAT at all. The claim has to match their paper, because that is
// what IRD cross-checks.
//
// A credit note is NOT a payment. It reduces what is owed without any cash
// moving, so it must never touch the drawer or the cash session — booking it
// as a payment would put phantom money into the day's reconciliation.
// ─────────────────────────────────────────────────────────────────────────────

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { vendor, userId: user.id, callerRole: 'owner' as string }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { vendor: staffLink.vendor, userId: user.id, callerRole: (staffLink.role || 'cashier') as string }
  return null
}

const r0 = (n: any) => Math.round(Number(n) || 0)


// ─── GET ──────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const admin = createAdminClient()
  const supplierId = req.nextUrl.searchParams.get('supplier_id')
  const invoiceId = req.nextUrl.searchParams.get('invoice_id')

  let q = admin.from('supplier_credit_notes')
    .select('*, supplier:suppliers(name, supplier_code, tin)')
    .eq('vendor_id', auth.vendor.id)
    .order('credit_note_date', { ascending: false })
  if (supplierId) q = q.eq('supplier_id', supplierId)
  if (invoiceId) q = q.eq('supplier_invoice_id', invoiceId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ creditNotes: data || [] })
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor, userId } = auth
  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body
  // Destructive actions are owner/manager only. Any active login — a cashier
  // included — could do these before the 2026-09-02 review.
  const DESTRUCTIVE = new Set(['delete'])
  if (DESTRUCTIVE.has(action) && !roleAllows((auth as any).callerRole, ['owner', 'manager'])) return forbidden(action, ['owner', 'manager'])

  if (action === 'create') {
    const {
      supplierId, supplierInvoiceId, creditNoteNo, creditNoteDate,
      invoiceNo, invoiceDate, reason, remarks, netAmount, vatAmount,
    } = body

    if (!supplierId) return NextResponse.json({ error: 'Pick the supplier who gave the credit' }, { status: 400 })
    if (!creditNoteDate) return NextResponse.json({ error: 'The date is required' }, { status: 400 })

    const net = r0(netAmount)
    const vat = r0(vatAmount)
    if (net <= 0) return NextResponse.json({ error: 'The credited amount must be more than zero' }, { status: 400 })
    if (vat < 0) return NextResponse.json({ error: 'VAT cannot be negative' }, { status: 400 })
    if (vat > net) return NextResponse.json({ error: `VAT (${vat}) is larger than the credited value (${net}) — check the note` }, { status: 400 })

    const { data: sup } = await admin.from('suppliers')
      .select('id, name, vat_registered').eq('id', supplierId).eq('vendor_id', vendor.id).single()
    if (!sup) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 })

    // A VAT-registered supplier's credit note is a legal document with its own
    // number, and Schedule 04 lists it — so it has to be entered.
    //
    // A supplier who isn't registered often gives a discount with no paperwork
    // at all: "take 5% off". Demanding a note number there is asking for a
    // thing that doesn't exist, so an internal reference is issued instead —
    // the record still needs an identifier to be quotable and auditable.
    let noteNo = String(creditNoteNo || '').trim()
    if (!noteNo) {
      if (sup.vat_registered) {
        return NextResponse.json({
          error: `${sup.name} is VAT-registered, so their credit note has a number on it — Schedule 04 lists it. Copy it off the note.`,
        }, { status: 400 })
      }
      const { data: prior } = await admin.from('supplier_credit_notes')
        .select('credit_note_no').eq('vendor_id', vendor.id).like('credit_note_no', 'DISC-%')
      const highest = (prior || []).reduce((m: number, r: any) => {
        const n = parseInt(String(r.credit_note_no).replace('DISC-', ''), 10)
        return Number.isFinite(n) && n > m ? n : m
      }, 0)
      noteNo = `DISC-${String(highest + 1).padStart(5, '0')}`
    }

    // A goods return records its own supplier credit note. The same note
    // number arriving here too would double the Schedule 04 reduction and
    // double-credit the payable.
    const { data: onReturn } = await admin.from('supplier_returns')
      .select('return_no').eq('vendor_id', vendor.id).eq('supplier_id', supplierId)
      .eq('supplier_credit_note_no', noteNo).maybeSingle()
    if (onReturn) {
      return NextResponse.json({
        error: `${noteNo} is already recorded against supplier return ${onReturn.return_no}. Entering it again would claim the VAT reduction twice.`,
      }, { status: 409 })
    }

    if (supplierInvoiceId) {
      const { data: inv } = await admin.from('supplier_invoices')
        .select('id, amount, amount_paid, credit_total').eq('id', supplierInvoiceId).eq('vendor_id', vendor.id).single()
      if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
      // Credits plus payments can never exceed the invoice — that would mean
      // the supplier owes us money, which is a refund, not a credit note.
      const room = Number(inv.amount || 0) - Number(inv.amount_paid || 0) - Number(inv.credit_total || 0)
      if (net + vat > room) {
        return NextResponse.json({
          error: `This note credits Rs.${(net + vat).toLocaleString()} but only Rs.${room.toLocaleString()} is left outstanding on that invoice. Check you picked the right invoice.`,
        }, { status: 400 })
      }
    }

    const { data: created, error } = await admin.from('supplier_credit_notes').insert({
      vendor_id:           vendor.id,
      supplier_id:         supplierId,
      supplier_invoice_id: supplierInvoiceId || null,
      credit_note_no:      noteNo,
      credit_note_date:    creditNoteDate,
      invoice_no:          String(invoiceNo || '').trim() || null,
      invoice_date:        invoiceDate || null,
      reason:              reason || 'discount',
      remarks:             String(remarks || '').trim() || null,
      net_amount:          net,
      vat_amount:          vat,
      total_amount:        net + vat,
      created_by:          userId,
    }).select().single()

    if (error) {
      if (/supplier_credit_notes_unique_no/.test(error.message)) {
        return NextResponse.json({ error: `${noteNo} has already been recorded for ${sup.name}.` }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (supplierInvoiceId) await recomputeInvoice(admin, vendor.id, supplierInvoiceId)

    return NextResponse.json({
      ok: true, creditNote: created,
      message: `${created.credit_note_no} recorded — Rs.${(net + vat).toLocaleString()} off what you owe${vat > 0 ? `, input VAT reduced by Rs.${vat.toLocaleString()}` : ''}`,
    })
  }

  if (action === 'delete') {
    const { creditNoteId } = body
    if (!creditNoteId) return NextResponse.json({ error: 'creditNoteId required' }, { status: 400 })
    const { data: note } = await admin.from('supplier_credit_notes')
      .select('id, supplier_invoice_id, credit_note_no').eq('id', creditNoteId).eq('vendor_id', vendor.id).single()
    if (!note) return NextResponse.json({ error: 'Credit note not found' }, { status: 404 })

    const { error } = await admin.from('supplier_credit_notes').delete().eq('id', creditNoteId).eq('vendor_id', vendor.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (note.supplier_invoice_id) await recomputeInvoice(admin, vendor.id, note.supplier_invoice_id)

    return NextResponse.json({ ok: true, message: `${note.credit_note_no} removed — the payable and the VAT claim go back` })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
