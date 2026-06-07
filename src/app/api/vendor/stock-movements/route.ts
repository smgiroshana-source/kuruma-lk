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

// ─── GET ──────────────────────────────────────────────────────────────────────
// GET ?product_id=UUID — returns last 50 movements for that product for this vendor
export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor } = auth
  const admin = createAdminClient()

  const productId = req.nextUrl.searchParams.get('product_id')
  if (!productId) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
  }

  const { data: movements, error } = await admin
    .from('stock_movements')
    .select('*')
    .eq('vendor_id', vendor.id)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ movements: movements || [] })
}

// ─── POST ─────────────────────────────────────────────────────────────────────
// POST { action: 'log', ...fields }   — insert one movement row
// POST { action: 'log_bulk', movements: [...] } — insert multiple rows (e.g. GRN with many items)
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor, userId } = auth
  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  // ── LOG SINGLE MOVEMENT ───────────────────────────────────────────────────
  if (action === 'log') {
    const {
      product_id,
      product_sku,
      movement_type,
      quantity_change,
      quantity_before,
      quantity_after,
      reference_id,
      reference_type,
      notes,
    } = body as {
      product_id: string
      product_sku: string
      movement_type: 'grn_receive' | 'sale' | 'return_in' | 'return_out' | 'transfer_out' | 'transfer_in' | 'writeoff' | 'adjustment'
      quantity_change: number
      quantity_before: number
      quantity_after: number
      reference_id?: string
      reference_type?: string
      notes?: string
    }

    if (!product_id || !product_sku || !movement_type || quantity_change === undefined || quantity_before === undefined || quantity_after === undefined) {
      return NextResponse.json(
        { error: 'product_id, product_sku, movement_type, quantity_change, quantity_before, quantity_after are required' },
        { status: 400 }
      )
    }

    const { error } = await admin.from('stock_movements').insert({
      vendor_id: vendor.id,
      product_id,
      product_sku,
      movement_type,
      quantity_change,
      quantity_before,
      quantity_after,
      reference_id: reference_id ?? null,
      reference_type: reference_type ?? null,
      notes: notes ?? null,
      created_by: userId,
    })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  }

  // ── LOG BULK MOVEMENTS ────────────────────────────────────────────────────
  if (action === 'log_bulk') {
    const { movements } = body as {
      movements: Array<{
        product_id: string
        product_sku: string
        movement_type: 'grn_receive' | 'sale' | 'return_in' | 'return_out' | 'transfer_out' | 'transfer_in' | 'writeoff' | 'adjustment'
        quantity_change: number
        quantity_before: number
        quantity_after: number
        reference_id?: string
        reference_type?: string
        notes?: string
      }>
    }

    if (!movements?.length) {
      return NextResponse.json({ error: 'movements array is required and must not be empty' }, { status: 400 })
    }

    const rows = movements.map((m) => ({
      vendor_id: vendor.id,
      product_id: m.product_id,
      product_sku: m.product_sku,
      movement_type: m.movement_type,
      quantity_change: m.quantity_change,
      quantity_before: m.quantity_before,
      quantity_after: m.quantity_after,
      reference_id: m.reference_id ?? null,
      reference_type: m.reference_type ?? null,
      notes: m.notes ?? null,
      created_by: userId,
    }))

    const { error } = await admin.from('stock_movements').insert(rows)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
