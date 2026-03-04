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

  if (action === 'create') {
    const { data: pd } = body
    // Use vendor-provided SKU or auto-generate
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

  if (action === 'bulk_create') {
    const { products: items } = body
    if (!items || !Array.isArray(items) || items.length === 0) return NextResponse.json({ success: false, error: 'No products' }, { status: 400 })
    const rows = items.map((item: any) => ({
      vendor_id: vendor.id,
      sku: item.sku?.trim() || generateSKU(),
      name: item.name || 'Untitled Part', description: item.description || '',
      category: item.category || 'Other', make: item.make || null, model: item.model || null,
      year: item.year || null, condition: item.condition || 'Good',
      price: item.price ? parseInt(item.price) : null, show_price: item.show_price !== false,
      quantity: parseInt(item.quantity) || 1, is_active: true,
    }))
    const { data: created, error } = await admin.from('products').insert(rows).select()
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, count: created?.length || 0, products: created, message: (created?.length || 0) + ' products imported' })
  }

  if (action === 'update') {
    const { productId, data: updateData } = body
    const { data: existing } = await admin.from('products').select('vendor_id').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    const { error } = await admin.from('products').update(updateData).eq('id', productId)
    if (error) return NextResponse.json({ success: false, error: error.message }, { status: 400 })
    return NextResponse.json({ success: true, message: 'Product updated' })
  }

  if (action === 'toggle') {
    const { productId } = body
    const { data: existing } = await admin.from('products').select('vendor_id, is_active').eq('id', productId).single()
    if (!existing || existing.vendor_id !== vendor.id) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
    await admin.from('products').update({ is_active: !existing.is_active }).eq('id', productId)
    return NextResponse.json({ success: true, message: existing.is_active ? 'Product hidden' : 'Product visible' })
  }

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

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
