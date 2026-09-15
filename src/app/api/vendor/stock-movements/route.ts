import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { netStockCost } from '@/lib/netCost'

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
  const date = req.nextUrl.searchParams.get('date')
  // Report mode: one Colombo day (?date=) or a range (?from=&to=), for the
  // daily report, the period Sales Report and the dashboard.
  const isDay = (s: string | null): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const rangeFrom = isDay(date) ? date : req.nextUrl.searchParams.get('from')
  const rangeTo = isDay(date) ? date : req.nextUrl.searchParams.get('to')

  // Every ADJUSTMENT in the window, with the product name attached — recounts,
  // initial stock and corrections are part of the period's story.
  if (!productId && isDay(rangeFrom) && isDay(rangeTo)) {
    const fromTs = new Date(rangeFrom + 'T00:00:00+05:30').toISOString()
    const toTs = new Date(rangeTo + 'T23:59:59.999+05:30').toISOString()
    const { data: adj, error: adjErr } = await admin
      .from('stock_movements')
      .select('*, product:products(name, product_type, cost, cost_includes_vat)')
      .eq('vendor_id', vendor.id)
      .eq('movement_type', 'adjustment')
      .gte('created_at', fromTs)
      .lte('created_at', toTs)
      .order('created_at')
    if (adjErr) return NextResponse.json({ error: adjErr.message }, { status: 500 })
    // Name who did it: the report is read by the owner, and "3 → 1" means
    // little without a name beside it.
    const ids = Array.from(new Set((adj || []).map((m: any) => m.created_by).filter(Boolean)))
    const names = new Map<string, string>()
    if (ids.length > 0) {
      const { data: staff } = await admin.from('vendor_staff').select('user_id, name').eq('vendor_id', vendor.id).in('user_id', ids)
      for (const s of staff || []) if (s.user_id) names.set(s.user_id, s.name || 'Staff')
      if (vendor.user_id && ids.includes(vendor.user_id)) names.set(vendor.user_id, 'Owner')
    }
    // Value each correction at the product's net cost so a month of small
    // "miscounted" drops can be read as one rupee figure.
    const movements = (adj || []).map((m: any) => ({
      ...m,
      by_name: m.created_by ? (names.get(m.created_by) || 'Unknown') : null,
      value: Math.abs(Number(m.quantity_change) || 0) * netStockCost(m.product?.cost, m.product),
    }))
    const summary = movements.reduce((s: any, m: any) => {
      const q = Number(m.quantity_change) || 0
      if (q < 0) { s.downCount++; s.downUnits += -q; s.downValue += m.value } else if (q > 0) { s.upCount++; s.upUnits += q; s.upValue += m.value }
      return s
    }, { downCount: 0, downUnits: 0, downValue: 0, upCount: 0, upUnits: 0, upValue: 0 })
    return NextResponse.json({ movements, summary })
  }

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
