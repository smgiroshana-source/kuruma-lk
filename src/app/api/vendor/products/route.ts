// ============================================================
// FILE: src/app/api/vendor/products/route.ts
// REPLACES: the entire existing file
// FEATURES: 1 (SKU duplicate check), 2 (bulk_create with mode), 3 (bulk_delete)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateProductSlug } from '@/lib/slug'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  if (vendor) return vendor
  // Check if staff member
  const { data: staffLink } = await admin.from('vendor_staff').select('*, vendor:vendors(*)').eq('user_id', user.id).eq('active', true).single()
  if (staffLink?.vendor) return staffLink.vendor
  return null
}

function generateSKU() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = 'P-'
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}


// ── Why a product won't delete ───────────────────────────────────────────────
// A product that appears on a sale, a GRN or a transfer is referenced by those
// records, and Postgres refuses to delete it — correctly, since removing it
// would leave that history pointing at nothing. Postgres words this as:
//   Key (id)=(…) is still referenced from table "sale_items".
// which means nothing to a shop, so translate it and point at Hide, which is
// what the operator actually wants.
const DELETE_BLOCKERS: Record<string, string> = {
  sale_items:        'it appears on a sale',
  credit_note_items: 'it appears on a credit note',
  grn_items:         'it appears on a goods-received note',
  stock_transfers:   'it was transferred between shops',
  cost_layers:       'it still has stock cost layers',
  stock_writeoffs:   'it appears on a write-off',
  supplier_returns:  'it appears on a supplier return',
}

function blockedTable(err: any): string | null {
  return (String(err?.details || err?.message || '').match(/table "([a-z_]+)"/) || [])[1] || null
}

/**
 * Remove one product row, and only its own photos. Nothing is destroyed unless
 * the product itself can go — photos are cleared only when they turn out to be
 * the one thing holding the delete up.
 */
async function deleteProductRow(admin: ReturnType<typeof createAdminClient>, productId: string) {
  let { error } = await admin.from('products').delete().eq('id', productId)
  if (error && blockedTable(error) === 'product_images') {
    await admin.from('product_images').delete().eq('product_id', productId)
    ;({ error } = await admin.from('products').delete().eq('id', productId))
  }
  if (!error) await admin.from('product_images').delete().eq('product_id', productId)
  return error
}

function explainBlockedDelete(name: string, err: any): string {
  const table = blockedTable(err)
  const why = (table && DELETE_BLOCKERS[table]) || 'other records still refer to it'
  return `"${name}" can't be deleted because ${why} — removing it would break that record. Use Hide instead: it disappears from the shop and the POS, and the history stays intact.`
}

export async function POST(req: NextRequest) {
  const vendor = await getVendor()
  if (!vendor) return NextResponse.json({ error: 'Not authorized' }, { status: 403 })

  const body = await req.json()
  const { action } = body
  const admin = createAdminClient()

  // ─── CREATE SINGLE PRODUCT ───
  if (action === 'create') {
    const { data: pd } = body
    const sku = pd.sku?.trim() || generateSKU()

    // Generate slug — try clean first, fall back to slug+sku if already taken
    const baseSlug = generateProductSlug(pd.name, pd.make, pd.model, pd.condition || 'Reconditioned')
    let slug = baseSlug
    const { data: slugTaken } = await admin.from('products').select('id').eq('slug', slug).maybeSingle()
    if (slugTaken) {
      slug = `${baseSlug}-${sku.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    }

    const { data: product, error } = await admin.from('products').insert({
      vendor_id: vendor.id, sku, name: pd.name, description: pd.description || '',
      category: pd.category || 'Other', make: pd.make || null, model: pd.model || null,
      model_code: pd.model_code || null, year: pd.year || null, condition: pd.condition || 'Reconditioned',
      side: pd.side || null, color: pd.color || null, oem_code: pd.oem_code || null,
      price: pd.price ? parseInt(pd.price) : null, cost: pd.cost ? parseInt(pd.cost) : null,
      show_price: pd.show_price !== false, quantity: parseInt(pd.quantity) || 1,
      added_date: pd.added_date || null, is_active: true, slug,
      loc_store: pd.loc_store || null, loc_floor: pd.loc_floor || null,
      loc_sub1: pd.loc_sub1 || null, loc_sub2: pd.loc_sub2 || null,
      // Tyre-specific fields
      product_type: pd.product_type || 'part',
      tyre_width:   pd.tyre_width   ? parseInt(pd.tyre_width)   : null,
      tyre_profile: pd.tyre_profile ? parseInt(pd.tyre_profile) : null,
      tyre_rim:     pd.tyre_rim     ? parseInt(pd.tyre_rim)     : null,
      origin_country: pd.origin_country?.trim() || null,
    }).select().single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    revalidatePath('/')
    // Auto-seed FIFO cost layer if opening stock + cost both provided
    const initQty  = parseInt(pd.quantity) || 1
    const initCost = parseInt(pd.cost)
    if (initQty > 0 && initCost > 0 && product) {
      await admin.from('cost_layers').insert({
        vendor_id:          vendor.id,
        product_id:         product.id,
        quantity_received:  initQty,
        quantity_remaining: initQty,
        unit_cost:          initCost,
        received_at:        new Date().toISOString().slice(0, 10),
      })
    }
    return NextResponse.json({ success: true, product, message: 'Product created (ID: ' + sku + ')' })
  }

  // ─── [NEW] CHECK FOR DUPLICATE SKUs BEFORE BULK IMPORT ───
  if (action === 'bulk_check_skus') {
    const { skus } = body
    if (!skus || !Array.isArray(skus)) return NextResponse.json({ success: false, error: 'No SKUs' }, { status: 400 })

    const { data: existing } = await admin
      .from('products')
      .select('sku, name, id')
      .eq('vendor_id', vendor.id)
      .in('sku', skus)

    return NextResponse.json({
      success: true,
      duplicates: existing || [],
      duplicateSkus: (existing || []).map((e: any) => e.sku),
    })
  }

  // ─── [MODIFIED] BULK CREATE — now supports skip/update mode ───
  if (action === 'bulk_create') {
    const { products: items, mode: importMode } = body
    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ success: false, error: 'No products' }, { status: 400 })

    // Batch helper — Supabase .in() and .insert() fail with 100+ items
    const BATCH = 80
    function chunk(arr: any[]) { const chunks = []; for (let i = 0; i < arr.length; i += BATCH) chunks.push(arr.slice(i, i + BATCH)); return chunks }

    // Check existing SKUs in batches
    const skus = items.map((item: any) => item.sku?.trim()).filter(Boolean)
    const existingMap = new Map<string, string>()
    for (const batch of chunk(skus)) {
      const { data } = await admin.from('products').select('id, sku').eq('vendor_id', vendor.id).in('sku', batch)
      if (data) data.forEach((p: any) => existingMap.set(p.sku, p.id))
    }

    const toInsert: any[] = []
    const toUpdate: any[] = []
    const skipped: string[] = []

    for (const item of items) {
      const sku = item.sku?.trim() || generateSKU()
      const row = {
        vendor_id: vendor.id, sku,
        name: item.name || 'Untitled Part', description: item.description || '',
        category: item.category || 'Other', make: item.make || null,
        model: item.model || null, model_code: item.model_code || null,
        year: item.year || null, condition: item.condition || 'Reconditioned',
        side: item.side || null, color: item.color || null, oem_code: item.oem_code || null,
        price: item.price ? parseInt(item.price) : null,
        cost: item.cost ? parseInt(item.cost) : null,
        show_price: item.show_price !== false,
        quantity: parseInt(item.quantity) || 1,
        added_date: item.added_date || null, is_active: true,
        loc_store: item.loc_store || null, loc_floor: item.loc_floor || null,
        loc_sub1: item.loc_sub1 || null, loc_sub2: item.loc_sub2 || null,
        product_type: item.product_type || (item.tyre_width ? 'tyre' : 'part'),
        tyre_width:   item.tyre_width   ? parseInt(item.tyre_width)   : null,
        tyre_profile: item.tyre_profile ? parseInt(item.tyre_profile) : null,
        tyre_rim:     item.tyre_rim     ? parseInt(item.tyre_rim)     : null,
        origin_country: item.origin_country?.trim() || null,
      }
      if (existingMap.has(sku)) {
        if (importMode === 'update') toUpdate.push({ ...row, id: existingMap.get(sku) })
        else skipped.push(sku)
      } else {
        toInsert.push(row)
      }
    }

    const results: any[] = []

    // Generate slugs for the new rows — bulk imports used to skip this, which
    // published hundreds of UUID-only URLs (flagged in Search Console as soft
    // 404s / crawl waste). Uniqueness: one query for DB collisions against all
    // base slugs, then dedupe within the batch; any collision falls back to
    // slug-sku, matching the single-create path.
    if (toInsert.length > 0) {
      const baseSlugs = toInsert.map((r: any) => generateProductSlug(r.name, r.make, r.model, r.condition))
      const taken = new Set<string>()
      for (const b of chunk([...new Set(baseSlugs)])) {
        const { data: rows } = await admin.from('products').select('slug').in('slug', b)
        for (const r of (rows || [])) if (r.slug) taken.add(r.slug)
      }
      toInsert.forEach((row: any, i: number) => {
        let slug = baseSlugs[i]
        if (taken.has(slug)) slug = `${slug}-${row.sku.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
        taken.add(slug) // also guards duplicates within this same batch
        row.slug = slug
      })
    }

    // Insert new products in batches
    for (const batch of chunk(toInsert)) {
      const { data: created, error } = await admin.from('products').insert(batch).select()
      if (error) return NextResponse.json({ success: false, error: error.message + ' (at batch insert)', status: 400 })
      results.push(...(created || []))
    }

    // Update existing products
    for (const item of toUpdate) {
      const { id, ...updateData } = item
      await admin.from('products').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', id)
      results.push({ id, ...updateData })
    }

    // Revalidate home page once for the bulk import (not per-product)
    if (toInsert.length > 0) revalidatePath('/')

    // Auto-seed FIFO cost layers for newly inserted products with qty > 0 AND cost > 0
    const today = new Date().toISOString().slice(0, 10)
    const costLayerRows: any[] = []
    for (const p of results) {
      const qty  = parseInt(p.quantity) || 0
      const cost = parseInt(p.cost)     || 0
      if (qty > 0 && cost > 0 && p.id && p.vendor_id === vendor.id) {
        costLayerRows.push({
          vendor_id:          vendor.id,
          product_id:         p.id,
          quantity_received:  qty,
          quantity_remaining: qty,
          unit_cost:          cost,
          received_at:        today,
        })
      }
    }
    if (costLayerRows.length > 0) {
      const CLBATCH = 80
      for (let i = 0; i < costLayerRows.length; i += CLBATCH) {
        await admin.from('cost_layers').insert(costLayerRows.slice(i, i + CLBATCH))
      }
    }

    return NextResponse.json({
      success: true, count: results.length, products: results, skipped,
      skippedCount: skipped.length, updatedCount: toUpdate.length,
      insertedCount: toInsert.length,
      message: `${toInsert.length} new, ${toUpdate.length} updated, ${skipped.length} skipped`,
    })
  }

  // ─── UPDATE PRODUCT ───
  if (action === 'update') {
    const { productId, data: updateData } = body
    const { data: existing } = await admin.from('products').select('vendor_id, slug, cost, quantity').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    const { error } = await admin.from('products').update(updateData).eq('id', productId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

    // "Add the cost later" workflow: products often get listed without a cost
    // and receive one manually afterwards. Without this, typing a cost into the
    // Edit form only fills the reference field — no FIFO layer exists, so sales
    // consume zero cost and GP/stock-value stay wrong forever. Setting a FIRST
    // cost on an in-stock product with no remaining layers seeds one for the
    // on-hand units. Existing layers are never touched (a later cost edit is a
    // reference change, not a purchase).
    let seededCost = false
    const newCost = parseInt(updateData?.cost)
    const hadCost = parseInt(existing.cost) > 0
    if (Number.isFinite(newCost) && newCost > 0 && !hadCost) {
      const qtyNow = updateData?.quantity != null ? parseInt(updateData.quantity) : parseInt(existing.quantity || 0)
      if (qtyNow > 0) {
        const { data: lay } = await admin.from('cost_layers').select('quantity_remaining').eq('product_id', productId)
        const remaining = (lay || []).reduce((s: number, l: any) => s + (parseInt(l.quantity_remaining) || 0), 0)
        if (remaining === 0) {
          const { error: layErr } = await admin.from('cost_layers').insert({
            vendor_id: vendor.id, product_id: productId,
            quantity_received: qtyNow, quantity_remaining: qtyNow,
            unit_cost: newCost,
            received_at: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }),
          })
          seededCost = !layErr
        }
      }
    }

    // Revalidate both slug URL and legacy UUID URL
    if (existing.slug) revalidatePath(`/product/${existing.slug}`)
    revalidatePath(`/product/${productId}`)
    return NextResponse.json({ success: true, message: seededCost ? `Product updated — cost layer seeded for on-hand stock` : 'Product updated' })
  }

  // ─── TOGGLE ACTIVE/HIDDEN ───
  if (action === 'toggle') {
    const { productId } = body
    const { data: existing } = await admin.from('products').select('vendor_id, is_active, slug').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    await admin.from('products').update({ is_active: !existing.is_active }).eq('id', productId)
    if (existing.slug) revalidatePath(`/product/${existing.slug}`)
    revalidatePath(`/product/${productId}`)
    revalidatePath('/')
    return NextResponse.json({ success: true, message: existing.is_active ? 'Product hidden' : 'Product visible' })
  }

  // ─── DELETE SINGLE PRODUCT ───
  if (action === 'delete') {
    const { productId } = body
    const { data: existing } = await admin.from('products').select('vendor_id, name').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })

    // Read the photo list BEFORE anything is removed — once the product row is
    // gone the URLs are unrecoverable and the storage files would be orphaned.
    const { data: images } = await admin.from('product_images').select('url').eq('product_id', productId)

    // Delete the PRODUCT first, and check whether it worked. The old order
    // wiped the photos and the storage files up front, then discarded the
    // result of the product delete and answered "Product deleted" either way —
    // so a product held by a sale went on existing while its pictures did not.
    const delErr = await deleteProductRow(admin, productId)

    if (delErr) {
      // Nothing was destroyed — the product and its photos are as they were.
      return NextResponse.json({ success: false, error: explainBlockedDelete(existing.name, delErr) }, { status: 409 })
    }

    // Gone for real; now clean up the storage files it owned.
    if (images && images.length > 0) {
      const paths = images.map((img: any) => {
        try { const u = new URL(img.url); return u.pathname.split('/product-images/')[1] || null } catch { return null }
      }).filter((p): p is string => !!p)
      if (paths.length > 0) await admin.storage.from('product-images').remove(paths)
    }
    revalidatePath('/')
    return NextResponse.json({ success: true, message: 'Product deleted' })
  }

  // ─── [NEW] BULK DELETE MULTIPLE PRODUCTS ───
  if (action === 'bulk_delete') {
    const { productIds } = body
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0)
      return NextResponse.json({ success: false, error: 'No products selected' }, { status: 400 })

    // Batch helper — Supabase .in() fails with 200+ IDs
    const BATCH = 100
    function chunk(arr: any[]) { const chunks = []; for (let i = 0; i < arr.length; i += BATCH) chunks.push(arr.slice(i, i + BATCH)); return chunks }

    // Verify all products belong to this vendor (batched)
    const owned: Array<{ id: string; name: string }> = []
    for (const batch of chunk(productIds)) {
      const { data } = await admin.from('products').select('id, name, vendor_id').in('id', batch)
      if (data) owned.push(...data.filter((p: any) => p.vendor_id === vendor.id).map((p: any) => ({ id: p.id, name: p.name })))
    }

    if (owned.length === 0)
      return NextResponse.json({ success: false, error: 'No matching products found' }, { status: 404 })

    // Collect the photo URLs up front — after the rows go, the storage files
    // can no longer be found.
    const pathsByProduct = new Map<string, string[]>()
    for (const batch of chunk(owned.map(p => p.id))) {
      const { data: images } = await admin.from('product_images').select('product_id, url').in('product_id', batch)
      for (const img of (images || []) as any[]) {
        let path: string | null = null
        try { path = new URL(img.url).pathname.split('/product-images/')[1] || null } catch {}
        if (path) pathsByProduct.set(img.product_id, [...(pathsByProduct.get(img.product_id) || []), path])
      }
    }

    // Try each batch as one statement, then fall back to one-by-one if it
    // fails. A batch delete is all-or-nothing: a single product held by a sale
    // would otherwise take the whole selection down with it, and the old code
    // ignored the error and reported every one as deleted.
    const deleted: string[] = []
    const blocked: string[] = []
    for (const batch of chunk(owned.map(p => p.id))) {
      const { error: batchErr } = await admin.from('products').delete().in('id', batch)
      if (!batchErr) {
        deleted.push(...batch)
        await admin.from('product_images').delete().in('product_id', batch)
        continue
      }
      // The batch is all-or-nothing, so one product held by a sale would take
      // the whole selection with it. Retry individually to keep the rest.
      for (const id of batch) {
        const oneErr = await deleteProductRow(admin, id)
        if (oneErr) blocked.push(explainBlockedDelete(owned.find(p => p.id === id)?.name || 'A product', oneErr))
        else deleted.push(id)
      }
    }

    // Only remove storage files for products that actually went
    const paths = deleted.flatMap(id => pathsByProduct.get(id) || [])
    for (let i = 0; i < paths.length; i += 100) {
      await admin.storage.from('product-images').remove(paths.slice(i, i + 100))
    }

    revalidatePath('/')
    if (deleted.length === 0)
      return NextResponse.json({ success: false, error: blocked[0] || 'Nothing could be deleted' }, { status: 409 })

    return NextResponse.json({
      success: true,
      deletedCount: deleted.length,
      blocked: blocked.length > 0 ? blocked : undefined,
      message: blocked.length > 0
        ? `${deleted.length} deleted · ${blocked.length} kept because they appear in your records — hide those instead`
        : `${deleted.length} product${deleted.length > 1 ? 's' : ''} deleted`
    })
  }

  // ─── SEED COST LAYER — for stocktake upward adjustments ───
  if (action === 'seed_cost_layer') {
    const { productId, unitCost, quantity, receivedAt } = body
    if (!productId || !unitCost || !quantity) return NextResponse.json({ success: false, error: 'productId, unitCost, quantity required' }, { status: 400 })
    const { data: p } = await admin.from('products').select('vendor_id').eq('id', productId).single()
    if (!p || p.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    const { error } = await admin.from('cost_layers').insert({
      vendor_id:          vendor.id,
      product_id:         productId,
      quantity_received:  quantity,
      quantity_remaining: quantity,
      unit_cost:          unitCost,
      received_at:        receivedAt || new Date().toISOString().slice(0, 10),
    })
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
