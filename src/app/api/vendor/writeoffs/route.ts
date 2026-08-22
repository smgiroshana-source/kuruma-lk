import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustProductQuantity } from '@/lib/stock'

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

const ALLOWED_REASONS = ['damaged', 'expired', 'lost', 'theft', 'other'] as const
type WriteoffReason = typeof ALLOWED_REASONS[number]

// ── GET — list write-offs ─────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor } = auth

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status') // 'draft' | 'posted' | null = all

  const admin = createAdminClient()
  let query = admin
    .from('stock_writeoffs')
    .select('*')
    .eq('vendor_id', vendor.id)
    .order('writeoff_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const writeoffs = data || []

  // Fetch item counts per writeoff (same aggregation pattern as suppliers route)
  const ids = writeoffs.map((w: any) => w.id)
  let countMap: Record<string, number> = {}
  if (ids.length > 0) {
    const { data: itemRows } = await admin
      .from('stock_writeoff_items')
      .select('writeoff_id')
      .in('writeoff_id', ids)

    for (const row of itemRows || []) {
      countMap[row.writeoff_id] = (countMap[row.writeoff_id] ?? 0) + 1
    }
  }

  const result = writeoffs.map((w: any) => ({
    ...w,
    items_count: countMap[w.id] ?? 0,
  }))

  return NextResponse.json({ writeoffs: result })
}

// ── POST — create / post / delete ────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { vendor, userId } = auth

  const body = await req.json()
  const { action } = body as { action: string }
  const admin = createAdminClient()

  // ── CREATE ──────────────────────────────────────────────────────────────────
  if (action === 'create') {
    const {
      writeoff_date,
      reason,
      notes,
      items,
    } = body as {
      writeoff_date: string
      reason: WriteoffReason
      notes?: string
      items: Array<{
        product_id: string
        product_sku: string
        product_name: string
        quantity: number
        unit_cost: number
      }>
    }

    if (!writeoff_date) return NextResponse.json({ error: 'writeoff_date required' }, { status: 400 })
    if (!reason || !ALLOWED_REASONS.includes(reason)) {
      return NextResponse.json({ error: `reason must be one of: ${ALLOWED_REASONS.join(', ')}` }, { status: 400 })
    }
    if (!items || items.length === 0) return NextResponse.json({ error: 'At least one item required' }, { status: 400 })

    // Compute line totals and validate
    const itemRows: Array<{
      product_id: string
      product_sku: string
      product_name: string
      quantity: number
      unit_cost: number
      total_cost: number
    }> = []
    let total_cost_sum = 0

    for (const item of items) {
      if (!item.product_id) return NextResponse.json({ error: 'Each item must have a product_id' }, { status: 400 })
      if (!item.quantity || item.quantity < 1) return NextResponse.json({ error: 'Item quantity must be ≥ 1' }, { status: 400 })
      if (item.unit_cost == null || item.unit_cost < 0) return NextResponse.json({ error: 'Item unit_cost must be ≥ 0' }, { status: 400 })
      const total_cost = item.quantity * item.unit_cost
      total_cost_sum += total_cost
      itemRows.push({
        product_id: item.product_id,
        product_sku: item.product_sku,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_cost: item.unit_cost,
        total_cost,
      })
    }

    // Auto-generate writeoff_no: WO-YYMM-NNNN
    const now = new Date()
    const yy = String(now.getUTCFullYear()).slice(2)
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const prefix = `WO-${yy}${mm}-`

    const { data: lastWriteoff } = await admin
      .from('stock_writeoffs')
      .select('writeoff_no')
      .eq('vendor_id', vendor.id)
      .like('writeoff_no', `${prefix}%`)
      .order('writeoff_no', { ascending: false })
      .limit(1)
      .single()

    const nextNum = lastWriteoff
      ? parseInt(lastWriteoff.writeoff_no.slice(prefix.length), 10) + 1
      : 1
    const writeoff_no = `${prefix}${String(nextNum).padStart(4, '0')}`

    // Insert stock_writeoffs header
    const { data: wo, error: woErr } = await admin
      .from('stock_writeoffs')
      .insert({
        vendor_id: vendor.id,
        writeoff_no,
        writeoff_date,
        reason,
        notes: notes ?? null,
        total_cost: total_cost_sum,
        status: 'draft',
        created_by: userId,
      })
      .select('id, writeoff_no')
      .single()

    if (woErr) return NextResponse.json({ error: woErr.message }, { status: 500 })

    // Insert line items
    const { error: itemsErr } = await admin
      .from('stock_writeoff_items')
      .insert(itemRows.map(r => ({ ...r, writeoff_id: wo.id })))

    if (itemsErr) {
      // Roll back header on items failure
      await admin.from('stock_writeoffs').delete().eq('id', wo.id)
      return NextResponse.json({ error: itemsErr.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, writeoff: { id: wo.id, writeoff_no: wo.writeoff_no } })
  }

  // ── POST (post a draft) ─────────────────────────────────────────────────────
  if (action === 'post') {
    const { writeoffId } = body as { writeoffId: string }
    if (!writeoffId) return NextResponse.json({ error: 'writeoffId required' }, { status: 400 })

    // Fetch write-off + items, scoped to this vendor
    const { data: wo } = await admin
      .from('stock_writeoffs')
      .select('*, items:stock_writeoff_items(*)')
      .eq('id', writeoffId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!wo) return NextResponse.json({ error: 'Write-off not found' }, { status: 404 })
    if (wo.status !== 'draft') return NextResponse.json({ error: 'Only draft write-offs can be posted' }, { status: 400 })

    const items: Array<{
      id: string
      product_id: string
      product_sku: string
      product_name: string
      quantity: number
      unit_cost: number
      total_cost: number
    }> = wo.items || []

    if (items.length === 0) return NextResponse.json({ error: 'Write-off has no items' }, { status: 400 })

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
          { error: `Product "${item.product_name}" not found` },
          { status: 400 }
        )
      }

      const newQty = product.quantity - item.quantity
      if (newQty < 0) {
        return NextResponse.json(
          { error: `Insufficient stock for "${item.product_name}" — available: ${product.quantity}, writing off: ${item.quantity}` },
          { status: 400 }
        )
      }

      // Atomic RPC, not a read-then-write: a POS sale landing between the read
      // above and the write would otherwise be erased by a blind overwrite.
      await adjustProductQuantity(admin, item.product_id, vendor.id, -item.quantity)

      // Take the cost out of the FIFO layers too. Without this the goods leave
      // the shelf but their cost stays in stock valuation, and the next sale
      // draws cost from a layer that should already have been used up — the
      // loss silently becomes some future sale's COGS.
      await admin.rpc('consume_fifo_cost', {
        p_vendor_id: vendor.id, p_product_id: item.product_id, p_quantity: item.quantity,
      })

      // Log stock movement
      const { error: movErr } = await admin.from('stock_movements').insert({
        vendor_id: vendor.id,
        product_id: item.product_id,
        product_sku: item.product_sku,
        movement_type: 'writeoff',
        quantity_change: -item.quantity,
        quantity_before: product.quantity,
        quantity_after: newQty,
        reference_id: wo.id,
        reference_type: 'writeoff',
        notes: wo.reason,
        created_by: userId,
      })

      if (movErr) return NextResponse.json({ error: movErr.message }, { status: 500 })
    }

    // Mark write-off as posted
    const { error: postErr } = await admin
      .from('stock_writeoffs')
      .update({ status: 'posted', posted_by: userId, posted_at: new Date().toISOString() })
      .eq('id', writeoffId)

    if (postErr) return NextResponse.json({ error: postErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  }

  // ── DELETE ──────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { writeoffId } = body as { writeoffId: string }
    if (!writeoffId) return NextResponse.json({ error: 'writeoffId required' }, { status: 400 })

    const { data: wo } = await admin
      .from('stock_writeoffs')
      .select('status, writeoff_no')
      .eq('id', writeoffId)
      .eq('vendor_id', vendor.id)
      .single()

    if (!wo) return NextResponse.json({ error: 'Write-off not found' }, { status: 404 })
    if (wo.status !== 'draft') return NextResponse.json({ error: 'Only draft write-offs can be deleted' }, { status: 400 })

    // Items cascade-deleted via ON DELETE CASCADE
    const { error: delErr } = await admin
      .from('stock_writeoffs')
      .delete()
      .eq('id', writeoffId)
      .eq('vendor_id', vendor.id)

    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
