import { NextRequest, NextResponse } from 'next/server'
import { roleAllows, forbidden, pgSafe, isUUID, MAX_UPLOAD_BYTES } from '@/lib/security'
import { missingVatPaperwork, vatPaperworkMessage } from '@/lib/vatPaperwork'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustProductQuantity } from '@/lib/stock'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return { ...vendor, callerRole: 'owner' }
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return { ...staffLink.vendor, callerRole: staffLink.role || 'cashier' }
  return null
}

// ── GET — list GRNs ───────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')   // 'draft' | 'posted' | null = all
  const limit  = parseInt(searchParams.get('limit') || '50')

  const admin = createAdminClient()
  let query = admin
    .from('grns')
    .select('*, items:grn_items(id, product_name, product_sku, quantity, unit_cost, vat_rate, vat_amount, total_cost, product_id, foreign_currency, foreign_amount)')
    .eq('vendor_id', vendor.id)
    .order('received_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ grns: data || [] })
}

// ── POST — create / post / delete GRN ────────────────────────────────────────
export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body
  // Destructive actions are owner/manager only. Any active login — a cashier
  // included — could do these before the 2026-09-02 review.
  const DESTRUCTIVE = new Set(['delete_grn', 'reverse_grn'])
  if (DESTRUCTIVE.has(action) && !roleAllows((vendor as any).callerRole, ['owner', 'manager'])) return forbidden(action, ['owner', 'manager'])
  const admin = createAdminClient()

  // ── CREATE (or update draft) ──────────────────────────────────────────────
  if (action === 'create_grn') {
    const { supplierId, supplierName, supplierInvoiceNo, supplierInvoiceDate, receivedAt, notes, items } = body

    // A GRN records who the goods came from — supplierless receipts made the
    // payables ledger and the VAT trail silently incomplete (owner-reported).
    if (!supplierId && !String(supplierName || '').trim()) {
      return NextResponse.json({ error: 'Pick the supplier (or type a name for a one-off) before saving the GRN' }, { status: 400 })
    }
    // items: [{ productId, productName, productSku, quantity, unitCost, vatRate }]

    // Snapshot supplier TIN + VAT status at the time of receiving
    // (mirrors how we snapshot customer_tin on sales — needed for IRD input VAT claim)
    // null = unknown (manual supplier with no record) — don't assert "not VAT-registered"
    let supplierTin: string | null = null
    let supplierVatRegistered: boolean | null = null
    if (supplierId) {
      const { data: sup } = await admin.from('suppliers')
        .select('tin, vat_registered').eq('id', supplierId).eq('vendor_id', vendor.id).single()
      if (sup) { supplierTin = sup.tin || null; supplierVatRegistered = !!sup.vat_registered }
    }

    if (!items || items.length === 0)
      return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

    // Validate items
    for (const item of items) {
      if (!item.quantity || item.quantity < 1) return NextResponse.json({ error: 'All quantities must be ≥ 1' }, { status: 400 })
      if (item.unitCost == null || item.unitCost < 0) return NextResponse.json({ error: 'Unit cost must be ≥ 0' }, { status: 400 })
    }

    // Compute totals
    let netCost   = 0
    let inputVat  = 0
    const grnItemRows: any[] = []
    for (const item of items) {
      // Round unit cost FIRST so stored unit_cost × qty always equals the line total
      const unitCost  = Math.round(item.unitCost)
      const totalLine = item.quantity * unitCost
      const vatAmt    = Math.round(totalLine * (item.vatRate || 0) / 100)
      netCost  += totalLine
      inputVat += vatAmt
      grnItemRows.push({
        product_id:       item.productId || null,
        product_name:     item.productName,
        product_sku:      item.productSku || null,
        quantity:         item.quantity,
        unit_cost:        unitCost,
        vat_rate:         item.vatRate || 0,
        vat_amount:       vatAmt,
        total_cost:       totalLine,
        foreign_currency: item.foreignCurrency || null,
        foreign_amount:   item.foreignAmount   || null,
        // pack purchases (consumables): audit fact only — quantity is pieces
        packs:            item.packs ? Math.round(Number(item.packs)) : null,
        pieces_per_pack:  item.piecesPerPack ? Math.round(Number(item.piecesPerPack)) : null,
      })
    }
    const totalCost = netCost + inputVat

    // Reserve GRN number
    const { data: seqNum, error: seqErr } = await admin.rpc('next_grn_serial', { p_vendor_id: vendor.id })
    if (seqErr || seqNum == null)
      return NextResponse.json({ error: 'Failed to reserve GRN number: ' + seqErr?.message }, { status: 500 })

    const grnNumber = `GRN-${String(seqNum).padStart(5, '0')}`

    // Insert GRN header
    const { data: grn, error: grnErr } = await admin.from('grns').insert({
      vendor_id:           vendor.id,
      supplier_id:           supplierId || null,
      supplier_name:         supplierName || null,
      supplier_tin:          supplierTin,
      supplier_vat_registered: supplierVatRegistered,
      grn_number:            grnNumber,
      supplier_invoice_no:   supplierInvoiceNo || null,
      // VAT Schedule 02 lists the SUPPLIER's invoice date, not our receipt date
      supplier_invoice_date: supplierInvoiceDate || null,
      received_at:         receivedAt || new Date().toISOString().slice(0, 10),
      notes:               notes || null,
      status:              'draft',
      net_cost:            netCost,
      input_vat:           inputVat,
      total_cost:          totalCost,
    }).select().single()

    if (grnErr) return NextResponse.json({ error: grnErr.message }, { status: 500 })

    // Insert line items
    const { error: itemsErr } = await admin.from('grn_items').insert(
      grnItemRows.map(r => ({ ...r, grn_id: grn.id }))
    )
    if (itemsErr) {
      await admin.from('grns').delete().eq('id', grn.id)
      return NextResponse.json({ error: itemsErr.message }, { status: 500 })
    }

    return NextResponse.json({ grn: { ...grn, itemCount: grnItemRows.length }, grnNumber })
  }

  // ── POST GRN (update stock + create cost layers) ──────────────────────────
  if (action === 'post_grn') {
    // Zero-cost lines post only when explicitly confirmed as free-of-charge:
    // a forgotten cost otherwise becomes a 0-cost FIFO layer and every later
    // sale of it books 100% margin.
    {
      const { data: zeroCheck } = await admin.from('grn_items')
        .select('product_name, unit_cost').eq('grn_id', body.grnId)
      const zeros = (zeroCheck || []).filter((i: any) => Number(i.unit_cost || 0) <= 0)
      if (zeros.length > 0 && body.allowZeroCost !== true) {
        return NextResponse.json({
          error: 'ZERO_COST',
          zeroCostItems: zeros.map((i: any) => i.product_name),
        }, { status: 400 })
      }
    }
    const { grnId } = body
    if (!grnId) return NextResponse.json({ error: 'grnId required' }, { status: 400 })

    const { data: grn } = await admin
      .from('grns')
      .select('*, items:grn_items(*)')
      .eq('id', grnId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!grn) return NextResponse.json({ error: 'GRN not found' }, { status: 404 })
    if (grn.status === 'posted') return NextResponse.json({ error: 'GRN already posted' }, { status: 400 })

    const items = grn.items || []
    if (items.length === 0) return NextResponse.json({ error: 'GRN has no items' }, { status: 400 })

    // Claiming input VAT? Then the supplier's tax-invoice details must be on
    // record BEFORE the purchase enters the VAT ledger. Chasing them at filing
    // time, weeks later, is how a credit gets lost. Nothing is blocked when
    // there's no VAT to claim — that purchase never reaches Schedule 02.
    if (parseInt(grn.input_vat || 0) > 0) {
      const gaps = missingVatPaperwork(grn)
      if (gaps.length > 0) {
        return NextResponse.json({
          error: `${grn.grn_number} can't be posted. ${vatPaperworkMessage(gaps)}`,
          missingVatPaperwork: gaps,
          hint: 'Add the details to the draft, or set the VAT rate to 0% if you are not claiming input VAT on this purchase.',
        }, { status: 400 })
      }
    }

    // 0. Atomically claim the GRN (guards against double-posting from two tabs/clicks)
    const { data: claimed } = await admin.from('grns')
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', grnId).eq('vendor_id', vendor.id).eq('status', 'draft')
      .select('id').maybeSingle()
    if (!claimed) return NextResponse.json({ error: 'GRN already posted' }, { status: 400 })

    // 1. Update stock quantities for each product line (atomic per product)
    for (const item of items) {
      if (item.product_id) {
        await adjustProductQuantity(admin, item.product_id, vendor.id, item.quantity)
      }
    }

    // 2. Create FIFO cost layers
    const costLayerRows = items
      .filter((i: any) => i.product_id && i.unit_cost > 0)
      .map((i: any) => ({
        vendor_id:          vendor.id,
        product_id:         i.product_id,
        grn_id:             grn.id,
        grn_item_id:        i.id,
        quantity_received:  i.quantity,
        quantity_remaining: i.quantity,
        unit_cost:          i.unit_cost,
        received_at:        grn.received_at,
      }))

    if (costLayerRows.length > 0) {
      const { error: layerErr } = await admin.from('cost_layers').insert(costLayerRows)
      if (layerErr) {
        // Roll back: restore stock and reopen the GRN as draft
        for (const item of items) {
          if (item.product_id) await adjustProductQuantity(admin, item.product_id, vendor.id, -item.quantity)
        }
        await admin.from('grns').update({ status: 'draft', posted_at: null }).eq('id', grnId)
        return NextResponse.json({ error: 'Cost layer error: ' + layerErr.message }, { status: 500 })
      }
    }

    // 3. The goods now exist in stock, so the debt for them must exist too.
    // Auto-create the payable from the GRN totals (invoice total = net + VAT —
    // what the supplier actually billed). Due date follows the supplier's
    // payment terms. Without a supplier record there is nobody to owe, so no
    // payable — the response says so instead of failing the post.
    let payable: any = null
    if (grn.supplier_id && parseInt(grn.total_cost || 0) > 0) {
      const { data: sup } = await admin.from('suppliers')
        .select('payment_terms').eq('id', grn.supplier_id).eq('vendor_id', vendor.id).single()
      const termDays = sup?.payment_terms ?? 30
      const baseDate = grn.supplier_invoice_date || grn.received_at
      const due = new Date(`${baseDate}T00:00:00+05:30`)
      due.setDate(due.getDate() + termDays)
      const { data: inv, error: invErr } = await admin.from('supplier_invoices').insert({
        vendor_id: vendor.id,
        supplier_id: grn.supplier_id,
        invoice_no: grn.supplier_invoice_no || grn.grn_number,
        invoice_date: baseDate,
        due_date: due.toLocaleDateString('en-CA'),
        amount: parseInt(grn.total_cost),
        amount_paid: 0,
        status: 'unpaid',
        notes: `Auto from ${grn.grn_number}`,
        grn_id: grn.id,
      }).select('id, invoice_no, amount, due_date').single()
      // The stock posting stands either way — a payable failure is reported,
      // never allowed to half-undo a posted GRN.
      if (!invErr && inv) payable = inv
    }

    const totalQty = items.reduce((s: number, i: any) => s + i.quantity, 0)
    return NextResponse.json({
      success: true,
      message: `GRN ${grn.grn_number} posted — ${totalQty} units received, stock updated`,
      payable,
      payableSkipped: !grn.supplier_id ? 'no_supplier' : (parseInt(grn.total_cost || 0) <= 0 ? 'zero_total' : null),
    })
  }

  // ── UPDATE DRAFT GRN (replace items, recalc totals) ─────────────────────
  if (action === 'update_grn') {
    const { grnId, items } = body
    if (!grnId) return NextResponse.json({ error: 'grnId required' }, { status: 400 })
    if (!items || items.length === 0) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

    const { data: grn } = await admin.from('grns').select('status, grn_number').eq('id', grnId).eq('vendor_id', vendor.id).single()
    if (!grn) return NextResponse.json({ error: 'GRN not found' }, { status: 404 })
    if (grn.status === 'posted') return NextResponse.json({ error: 'Cannot edit a posted GRN' }, { status: 400 })

    // Validate + recompute totals
    let netCost = 0, inputVat = 0
    const rows: any[] = []
    for (const item of items) {
      if (!item.quantity || item.quantity < 1) return NextResponse.json({ error: 'All quantities must be ≥ 1' }, { status: 400 })
      if (item.unitCost == null || item.unitCost < 0) return NextResponse.json({ error: 'Unit cost must be ≥ 0' }, { status: 400 })
      const unitCost  = Math.round(item.unitCost)
      const totalLine = item.quantity * unitCost
      const vatAmt    = Math.round(totalLine * (item.vatRate || 0) / 100)
      netCost  += totalLine
      inputVat += vatAmt
      rows.push({
        grn_id:           grnId,
        product_id:       item.productId || null,
        product_name:     item.productName,
        product_sku:      item.productSku || null,
        quantity:         item.quantity,
        unit_cost:        unitCost,
        vat_rate:         item.vatRate || 0,
        vat_amount:       vatAmt,
        total_cost:       totalLine,
        foreign_currency: item.foreignCurrency || null,
        foreign_amount:   item.foreignAmount   || null,
        // pack purchases (consumables): audit fact only — quantity is pieces
        packs:            item.packs ? Math.round(Number(item.packs)) : null,
        pieces_per_pack:  item.piecesPerPack ? Math.round(Number(item.piecesPerPack)) : null,
      })
    }
    const totalCost = netCost + inputVat

    // Replace items: insert new rows FIRST, then delete the old ones —
    // a failed insert no longer leaves the GRN with no items at all.
    const { data: oldItems } = await admin.from('grn_items').select('id').eq('grn_id', grnId)
    const { error: itemsErr } = await admin.from('grn_items').insert(rows)
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
    const oldIds = (oldItems || []).map((i: any) => i.id)
    if (oldIds.length > 0) await admin.from('grn_items').delete().in('id', oldIds)

    await admin.from('grns').update({ net_cost: netCost, input_vat: inputVat, total_cost: totalCost, updated_at: new Date().toISOString() }).eq('id', grnId)
    return NextResponse.json({ success: true, message: `${grn.grn_number} updated` })
  }

  // ── REVERSE POSTED GRN ────────────────────────────────────────────────────
  if (action === 'reverse_grn') {
    const { grnId } = body
    if (!grnId) return NextResponse.json({ error: 'grnId required' }, { status: 400 })

    const { data: grn } = await admin.from('grns').select('*, items:grn_items(*)').eq('id', grnId).eq('vendor_id', vendor.id).single()
    if (!grn) return NextResponse.json({ error: 'GRN not found' }, { status: 404 })
    if (grn.status === 'reversed') return NextResponse.json({ error: 'GRN already reversed' }, { status: 400 })
    if (grn.status !== 'posted') return NextResponse.json({ error: 'Only posted GRNs can be reversed' }, { status: 400 })

    const items = grn.items || []

    // Check: are any cost layers from this GRN partially or fully consumed?
    const { data: layers } = await admin.from('cost_layers').select('id, quantity_received, quantity_remaining, product_id').eq('grn_id', grnId)
    const consumed = (layers || []).filter((l: any) => l.quantity_remaining < l.quantity_received)
    if (consumed.length > 0) {
      return NextResponse.json({
        error: `Cannot reverse — ${consumed.length} cost layer(s) have already been consumed by sales. Adjust stock manually instead.`
      }, { status: 400 })
    }

    // Reverse: reduce product quantities + delete cost layers + mark reversed
    for (const item of items) {
      if (item.product_id) {
        await adjustProductQuantity(admin, item.product_id, vendor.id, -item.quantity)
      }
    }
    await admin.from('cost_layers').delete().eq('grn_id', grnId)
    await admin.from('grns').update({ status: 'reversed', posted_at: null, reversed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', grnId)

    return NextResponse.json({ success: true, message: `${grn.grn_number} reversed — stock quantities reduced, cost layers removed` })
  }

  // ── DELETE DRAFT GRN ─────────────────────────────────────────────────────
  if (action === 'delete_grn') {
    const { grnId } = body
    const { data: grn } = await admin.from('grns').select('status, grn_number').eq('id', grnId).eq('vendor_id', vendor.id).single()
    if (!grn) return NextResponse.json({ error: 'GRN not found' }, { status: 404 })
    if (grn.status === 'posted') return NextResponse.json({ error: 'Cannot delete a posted GRN' }, { status: 400 })
    await admin.from('grns').delete().eq('id', grnId)
    return NextResponse.json({ success: true, message: `${grn.grn_number} deleted` })
  }

  // ── FIX PAPERWORK on an already-posted GRN ────────────────────────────────
  // The three Schedule 02 fields are a record of the SUPPLIER's document, not
  // our own figures — correcting them changes no amount, no stock and no cost
  // layer, so unlike a normal edit this is allowed after posting. Without it
  // the older GRNs that predate the posting gate could never be made filable.
  if (action === 'update_grn_invoice_info') {
    const { grnId, supplierInvoiceNo, supplierInvoiceDate, supplierTin } = body
    if (!grnId) return NextResponse.json({ error: 'grnId required' }, { status: 400 })

    const { data: grn } = await admin.from('grns')
      .select('id, grn_number, supplier_id, input_vat').eq('id', grnId).eq('vendor_id', vendor.id).single()
    if (!grn) return NextResponse.json({ error: 'GRN not found' }, { status: 404 })

    const patch = {
      supplier_invoice_no:   (supplierInvoiceNo   || '').trim() || null,
      supplier_invoice_date: (supplierInvoiceDate || '').trim() || null,
      supplier_tin:          (supplierTin         || '').trim() || null,
      updated_at:            new Date().toISOString(),
    }
    if (parseInt(grn.input_vat || 0) > 0) {
      const gaps = missingVatPaperwork(patch)
      if (gaps.length > 0) {
        return NextResponse.json({ error: vatPaperworkMessage(gaps), missingVatPaperwork: gaps }, { status: 400 })
      }
    }

    const { error: upErr } = await admin.from('grns').update(patch).eq('id', grnId).eq('vendor_id', vendor.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    // Carry the TIN back to the supplier record so the next GRN inherits it
    // instead of asking the operator for the same number again.
    if (patch.supplier_tin && grn.supplier_id) {
      const { data: sup } = await admin.from('suppliers')
        .select('tin').eq('id', grn.supplier_id).eq('vendor_id', vendor.id).single()
      if (sup && !sup.tin) {
        await admin.from('suppliers').update({ tin: patch.supplier_tin })
          .eq('id', grn.supplier_id).eq('vendor_id', vendor.id)
      }
    }

    return NextResponse.json({ success: true, message: `${grn.grn_number} invoice details saved` })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
