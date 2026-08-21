import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { adjustProductQuantity } from '@/lib/stock'
import { generateProductSlug } from '@/lib/slug'

/**
 * Transfers are restricted to linked shops — vendors owned by the source shop's
 * owner, or that the calling user owns / is active staff of. Without this, ANY
 * approved marketplace vendor could create products in (and reprice) another
 * tenant's catalog.
 */
async function getLinkedVendors(admin: ReturnType<typeof createAdminClient>, sourceVendor: any, userId: string) {
  const [bySourceOwner, byCallerOwner, byStaff, byLink] = await Promise.all([
    admin.from('vendors').select('id, name').eq('status', 'approved').eq('user_id', sourceVendor.user_id),
    admin.from('vendors').select('id, name').eq('status', 'approved').eq('user_id', userId),
    admin.from('vendor_staff').select('vendor:vendors(id, name, status)').eq('user_id', userId).eq('active', true),
    // Explicit links: two shops that are the same business but registered
    // under different logins (WHEEL MART ↔ Sakura). Mutual — one row works
    // both ways, so check the pairing from either side.
    admin.from('vendor_transfer_links')
      .select('a:vendors!vendor_transfer_links_vendor_id_fkey(id, name, status), b:vendors!vendor_transfer_links_linked_vendor_id_fkey(id, name, status)')
      .or(`vendor_id.eq.${sourceVendor.id},linked_vendor_id.eq.${sourceVendor.id}`),
  ])
  const map = new Map<string, { id: string; name: string }>()
  for (const v of (bySourceOwner.data || [])) map.set(v.id, v)
  for (const v of (byCallerOwner.data || [])) map.set(v.id, v)
  for (const row of (byStaff.data || []) as any[]) {
    const v = row.vendor
    if (v && v.status === 'approved') map.set(v.id, { id: v.id, name: v.name })
  }
  for (const row of (byLink.data || []) as any[]) {
    for (const v of [row.a, row.b]) {
      if (v && v.status === 'approved') map.set(v.id, { id: v.id, name: v.name })
    }
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

// Moving stock out of the shop (and overwriting cost/price at the destination)
// is an owner/manager action — cashier staff are limited to the POS.
async function callerMayTransfer(admin: ReturnType<typeof createAdminClient>, vendor: any, userId: string): Promise<boolean> {
  if (vendor.user_id === userId) return true // shop owner
  const { data: staff } = await admin.from('vendor_staff')
    .select('role').eq('vendor_id', vendor.id).eq('user_id', userId).eq('active', true).maybeSingle()
  return !!staff && staff.role !== 'cashier'
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

  if ((action === 'preview' || action === 'execute') && !(await callerMayTransfer(admin, vendor, userId))) {
    return NextResponse.json({ success: false, error: 'Stock transfers require owner or manager access' }, { status: 403 })
  }

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
      // Cost/price overwrite the destination product — negative or NaN values
      // must never land there.
      for (const k of ['transferCost', 'transferPrice'] as const) {
        if (item[k] != null && (!Number.isFinite(Number(item[k])) || Number(item[k]) < 0))
          return NextResponse.json({ success: false, error: 'Transfer cost/price must be zero or positive' }, { status: 400 })
      }
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
        // Real slug at creation (nothing "regenerates" null slugs later — that
        // assumption published UUID-only URLs). slug-sku on collision, like the
        // products create path.
        let destSlug = generateProductSlug(src.name, src.make, src.model, src.condition)
        const { data: slugTaken } = await admin.from('products').select('id').eq('slug', destSlug).maybeSingle()
        if (slugTaken) destSlug = `${destSlug}-${(src.sku || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`
        const { data: created, error: createErr } = await admin.from('products').insert({
          ...srcFields,
          vendor_id:  toVendorId,
          quantity:   item.quantity,
          cost:       item.transferCost  ?? src.cost,
          price:      item.transferPrice ?? src.price,
          is_active:  true,
          slug: destSlug,
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
          // A raw Postgres constraint name tells the operator nothing about
          // what to do next — say which field clashed and with what.
          const msg = /products_vendor_sku_key|products_sku_key/.test(createErr?.message || '')
            ? `${src.name}: SKU ${src.sku} is already used by another product at the destination shop — give one of them a different SKU.`
            : /products_slug_key|slug/.test(createErr?.message || '')
              ? `${src.name}: the destination already lists a product under the same web address. Rename it slightly and try again.`
              : `Failed to create ${src.name} at destination: ${createErr?.message}`
          errors.push(msg)
          continue
        }
        destProductId   = created.id
        destProductName = created.name

        // Photos live in product_images, not on the product row — copy the
        // references so the product doesn't arrive photo-less. Best-effort:
        // a failure here shouldn't undo a completed stock move.
        const { data: srcImages } = await admin.from('product_images')
          .select('url, sort_order').eq('product_id', src.id).order('sort_order')
        if (srcImages && srcImages.length > 0) {
          await admin.from('product_images').insert(
            srcImages.map((img: any) => ({ product_id: created.id, url: img.url, sort_order: img.sort_order }))
          )
        }
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
