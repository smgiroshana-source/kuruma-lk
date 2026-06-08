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
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
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
  const admin = createAdminClient()

  // ── CREATE (or update draft) ──────────────────────────────────────────────
  if (action === 'create_grn') {
    const { supplierId, supplierName, supplierInvoiceNo, receivedAt, notes, items } = body
    // items: [{ productId, productName, productSku, quantity, unitCost, vatRate }]

    // Snapshot supplier TIN + VAT status at the time of receiving
    // (mirrors how we snapshot customer_tin on sales — needed for IRD input VAT claim)
    let supplierTin: string | null = null
    let supplierVatRegistered = false
    if (supplierId) {
      const { data: sup } = await admin.from('suppliers')
        .select('tin, vat_registered').eq('id', supplierId).single()
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
      const totalLine = Math.round(item.quantity * item.unitCost)
      const vatAmt    = Math.round(totalLine * (item.vatRate || 0) / 100)
      netCost  += totalLine
      inputVat += vatAmt
      grnItemRows.push({
        product_id:       item.productId || null,
        product_name:     item.productName,
        product_sku:      item.productSku || null,
        quantity:         item.quantity,
        unit_cost:        Math.round(item.unitCost),
        vat_rate:         item.vatRate || 0,
        vat_amount:       vatAmt,
        total_cost:       totalLine,
        foreign_currency: item.foreignCurrency || null,
        foreign_amount:   item.foreignAmount   || null,
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

    // 1. Update stock quantities for each product line
    for (const item of items) {
      if (item.product_id) {
        const { data: product } = await admin
          .from('products')
          .select('quantity')
          .eq('id', item.product_id)
          .single()

        if (product) {
          await admin.from('products').update({
            quantity: (product.quantity || 0) + item.quantity
          }).eq('id', item.product_id)
        }
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
      if (layerErr) return NextResponse.json({ error: 'Cost layer error: ' + layerErr.message }, { status: 500 })
    }

    // 3. Mark GRN as posted
    await admin.from('grns').update({
      status:    'posted',
      posted_at: new Date().toISOString(),
    }).eq('id', grnId)

    const totalQty = items.reduce((s: number, i: any) => s + i.quantity, 0)
    return NextResponse.json({
      success: true,
      message: `GRN ${grn.grn_number} posted — ${totalQty} units received, stock updated`,
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
      const totalLine = Math.round(item.quantity * item.unitCost)
      const vatAmt    = Math.round(totalLine * (item.vatRate || 0) / 100)
      netCost  += totalLine
      inputVat += vatAmt
      rows.push({
        grn_id:           grnId,
        product_id:       item.productId || null,
        product_name:     item.productName,
        product_sku:      item.productSku || null,
        quantity:         item.quantity,
        unit_cost:        Math.round(item.unitCost),
        vat_rate:         item.vatRate || 0,
        vat_amount:       vatAmt,
        total_cost:       totalLine,
        foreign_currency: item.foreignCurrency || null,
        foreign_amount:   item.foreignAmount   || null,
      })
    }
    const totalCost = netCost + inputVat

    // Replace all items atomically
    await admin.from('grn_items').delete().eq('grn_id', grnId)
    const { error: itemsErr } = await admin.from('grn_items').insert(rows)
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })

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
        const { data: product } = await admin.from('products').select('quantity').eq('id', item.product_id).single()
        if (product) {
          await admin.from('products').update({ quantity: Math.max(0, (product.quantity || 0) - item.quantity) }).eq('id', item.product_id)
        }
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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
