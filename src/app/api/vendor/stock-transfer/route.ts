import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustProductQuantity } from '@/lib/stock'

/**
 * Transfers are restricted to linked shops — vendors owned by the source shop's
 * owner, or that the calling user owns / is active staff of. Without this, ANY
 * approved marketplace vendor could create products in (and reprice) another
 * tenant's catalog.
 */
async function getLinkedVendors(admin: ReturnType<typeof createAdminClient>, sourceVendor: any, userId: string) {
  const [bySourceOwner, byCallerOwner, byStaff] = await Promise.all([
    admin.from('vendors').select('id, name').eq('status', 'approved').eq('user_id', sourceVendor.user_id),
    admin.from('vendors').select('id, name').eq('status', 'approved').eq('user_id', userId),
    admin.from('vendor_staff').select('vendor:vendors(id, name, status)').eq('user_id', userId).eq('active', true),
  ])
  const map = new Map<string, { id: string; name: string }>()
  for (const v of (bySourceOwner.data || [])) map.set(v.id, v)
  for (const v of (byCallerOwner.data || [])) map.set(v.id, v)
  for (const row of (byStaff.data || []) as any[]) {
    const v = row.vendor
    if (v && v.status === 'approved') map.set(v.id, { id: v.id, name: v.name })
  }
  map.delete(sourceVendor.id)
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

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

  // ── List sibling shops (same owner) as transfer destinations ──────────────
  if (action === 'list_vendors') {
    const vendors = await getLinkedVendors(admin, vendor, userId)
    return NextResponse.json({ vendors })
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

    const destVendor = (await getLinkedVendors(admin, vendor, userId)).find(v => v.id === toVendorId)
    if (!destVendor) return NextResponse.json({ success: false, error: 'Destination must be one of your own shops' }, { status: 403 })

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

    const destVendor = (await getLinkedVendors(admin, vendor, userId)).find(v => v.id === toVendorId)
    if (!destVendor) return NextResponse.json({ success: false, error: 'Destination must be one of your own shops' }, { status: 403 })

    // Aggregate duplicate rows for the same product — processing them separately
    // would credit the destination twice while only the last source overwrite
    // sticks (minting stock), and lets two individually-valid rows jointly
    // exceed available stock.
    const aggregated = new Map<string, { fromProductId: string; quantity: number; transferCost?: number; transferPrice?: number; notes?: string }>()
    for (const item of items) {
      const q = Number(item.quantity)
      if (!Number.isInteger(q) || q < 1)
        return NextResponse.json({ success: false, error: 'Quantities must be whole numbers of at least 1' }, { status: 400 })
      const existing = aggregated.get(item.fromProductId)
      if (existing) existing.quantity += q
      else aggregated.set(item.fromProductId, { ...item, quantity: q })
    }

    const productIds = [...aggregated.keys()]
    const { data: sourceProducts } = await admin.from('products').select('*').eq('vendor_id', vendor.id).in('id', productIds)
    const sourceMap = new Map((sourceProducts || []).map((p: any) => [p.id, p]))

    const transferRecords: any[] = []
    const errors: string[] = []

    for (const item of aggregated.values()) {
      const src = sourceMap.get(item.fromProductId)
      if (!src) { errors.push(`Product ${item.fromProductId} not found`); continue }
      if (item.quantity > src.quantity) { errors.push(`${src.name}: insufficient stock`); continue }

      // Claim source stock FIRST with an optimistic conditional update —
      // a POS sale landing mid-transfer would otherwise be silently erased
      // by a blind overwrite.
      const { data: claimed } = await admin.from('products')
        .update({ quantity: src.quantity - item.quantity })
        .eq('id', src.id).eq('vendor_id', vendor.id)
        .eq('quantity', src.quantity)
        .select('id')
      if (!claimed || claimed.length === 0) {
        errors.push(`${src.name}: stock changed during transfer — please retry`)
        continue
      }

      // Move FIFO cost out of the source so costing stays truthful on both sides
      let movedUnitCost: number | null = item.transferCost != null ? Math.round(item.transferCost) : null
      const { data: consumedCost } = await admin.rpc('consume_fifo_cost', {
        p_vendor_id: vendor.id, p_product_id: src.id, p_quantity: item.quantity,
      })
      if (movedUnitCost == null && consumedCost && consumedCost > 0) {
        movedUnitCost = Math.round(consumedCost / item.quantity)
      }
      if (movedUnitCost == null && parseInt(src.cost || 0) > 0) movedUnitCost = parseInt(src.cost)

      // Check if SKU already exists at destination
      const { data: destExisting } = await admin.from('products').select('id, quantity').eq('vendor_id', toVendorId).eq('sku', src.sku).maybeSingle()

      let destProductId: string
      let destProductName: string

      if (destExisting) {
        // Atomic increment at destination + optionally update cost/price
        await adjustProductQuantity(admin, destExisting.id, toVendorId, item.quantity)
        const destUpdate: any = {}
        if (item.transferCost  != null) destUpdate.cost  = item.transferCost
        if (item.transferPrice != null) destUpdate.price = item.transferPrice
        if (Object.keys(destUpdate).length > 0) {
          await admin.from('products').update(destUpdate).eq('id', destExisting.id).eq('vendor_id', toVendorId)
        }
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
        if (createErr || !created) {
          // Roll the source stock back — nothing arrived at the destination
          await adjustProductQuantity(admin, src.id, vendor.id, item.quantity)
          if (movedUnitCost != null && movedUnitCost > 0) {
            await admin.rpc('restore_fifo_cost', {
              p_vendor_id: vendor.id, p_product_id: src.id,
              p_quantity: item.quantity, p_unit_cost: movedUnitCost,
              p_received_at: new Date().toISOString().slice(0, 10),
            })
          }
          errors.push(`Failed to create ${src.name} at destination: ${createErr?.message}`)
          continue
        }
        destProductId   = created.id
        destProductName = created.name
      }

      // Seed the destination's FIFO layer with the moved cost
      if (movedUnitCost != null && movedUnitCost > 0) {
        await admin.rpc('restore_fifo_cost', {
          p_vendor_id: toVendorId, p_product_id: destProductId,
          p_quantity: item.quantity, p_unit_cost: movedUnitCost,
          p_received_at: new Date().toISOString().slice(0, 10),
        })
      }

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
      const { error: historyError } = await admin.from('stock_transfers').insert(transferRecords)
      if (historyError) errors.push('Transfer completed but the history record failed to save: ' + historyError.message)
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
