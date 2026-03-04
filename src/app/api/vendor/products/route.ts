// ============================================================
// FILE: src/app/api/vendor/products/route.ts
// REPLACES: the entire existing file
// FEATURES: 1 (SKU duplicate check), 2 (bulk_create with mode), 3 (bulk_delete)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getVendor() {
  const supabase = await createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const admin = createAdminClient()
  const { data: vendor } = await admin.from('vendors').select('*').eq('user_id', user.id).eq('status', 'approved').single()
  return vendor
}

function generateSKU() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let id = 'P-'
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
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
    const { data: product, error } = await admin.from('products').insert({
      vendor_id: vendor.id, sku, name: pd.name, description: pd.description || '',
      category: pd.category || 'Other', make: pd.make || null, model: pd.model || null,
      year: pd.year || null, condition: pd.condition || 'Good',
      price: pd.price ? parseInt(pd.price) : null, show_price: pd.show_price !== false,
      quantity: parseInt(pd.quantity) || 1, is_active: true,
    }).select().single()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
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
    // importMode: 'skip' (default) | 'update'
    if (!items || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ success: false, error: 'No products' }, { status: 400 })

    // Check which SKUs already exist for this vendor
    const skus = items.map((item: any) => item.sku?.trim()).filter(Boolean)
    const { data: existingProducts } = await admin
      .from('products')
      .select('id, sku')
      .eq('vendor_id', vendor.id)
      .in('sku', skus)

    const existingMap = new Map((existingProducts || []).map((p: any) => [p.sku, p.id]))

    const toInsert: any[] = []
    const toUpdate: any[] = []
    const skipped: string[] = []

    for (const item of items) {
      const sku = item.sku?.trim() || generateSKU()
      const row = {
        vendor_id: vendor.id,
        sku,
        name: item.name || 'Untitled Part',
        description: item.description || '',
        category: item.category || 'Other',
        make: item.make || null,
        model: item.model || null,
        year: item.year || null,
        condition: item.condition || 'Good',
        price: item.price ? parseInt(item.price) : null,
        show_price: item.show_price !== false,
        quantity: parseInt(item.quantity) || 1,
        is_active: true,
      }

      if (existingMap.has(sku)) {
        if (importMode === 'update') {
          toUpdate.push({ ...row, id: existingMap.get(sku) })
        } else {
          skipped.push(sku)
        }
      } else {
        toInsert.push(row)
      }
    }

    const results: any[] = []

    // Insert new products
    if (toInsert.length > 0) {
      const { data: created, error } = await admin.from('products').insert(toInsert).select()
      if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
      results.push(...(created || []))
    }

    // Update existing products
    if (toUpdate.length > 0) {
      for (const item of toUpdate) {
        const { id, ...updateData } = item
        await admin.from('products').update({ ...updateData, updated_at: new Date().toISOString() }).eq('id', id)
        results.push({ id, ...updateData })
      }
    }

    return NextResponse.json({
      success: true,
      count: results.length,
      products: results,
      skipped,
      skippedCount: skipped.length,
      updatedCount: toUpdate.length,
      insertedCount: toInsert.length,
      message: `${toInsert.length} new, ${toUpdate.length} updated, ${skipped.length} skipped`,
    })
  }

  // ─── UPDATE PRODUCT ───
  if (action === 'update') {
    const { productId, data: updateData } = body
    const { data: existing } = await admin.from('products').select('vendor_id').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    const { error } = await admin.from('products').update(updateData).eq('id', productId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, message: 'Product updated' })
  }

  // ─── TOGGLE ACTIVE/HIDDEN ───
  if (action === 'toggle') {
    const { productId } = body
    const { data: existing } = await admin.from('products').select('vendor_id, is_active').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    await admin.from('products').update({ is_active: !existing.is_active }).eq('id', productId)
    return NextResponse.json({ success: true, message: existing.is_active ? 'Product hidden' : 'Product visible' })
  }

  // ─── DELETE SINGLE PRODUCT ───
  if (action === 'delete') {
    const { productId } = body
    const { data: existing } = await admin.from('products').select('vendor_id').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    const { data: images } = await admin.from('product_images').select('url').eq('product_id', productId)
    if (images && images.length > 0) {
      const paths = images.map((img: any) => { const m = img.url.match(/product-images\/(.+)$/); return m ? m[1] : null }).filter(Boolean)
      if (paths.length > 0) await admin.storage.from('product-images').remove(paths)
    }
    await admin.from('product_images').delete().eq('product_id', productId)
    await admin.from('products').delete().eq('id', productId)
    return NextResponse.json({ success: true, message: 'Product deleted' })
  }

  // ─── [NEW] BULK DELETE MULTIPLE PRODUCTS ───
  if (action === 'bulk_delete') {
    const { productIds } = body
    if (!productIds || !Array.isArray(productIds) || productIds.length === 0)
      return NextResponse.json({ success: false, error: 'No products selected' }, { status: 400 })

    // Verify all products belong to this vendor
    const { data: products } = await admin
      .from('products')
      .select('id, vendor_id')
      .in('id', productIds)

    const ownedIds = (products || [])
      .filter((p: any) => p.vendor_id === vendor.id)
      .map((p: any) => p.id)

    if (ownedIds.length === 0)
      return NextResponse.json({ success: false, error: 'No matching products found' }, { status: 404 })

    // Delete images from storage
    const { data: images } = await admin
      .from('product_images')
      .select('url')
      .in('product_id', ownedIds)

    if (images && images.length > 0) {
      const paths = images
        .map((img: any) => { const m = img.url.match(/product-images\/(.+)$/); return m ? m[1] : null })
        .filter(Boolean)
      if (paths.length > 0) await admin.storage.from('product-images').remove(paths)
    }

    // Delete image records then products
    await admin.from('product_images').delete().in('product_id', ownedIds)
    const { error } = await admin.from('products').delete().in('id', ownedIds)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })

    return NextResponse.json({
      success: true,
      deletedCount: ownedIds.length,
      message: `${ownedIds.length} product${ownedIds.length > 1 ? 's' : ''} deleted`
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
