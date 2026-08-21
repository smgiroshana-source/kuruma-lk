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

/**
 * Put an in-transit line onto the receiving shop's shelf. Runs at ACCEPT time,
 * which may be days after the send, so it works entirely from the snapshot
 * taken when the goods left — not from the source product, which may have been
 * edited or removed since.
 */
async function landAtDestination(
  admin: ReturnType<typeof createAdminClient>,
  row: any,
): Promise<{ productId: string; productName: string; error?: undefined } | { error: string; productId?: undefined; productName?: undefined }> {
  const toVendorId = row.to_vendor_id
  const sku = row.from_product_sku
  const qty = row.quantity
  const snap = row.product_snapshot || {}

  const { data: destExisting } = await admin.from('products')
    .select('id, quantity').eq('vendor_id', toVendorId).eq('sku', sku).maybeSingle()

  if (destExisting) {
    await adjustProductQuantity(admin, destExisting.id, toVendorId, qty)
    const destUpdate: any = {}
    if (row.transfer_cost  != null) destUpdate.cost  = row.transfer_cost
    if (row.transfer_price != null) destUpdate.price = row.transfer_price
    if (Object.keys(destUpdate).length > 0) {
      await admin.from('products').update(destUpdate).eq('id', destExisting.id).eq('vendor_id', toVendorId)
    }
    return { productId: destExisting.id as string, productName: row.from_product_name as string }
  }

  const { images, ...fields } = snap
  // Real slug at creation (nothing "regenerates" null slugs later — that
  // assumption published UUID-only URLs). slug-sku on collision, like the
  // products create path.
  let destSlug = generateProductSlug(fields.name, fields.make, fields.model, fields.condition)
  const { data: slugTaken } = await admin.from('products').select('id').eq('slug', destSlug).maybeSingle()
  if (slugTaken) destSlug = `${destSlug}-${(sku || '').toLowerCase().replace(/[^a-z0-9]/g, '-')}`

  const { data: created, error: createErr } = await admin.from('products').insert({
    ...fields,
    vendor_id: toVendorId,
    quantity:  qty,
    cost:      row.transfer_cost  ?? fields.cost,
    price:     row.transfer_price ?? fields.price,
    is_active: true,
    slug: destSlug,
  }).select('id, name').single()

  if (createErr || !created) {
    // A raw Postgres constraint name tells the operator nothing about what to
    // do next. A SKU clash has two very different causes, so check which one
    // it is rather than guessing.
    let msg = `Could not add ${row.from_product_name}: ${createErr?.message}`
    if (/sku/i.test(createErr?.message || '')) {
      const { data: holder } = await admin.from('products')
        .select('id, name').eq('vendor_id', toVendorId).eq('sku', sku).maybeSingle()
      msg = holder
        ? `${row.from_product_name}: you already list "${holder.name}" under SKU ${sku} — give one of them a different SKU.`
        : `${row.from_product_name}: the database still requires every SKU to be unique across ALL shops, so ${sku} can't exist in two places at once. Run supabase-product-sku-per-vendor.sql.`
    } else if (/slug/i.test(createErr?.message || '')) {
      msg = `${row.from_product_name}: you already list a product under the same web address. Rename it slightly and try again.`
    }
    return { error: msg }
  }

  // Photos live in product_images, not on the product row — copy the
  // references so the product doesn't arrive photo-less. Best-effort: a
  // failure here shouldn't undo a completed stock move.
  if (Array.isArray(images) && images.length > 0) {
    await admin.from('product_images').insert(
      images.map((img: any) => ({ product_id: created.id, url: img.url, sort_order: img.sort_order }))
    )
  }
  return { productId: created.id as string, productName: created.name as string }
}

/** Send an in-transit line back to where it came from, cost layer intact. */
async function returnToSender(admin: ReturnType<typeof createAdminClient>, row: any) {
  await adjustProductQuantity(admin, row.from_product_id, row.from_vendor_id, row.quantity)
  if (row.moved_unit_cost != null && row.moved_unit_cost > 0) {
    await admin.rpc('restore_fifo_cost', {
      p_vendor_id: row.from_vendor_id, p_product_id: row.from_product_id,
      p_quantity: row.quantity, p_unit_cost: row.moved_unit_cost,
      p_received_at: new Date().toISOString().slice(0, 10),
    })
  }
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
        id, batch_id, status, from_product_name, from_product_sku, to_product_name,
        quantity, transfer_cost, transfer_price, notes, transferred_at,
        accepted_at, rejected_at, reject_reason,
        to_vendor:vendors!stock_transfers_to_vendor_id_fkey(name)
      `)
      .eq('from_vendor_id', vendor.id)
      .order('transferred_at', { ascending: false })
      .limit(50)
    return NextResponse.json({ transfers: transfers || [] })
  }

  // ── Incoming shipments (sent TO this vendor) ──────────────────────────────
  // Grouped into the boxes they were sent as — the receiver answers a
  // shipment, not a line.
  if (action === 'incoming') {
    const { data: rows, error } = await admin
      .from('stock_transfers')
      .select(`
        id, batch_id, status, from_product_name, from_product_sku,
        quantity, transfer_cost, transfer_price, notes, transferred_at,
        accepted_at, rejected_at, reject_reason,
        from_vendor:vendors!stock_transfers_from_vendor_id_fkey(name)
      `)
      .eq('to_vendor_id', vendor.id)
      .order('transferred_at', { ascending: false })
      .limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const batches = new Map<string, any>()
    for (const r of (rows || []) as any[]) {
      // batch_id is null on anything written before shipments existed — those
      // rows stand alone rather than collapsing into one giant fake box.
      const key = r.batch_id || `single:${r.id}`
      let b = batches.get(key)
      if (!b) {
        b = {
          key, batchId: r.batch_id, status: r.status,
          fromVendor: r.from_vendor?.name || 'Another shop',
          sentAt: r.transferred_at,
          settledAt: r.accepted_at || r.rejected_at || null,
          rejectReason: r.reject_reason || null,
          items: [], totalUnits: 0,
        }
        batches.set(key, b)
      }
      b.items.push({
        id: r.id, name: r.from_product_name, sku: r.from_product_sku,
        quantity: r.quantity, transferCost: r.transfer_cost,
        transferPrice: r.transfer_price, notes: r.notes,
      })
      b.totalUnits += r.quantity
    }

    const all = [...batches.values()]
    return NextResponse.json({
      pending: all.filter(b => b.status === 'pending'),
      recent:  all.filter(b => b.status !== 'pending').slice(0, 20),
      pendingCount: all.filter(b => b.status === 'pending').length,
    })
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

    // One send is one physical box; the receiver accepts the box, not each
    // line in it.
    const batchId = crypto.randomUUID()
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

      // Nothing is written to the destination yet. The goods are IN TRANSIT:
      // off this shop's shelf (they physically left) and not on theirs until
      // someone there accepts.
      //
      // Snapshot what's being sent — the destination product is created at
      // accept time, possibly days later, and reading the source product then
      // would copy whatever it has been edited to since, or fail if it was
      // removed.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, vendor_id: _vid, created_at: _ca, updated_at: _ua, slug: _sl, ...snapshot } = src
      const { data: srcImages } = await admin.from('product_images')
        .select('url, sort_order').eq('product_id', src.id).order('sort_order')

      transferRecords.push({
        from_vendor_id:    vendor.id,
        from_product_id:   src.id,
        from_product_sku:  src.sku,
        from_product_name: src.name,
        to_vendor_id:      toVendorId,
        to_product_id:     null,   // filled in when the receiving shop accepts
        to_product_name:   null,
        quantity:          item.quantity,
        transfer_cost:     item.transferCost  ?? null,
        transfer_price:    item.transferPrice ?? null,
        notes:             item.notes ?? null,
        transferred_by:    userId,
        status:            'pending',
        batch_id:          batchId,
        moved_unit_cost:   movedUnitCost,
        product_snapshot:  { ...snapshot, images: srcImages || [] },
      })
    }

    if (transferRecords.length > 0) {
      const { error: historyError } = await admin.from('stock_transfers').insert(transferRecords)
      if (historyError) {
        // This row IS the transfer now — the stock has left the shelf and the
        // only record of where it went is this insert. Losing it would
        // vaporise the goods, so put everything back rather than report a
        // "saved history" warning over missing stock.
        for (const r of transferRecords) await returnToSender(admin, r)
        return NextResponse.json({
          success: false,
          error: 'Nothing was sent — the transfer could not be recorded: ' + historyError.message,
        }, { status: 500 })
      }
      revalidatePath('/')
    }

    if (errors.length > 0 && transferRecords.length === 0)
      return NextResponse.json({ success: false, error: errors.join('; ') }, { status: 400 })

    return NextResponse.json({
      success: true,
      transferred: transferRecords.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `${transferRecords.length} product${transferRecords.length !== 1 ? 's' : ''} sent to ${destVendor.name} — waiting for them to accept`,
    })
  }

  // ── ACCEPT / REJECT an incoming shipment ──────────────────────────────────
  // Only the RECEIVING shop may answer, and only owner/manager: accepting
  // creates products in their catalogue and changes their stock.
  if (action === 'accept' || action === 'reject') {
    const { batchId, reason } = body as { batchId: string; reason?: string }
    if (!batchId) return NextResponse.json({ success: false, error: 'batchId required' }, { status: 400 })
    if (!(await callerMayTransfer(admin, vendor, userId))) {
      return NextResponse.json({
        success: false,
        error: `${action === 'accept' ? 'Accepting' : 'Rejecting'} incoming stock requires owner or manager access`,
      }, { status: 403 })
    }

    // Claim the lines and settle them in ONE conditional update. Two people
    // tapping Accept on two tills would otherwise both read 'pending' and
    // credit the stock twice.
    const settle: any = action === 'accept'
      ? { status: 'accepted', accepted_at: new Date().toISOString(), accepted_by: userId }
      : { status: 'rejected', rejected_at: new Date().toISOString(), rejected_by: userId, reject_reason: (reason || '').trim() || null }

    const { data: rows, error: claimErr } = await admin.from('stock_transfers')
      .update(settle)
      .eq('batch_id', batchId).eq('to_vendor_id', vendor.id).eq('status', 'pending')
      .select('*')
    if (claimErr) return NextResponse.json({ success: false, error: claimErr.message }, { status: 500 })
    if (!rows || rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'Nothing is waiting in this shipment — someone may have already accepted or rejected it.',
      }, { status: 409 })
    }

    const errors: string[] = []
    let settled = 0

    for (const row of rows) {
      if (action === 'reject') {
        await returnToSender(admin, row)
        settled++
        continue
      }
      const landed = await landAtDestination(admin, row)
      if (landed.error) {
        // Put this line back in transit so it can be retried once the clash is
        // resolved — the goods are still nobody's until it lands.
        await admin.from('stock_transfers')
          .update({ status: 'pending', accepted_at: null, accepted_by: null })
          .eq('id', row.id)
        errors.push(landed.error)
        continue
      }
      // Seed the destination's FIFO layer with the cost that left the sender
      if (row.moved_unit_cost != null && row.moved_unit_cost > 0) {
        await admin.rpc('restore_fifo_cost', {
          p_vendor_id: vendor.id, p_product_id: landed.productId,
          p_quantity: row.quantity, p_unit_cost: row.moved_unit_cost,
          p_received_at: new Date().toISOString().slice(0, 10),
        })
      }
      await admin.from('stock_transfers')
        .update({ to_product_id: landed.productId, to_product_name: landed.productName })
        .eq('id', row.id)
      settled++
    }

    revalidatePath('/')
    if (settled === 0) return NextResponse.json({ success: false, error: errors.join('; ') }, { status: 400 })

    const units = rows.reduce((t: number, r: any) => t + r.quantity, 0)
    return NextResponse.json({
      success: true,
      settled,
      errors: errors.length > 0 ? errors : undefined,
      message: action === 'accept'
        ? `Accepted ${settled} product${settled !== 1 ? 's' : ''} — ${units} unit${units !== 1 ? 's' : ''} added to your stock`
        : `Rejected — ${units} unit${units !== 1 ? 's' : ''} returned to the sending shop`,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
