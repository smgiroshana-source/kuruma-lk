import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

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

      // Update product quantity
      const { error: updateErr } = await admin
        .from('products')
        .update({ quantity: newQty })
        .eq('id', item.product_id)

      if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

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
      .update({ status: 'confirmed' })
      .eq('id', returnId)

    if (confirmErr) return NextResponse.json({ error: confirmErr.message }, { status: 500 })

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
