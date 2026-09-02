import { NextRequest, NextResponse } from 'next/server'
import { roleAllows, forbidden, pgSafe, isUUID, MAX_UPLOAD_BYTES } from '@/lib/security'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustProductQuantity } from '@/lib/stock'
import { recomputeSessionForDate } from '@/lib/cash'
import { recomputeSupplierInvoice } from '@/lib/supplierInvoice'

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

// ── GET — list supplier returns ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor } = auth

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'draft' | 'confirmed' | null = all

  const admin = createAdminClient()
  let query = admin
    .from('supplier_returns')
    .select('*, supplier:suppliers(name)')
    .eq('vendor_id', vendor.id)
    .order('return_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Flatten supplier_name for convenience
  const returns = (data || []).map((r: any) => ({
    ...r,
    supplier_name: r.supplier?.name ?? null,
  }))

  return NextResponse.json({ returns })
}

// ── POST — create / confirm / delete ─────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor, userId } = auth

  const body = await req.json()
  const { action } = body as { action: string }
  // Destructive actions are owner/manager only. Any active login — a cashier
  // included — could do these before the 2026-09-02 review.
  const DESTRUCTIVE = new Set(['delete'])
  if (DESTRUCTIVE.has(action) && !roleAllows((auth as any).callerRole, ['owner', 'manager'])) return forbidden(action, ['owner', 'manager'])
  const admin = createAdminClient()

  // ── CREATE ────────────────────────────────────────────────────────────────
  if (action === 'create') {
    const {
      supplier_id,
      return_date,
      reason,
      notes,
      items,
    } = body as {
      supplier_id: string
      return_date: string
      reason?: string
      notes?: string
      items: Array<{
        product_id: string
        product_sku: string
        product_name: string
        quantity: number
        unit_cost: number
      }>
    }

    if (!supplier_id) return NextResponse.json({ error: 'supplier_id required' }, { status: 400 })
    if (!return_date) return NextResponse.json({ error: 'return_date required' }, { status: 400 })
    if (!items || items.length === 0) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

    // Validate supplier belongs to this vendor
    const { data: supplier } = await admin
      .from('suppliers')
      .select('id')
      .eq('id', supplier_id)
      .eq('vendor_id', vendor.id)
      .single()
    if (!supplier) return NextResponse.json({ error: 'Supplier not found for this vendor' }, { status: 400 })

    // Compute line totals and validate
    const itemRows: Array<{
      product_id: string
      product_sku: string
      product_name: string
      quantity: number
      unit_cost: number
      total_cost: number
    }> = []
    let total_amount = 0

    for (const item of items) {
      if (!item.product_id) return NextResponse.json({ error: 'Each item must have a product_id' }, { status: 400 })
      if (!item.quantity || item.quantity < 1) return NextResponse.json({ error: 'Item quantity must be ≥ 1' }, { status: 400 })
      if (item.unit_cost == null || item.unit_cost < 0) return NextResponse.json({ error: 'Item unit_cost must be ≥ 0' }, { status: 400 })
      const total_cost = item.quantity * item.unit_cost
      total_amount += total_cost
      itemRows.push({
        product_id: item.product_id,
        product_sku: item.product_sku,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        total_cost,
      })
    }

    // Auto-generate return_no: SR-YYMM-NNNN
    const now = new Date()
    const yy = String(now.getUTCFullYear()).slice(2)
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const prefix = `SR-${yy}${mm}-`

    const { data: lastReturn } = await admin
      .from('supplier_returns')
      .select('return_no')
      .eq('vendor_id', vendor.id)
      .like('return_no', `${prefix}%`)
      .order('return_no', { ascending: false })
      .limit(1)
      .single()

    const nextNum = lastReturn
      ? parseInt(lastReturn.return_no.slice(prefix.length), 10) + 1
      : 1
    const return_no = `${prefix}${String(nextNum).padStart(4, '0')}`

    // Insert supplier_returns header
    const { data: ret, error: retErr } = await admin
      .from('supplier_returns')
      .insert({
        vendor_id: vendor.id,
        supplier_id,
        return_no,
        return_date,
        reason: reason ?? null,
        notes: notes ?? null,
        total_amount,
        status: 'draft',
        created_by: userId,
      })
      .select('id, return_no')
      .single()

    if (retErr) return NextResponse.json({ error: retErr.message }, { status: 500 })

    // Insert line items
    const { error: itemsErr } = await admin
      .from('supplier_return_items')
      .insert(itemRows.map((r) => ({ ...r, return_id: ret.id })))

    if (itemsErr) {
      // Roll back header on items failure
      await admin.from('supplier_returns').delete().eq('id', ret.id)
      return NextResponse.json({ error: itemsErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, return: { id: ret.id, return_no: ret.return_no } })
  }

  // ── CONFIRM ───────────────────────────────────────────────────────────────
  if (action === 'confirm') {
    const { returnId } = body as { returnId: string }
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 })

    // Fetch return + items, scoped to this vendor
    const { data: ret } = await admin
      .from('supplier_returns')
      .select('*, items:supplier_return_items(*)')
      .eq('id', returnId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!ret) return NextResponse.json({ error: 'Supplier return not found' }, { status: 404 })
    if (ret.status !== 'draft') return NextResponse.json({ error: 'Only draft returns can be confirmed' }, { status: 400 })

    const items: Array<{
      id: string
      product_id: string
      product_sku: string
      product_name: string
      quantity: number
      unit_cost: number
      total_cost: number
    }> = ret.items || []

    if (items.length === 0) return NextResponse.json({ error: 'Return has no items' }, { status: 400 })

    // Reduce stock and log movements for each item
    let costOfGoods = 0
    for (const item of items) {
      const { data: product } = await admin
        .from('products')
        .select('quantity')
        .eq('id', item.product_id)
        .eq('vendor_id', vendor.id)
        .single()

      if (!product) {
        return NextResponse.json(
          { error: `Product ${item.product_name} not found` },
          { status: 400 }
        )
      }

      const newQty = product.quantity - item.quantity
      if (newQty < 0) {
        return NextResponse.json(
          { error: `Insufficient stock for "${item.product_name}" — available: ${product.quantity}, returning: ${item.quantity}` },
          { status: 400 }
        )
      }

      // Atomic, per CLAUDE.md: a read-then-write here loses a count when two
      // people confirm at the same time.
      await adjustProductQuantity(admin, item.product_id, vendor.id, -item.quantity)

      // Take the goods out of the FIFO layers too. Without this the stock fell
      // but the layers kept the returned units, so a later sale drew its COGS
      // from stock that had physically gone back to the supplier — and the
      // layers drifted further from the shelf with every return.
      const { data: consumed } = await admin.rpc('consume_fifo_cost', {
        p_vendor_id: vendor.id, p_product_id: item.product_id, p_quantity: item.quantity,
      })
      // What the goods were really carried at. Falls back to the typed cost
      // when a product has no layers (stock loaded before GRNs existed).
      costOfGoods += (consumed && consumed > 0) ? Number(consumed) : Number(item.total_cost || 0)

      // Log stock movement
      const { error: movErr } = await admin.from('stock_movements').insert({
        vendor_id: vendor.id,
        product_id: item.product_id,
        product_sku: item.product_sku,
        movement_type: 'return_out',
        quantity_change: -item.quantity,
        quantity_before: product.quantity,
        quantity_after: newQty,
        reference_id: ret.id,
        reference_type: 'supplier_return',
        notes: ret.reason ?? null,
        created_by: userId,
      })

      if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 })
    }

    // Mark return as confirmed
    const { error: confirmErr } = await admin
      .from('supplier_returns')
      .update({ status: 'confirmed', cost_of_goods: Math.round(costOfGoods) })
      .eq('id', returnId)

    if (confirmErr) return NextResponse.json({ error: confirmErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  }

  // ── RECORD SUPPLIER CREDIT NOTE ───────────────────────────────────────────
  // When we return goods to a local VAT-registered supplier they send back a
  // credit note. It has to appear on VAT Schedule 04 with "Issued By Me = No"
  // and it reduces our input VAT in the month the note is dated.
  if (action === 'set_credit_note') {
    const { returnId, credit_note_no, credit_note_date, invoice_no, invoice_date, credit_vat } =
      body as { returnId: string; credit_note_no: string; credit_note_date: string; invoice_no?: string; invoice_date?: string; credit_vat: number }
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 })

    const { data: ret } = await admin
      .from('supplier_returns')
      .select('id, status, total_amount')
      .eq('id', returnId).eq('vendor_id', vendor.id).single()
    if (!ret) return NextResponse.json({ error: 'Supplier return not found' }, { status: 404 })

    // Clearing the note (supplier never sent one / entered by mistake)
    if (!credit_note_no) {
      const { error } = await admin.from('supplier_returns')
        .update({ supplier_credit_note_no: null, supplier_credit_note_date: null, credit_vat: 0 })
        .eq('id', returnId).eq('vendor_id', vendor.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, cleared: true })
    }

    if (ret.status !== 'confirmed') return NextResponse.json({ error: 'Confirm the return before recording the supplier credit note' }, { status: 400 })
    if (!credit_note_date) return NextResponse.json({ error: 'Credit note date required' }, { status: 400 })
    const vat = Math.round(Number(credit_vat) || 0)
    if (vat < 0) return NextResponse.json({ error: 'VAT credited cannot be negative' }, { status: 400 })
    // The VAT on a credit note can never exceed the VAT on what was returned
    if (vat > Math.round(Number(ret.total_amount || 0))) {
      return NextResponse.json({ error: 'VAT credited is larger than the value of the returned goods — check the note' }, { status: 400 })
    }

    const { error } = await admin.from('supplier_returns').update({
      supplier_credit_note_no:   String(credit_note_no).trim(),
      supplier_credit_note_date: credit_note_date,
      supplier_invoice_no:       invoice_no ? String(invoice_no).trim() : null,
      supplier_invoice_date:     invoice_date || null,
      credit_vat:                vat,
    }).eq('id', returnId).eq('vendor_id', vendor.id)
    if (error) {
      if (String(error.message).includes('supplier_returns_crn_uniq')) {
        return NextResponse.json({ error: 'That credit note number is already recorded for this supplier' }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  // ── RECORD WHAT THE SUPPLIER ALLOWED ──────────────────────────────────────
  //
  // The goods have gone back; this is the supplier's answer. They may allow the
  // full cost, part of it, or nothing. Whatever is allowed reduces what we owe
  // them or comes back as money; whatever is NOT allowed is a loss, and it
  // becomes an expense so the month shows it.
  if (action === 'record_credit') {
    const { returnId, credit_amount, method, supplierInvoiceId, reference, credit_date } = body as {
      returnId: string; credit_amount: number; method: 'invoice' | 'cash' | 'bank' | 'none'
      supplierInvoiceId?: string; reference?: string; credit_date?: string
    }
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 })
    if (!['invoice', 'cash', 'bank', 'none'].includes(method)) {
      return NextResponse.json({ error: 'method must be invoice, cash, bank or none' }, { status: 400 })
    }

    const { data: ret } = await admin.from('supplier_returns')
      .select('id, return_no, status, supplier_id, total_amount, cost_of_goods, credit_recorded_at, reason')
      .eq('id', returnId).eq('vendor_id', vendor.id).single()
    if (!ret) return NextResponse.json({ error: 'Supplier return not found' }, { status: 404 })
    if (ret.status !== 'confirmed') {
      return NextResponse.json({ error: 'Confirm the return before recording what the supplier allowed' }, { status: 400 })
    }
    if (ret.credit_recorded_at) {
      return NextResponse.json({ error: `The supplier's answer is already recorded on ${ret.return_no}. Clear it first to change it.` }, { status: 409 })
    }

    const cost = Math.round(Number(ret.cost_of_goods ?? ret.total_amount) || 0)
    const credited = method === 'none' ? 0 : Math.round(Number(credit_amount) || 0)
    if (credited < 0) return NextResponse.json({ error: 'Credit cannot be negative' }, { status: 400 })
    if (credited > cost) {
      return NextResponse.json({
        error: `The supplier cannot credit more than the goods cost you (Rs.${cost.toLocaleString()}). Check the figure.`,
      }, { status: 400 })
    }
    if (method !== 'none' && credited === 0) {
      return NextResponse.json({ error: 'Enter what the supplier allowed, or choose "allowed nothing"' }, { status: 400 })
    }
    const when = credit_date || new Date().toISOString().slice(0, 10)

    let creditNoteId: string | null = null
    let movementId: string | null = null

    // Credited against an unpaid invoice — the same row a hand-entered supplier
    // credit note creates, so the payable falls by exactly one route.
    if (method === 'invoice') {
      if (!supplierInvoiceId) return NextResponse.json({ error: 'Choose which invoice the credit comes off' }, { status: 400 })
      const { data: inv } = await admin.from('supplier_invoices')
        .select('id, supplier_id, invoice_no, amount, amount_paid, credit_total')
        .eq('id', supplierInvoiceId).eq('vendor_id', vendor.id).single()
      if (!inv) return NextResponse.json({ error: 'Supplier invoice not found' }, { status: 404 })
      if (inv.supplier_id !== ret.supplier_id) {
        return NextResponse.json({ error: 'That invoice belongs to a different supplier' }, { status: 400 })
      }
      const room = Number(inv.amount || 0) - Number(inv.amount_paid || 0) - Number(inv.credit_total || 0)
      if (credited > room) {
        return NextResponse.json({
          error: `Only Rs.${Math.round(room).toLocaleString()} is still outstanding on ${inv.invoice_no}. Credit a smaller amount, or take the rest another way.`,
        }, { status: 400 })
      }
      // The same shape a hand-entered note takes, so payables sees one kind of
      // credit note however it arrived. VAT stays 0 here: the amount agreed is
      // what the supplier allows, and any input VAT to reverse is recorded
      // separately on the return's own credit-note fields for Schedule 04.
      const { data: note, error: noteErr } = await admin.from('supplier_credit_notes').insert({
        vendor_id: vendor.id, supplier_id: ret.supplier_id, supplier_invoice_id: inv.id,
        credit_note_no: (reference || ret.return_no).trim(), credit_note_date: when,
        reason: 'goods_returned', remarks: `Goods returned — ${ret.return_no}`,
        net_amount: credited, vat_amount: 0, total_amount: credited,
        created_by: userId,
      }).select('id').single()
      if (noteErr) {
        if (/supplier_credit_notes_unique_no/.test(noteErr.message)) {
          return NextResponse.json({ error: `Credit note "${(reference || ret.return_no).trim()}" is already recorded for this supplier — use their own note number.` }, { status: 409 })
        }
        return NextResponse.json({ error: 'Could not record the credit note: ' + noteErr.message }, { status: 500 })
      }
      creditNoteId = note.id
      await recomputeSupplierInvoice(admin, vendor.id, inv.id)
    }

    // Cash back over the counter — the drawer is heavier tonight and the count
    // has to know. It is cost recovery, not income: the loss is the shortfall
    // below, and this side is profit-neutral like every other cash movement.
    if (method === 'cash') {
      const { data: mv, error: mvErr } = await admin.from('cash_movements').insert({
        vendor_id: vendor.id, movement_date: when, type: 'supplier_refund_in',
        amount: credited, note: `Supplier refund — ${ret.return_no}`, created_by: userId,
      }).select('id').single()
      if (mvErr) return NextResponse.json({ error: 'Could not record the cash received: ' + mvErr.message }, { status: 500 })
      movementId = mv.id
      await recomputeSessionForDate(admin, vendor.id, when)
    }

    // A bank refund changes no drawer and no payable — it is recorded here and
    // shows on the return.

    // The part the supplier would not allow is gone for good.
    const shortfall = cost - credited
    let expenseId: string | null = null
    if (shortfall > 0) {
      const { data: exp, error: expErr } = await admin.from('expenses').insert({
        vendor_id: vendor.id, expense_date: when, category: 'supplier_return_loss',
        description: `Not credited on returned goods — ${ret.return_no}${ret.reason ? ' (' + ret.reason + ')' : ''}`,
        amount: shortfall, payment_method: 'none', reference: ret.return_no, created_by: userId,
      }).select('id').single()
      if (expErr) return NextResponse.json({ error: 'Could not record the shortfall: ' + expErr.message }, { status: 500 })
      expenseId = exp.id
    }

    const { error: upErr } = await admin.from('supplier_returns').update({
      credit_amount: credited, credit_method: method,
      credit_supplier_invoice_id: method === 'invoice' ? supplierInvoiceId : null,
      credit_reference: (reference || '').trim() || null,
      credit_recorded_at: new Date().toISOString(), credit_recorded_by: userId,
      credit_note_id: creditNoteId, credit_movement_id: movementId, shortfall_expense_id: expenseId,
    }).eq('id', returnId).eq('vendor_id', vendor.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    return NextResponse.json({
      ok: true, credited, shortfall, cost,
      message: `${ret.return_no}: goods cost Rs.${cost.toLocaleString()}, supplier allowed Rs.${credited.toLocaleString()}`
        + (shortfall > 0 ? ` — Rs.${shortfall.toLocaleString()} written off as a loss.` : ' — nothing lost.'),
    })
  }

  // ── CLEAR THE CREDIT (entered wrongly) ────────────────────────────────────
  if (action === 'clear_credit') {
    const { returnId } = body as { returnId: string }
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 })
    const { data: ret } = await admin.from('supplier_returns')
      .select('id, credit_method, credit_supplier_invoice_id, credit_note_id, credit_movement_id, shortfall_expense_id, credit_recorded_at')
      .eq('id', returnId).eq('vendor_id', vendor.id).single()
    if (!ret) return NextResponse.json({ error: 'Supplier return not found' }, { status: 404 })
    if (!ret.credit_recorded_at) return NextResponse.json({ error: 'Nothing recorded to clear' }, { status: 400 })

    // Undo each row this created, then re-derive the invoice from what is left.
    if (ret.credit_note_id) await admin.from('supplier_credit_notes').delete().eq('id', ret.credit_note_id).eq('vendor_id', vendor.id)
    if (ret.credit_supplier_invoice_id) {
      await recomputeSupplierInvoice(admin, vendor.id, ret.credit_supplier_invoice_id)
    }
    let movementDate: string | null = null
    if (ret.credit_movement_id) {
      const { data: mv } = await admin.from('cash_movements').select('movement_date').eq('id', ret.credit_movement_id).single()
      movementDate = mv?.movement_date || null
      await admin.from('cash_movements').delete().eq('id', ret.credit_movement_id).eq('vendor_id', vendor.id)
    }
    if (ret.shortfall_expense_id) await admin.from('expenses').delete().eq('id', ret.shortfall_expense_id).eq('vendor_id', vendor.id)

    await admin.from('supplier_returns').update({
      credit_amount: null, credit_method: null, credit_supplier_invoice_id: null, credit_reference: null,
      credit_recorded_at: null, credit_recorded_by: null,
      credit_note_id: null, credit_movement_id: null, shortfall_expense_id: null,
    }).eq('id', returnId).eq('vendor_id', vendor.id)
    if (movementDate) await recomputeSessionForDate(admin, vendor.id, movementDate)

    return NextResponse.json({ ok: true })
  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { returnId } = body as { returnId: string }
    if (!returnId) return NextResponse.json({ error: 'returnId required' }, { status: 400 })

    const { data: ret } = await admin
      .from('supplier_returns')
      .select('status, return_no')
      .eq('id', returnId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!ret) return NextResponse.json({ error: 'Supplier return not found' }, { status: 404 })
    if (ret.status !== 'draft') return NextResponse.json({ error: 'Only draft returns can be deleted' }, { status: 400 })

    // Items cascade-deleted via ON DELETE CASCADE
    const { error: delErr } = await admin
      .from('supplier_returns')
      .delete()
      .eq('id', returnId)
      .eq('vendor_id', vendor.id)

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
