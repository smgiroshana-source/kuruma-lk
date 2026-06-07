import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
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
export async function GET(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor, userId } = auth
  const admin = createAdminClient()
  const action = req.nextUrl.searchParams.get('action')

  // ── List other approved vendors ───────────────────────────────────────────
  if (action === 'list_vendors') {
    const { data: vendors } = await admin
      .from('vendors')
      .select('id, name')
      .eq('status', 'approved')
      .neq('id', vendor.id)
      .order('name')
    return NextResponse.json({ vendors: vendors || [] })
  }

  // ── Transfer history (sent from this vendor) ──────────────────────────────
  if (action === 'history') {
    const { data: transfers } = await admin
      .from('stock_transfers')
      .select(`
        id, from_product_name, from_product_sku, to_product_name,
        quantity, transfer_cost, transfer_price, notes, transferred_at,
        to_vendor:vendors!stock_transfers_to_vendor_id_fkey(name)
      `)
      .eq('from_vendor_id', vendor.id)
      .order('transferred_at', { ascending: false })
      .limit(50)
    return NextResponse.json({ transfers: transfers || [] })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ─── POST ─────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const auth = await getVendor()
  if (!auth) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })
  const { vendor, userId } = auth
  const admin = createAdminClient()
  const body = await req.json()
  const { action } = body

  // ── PREVIEW — validate items without executing ────────────────────────────
  if (action === 'preview') {
    const { toVendorId, items } = body as {
      toVendorId: string
      items: Array<{ fromProductId: string; quantity: number; transferCost?: number; transferPrice?: number; notes?: string }>
    }
    if (!toVendorId || !items?.length)
      return NextResponse.json({ success: false, error: 'toVendorId and items required' }, { status: 400 })

    const { data: destVendor } = await admin.from('vendors').select('id, name').eq('id', toVendorId).eq('status', 'approved').single()
    if (!destVendor) return NextResponse.json({ success: false, error: 'Destination vendor not found' }, { status: 404 })

    const productIds = items.map(i => i.fromProductId)
    const { data: sourceProducts } = await admin.from('products').select('*').eq('vendor_id', vendor.id).in('id', productIds)
    const sourceMap = new Map((sourceProducts || []).map((p: any) => [p.id, p]))

    const previews = await Promise.all(items.map(async (item) => {
      const src = sourceMap.get(item.fromProductId)
      if (!src) return { ...item, fromProductName: '?', fromProductSku: '?', fromProductQty: 0, error: 'Product not found in your inventory' }
      if (item.quantity < 1) return { ...item, fromProductName: src.name, fromProductSku: src.sku, fromProductQty: src.quantity, error: 'Quantity must be at least 1' }
      if (item.quantity > src.quantity) return { ...item, fromProductName: src.name, fromProductSku: src.sku, fromProductQty: src.quantity, error: `Insufficient stock — only ${src.quantity} available` }

      const { data: destProduct } = await admin.from('products').select('id, name, quantity').eq('vendor_id', toVendorId).eq('sku', src.sku).maybeSingle()
      return {
        fromProductId: item.fromProductId,
        fromProductName: src.name,
        fromProductSku: src.sku,
        fromProductQty: src.quantity,
        quantity: item.quantity,
        transferCost: item.transferCost ?? null,
        transferPrice: item.transferPrice ?? null,
        notes: item.notes ?? '',
        destProduct: destProduct || null,
        willCreate: !destProduct,
        error: null,
      }
    }))

    return NextResponse.json({ success: true, previews, destVendorName: destVendor.name })
  }

  // ── EXECUTE ───────────────────────────────────────────────────────────────
  if (action === 'execute') {
    const { toVendorId, items } = body as {
      toVendorId: string
      items: Array<{ fromProductId: string; quantity: number; transferCost?: number; transferPrice?: number; notes?: string }>
    }
    if (!toVendorId || !items?.length)
      return NextResponse.json({ success: false, error: 'toVendorId and items required' }, { status: 400 })

    const { data: destVendor } = await admin.from('vendors').select('id, name').eq('id', toVendorId).eq('status', 'approved').single()
    if (!destVendor) return NextResponse.json({ success: false, error: 'Destination vendor not found' }, { status: 404 })

    const productIds = items.map(i => i.fromProductId)
    const { data: sourceProducts } = await admin.from('products').select('*').eq('vendor_id', vendor.id).in('id', productIds)
    const sourceMap = new Map((sourceProducts || []).map((p: any) => [p.id, p]))

    const transferRecords: any[] = []
    const errors: string[] = []

    for (const item of items) {
      const src = sourceMap.get(item.fromProductId)
      if (!src) { errors.push(`Product ${item.fromProductId} not found`); continue }
      if (item.quantity > src.quantity) { errors.push(`${src.name}: insufficient stock`); continue }

      // Check if SKU already exists at destination
      const { data: destExisting } = await admin.from('products').select('id, quantity').eq('vendor_id', toVendorId).eq('sku', src.sku).maybeSingle()

      let destProductId: string
      let destProductName: string

      if (destExisting) {
        // Update quantity + optionally cost/price at destination
        const destUpdate: any = { quantity: destExisting.quantity + item.quantity }
        if (item.transferCost)  destUpdate.cost  = item.transferCost
        if (item.transferPrice) destUpdate.price = item.transferPrice
        await admin.from('products').update(destUpdate).eq('id', destExisting.id)
        destProductId   = destExisting.id
        destProductName = src.name
      } else {
        // Create new product at destination — copy all fields, override vendor + qty + cost/price
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id: _id, vendor_id: _vid, created_at: _ca, updated_at: _ua, slug: _sl, ...srcFields } = src
        const { data: created, error: createErr } = await admin.from('products').insert({
          ...srcFields,
          vendor_id:  toVendorId,
          quantity:   item.quantity,
          cost:       item.transferCost  ?? src.cost,
          price:      item.transferPrice ?? src.price,
          is_active:  true,
          slug: null,    // will be regenerated on next product fetch
        }).select('id, name').single()
        if (createErr || !created) { errors.push(`Failed to create ${src.name} at destination: ${createErr?.message}`); continue }
        destProductId   = created.id
        destProductName = created.name
      }

      // Deduct from source
      await admin.from('products').update({ quantity: src.quantity - item.quantity }).eq('id', src.id)

      transferRecords.push({
        from_vendor_id:   vendor.id,
        from_product_id:  src.id,
        from_product_sku: src.sku,
        from_product_name: src.name,
        to_vendor_id:     toVendorId,
        to_product_id:    destProductId,
        to_product_name:  destProductName,
        quantity:         item.quantity,
        transfer_cost:    item.transferCost  ?? null,
        transfer_price:   item.transferPrice ?? null,
        notes:            item.notes ?? null,
        transferred_by:   userId,
      })
    }

    if (transferRecords.length > 0) {
      await admin.from('stock_transfers').insert(transferRecords)
      revalidatePath('/')
    }

    if (errors.length > 0 && transferRecords.length === 0)
      return NextResponse.json({ success: false, error: errors.join('; ') }, { status: 400 })

    return NextResponse.json({
      success: true,
      transferred: transferRecords.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `${transferRecords.length} product${transferRecords.length !== 1 ? 's' : ''} transferred to ${destVendor.name}`,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
