import { NextRequest, NextResponse } from 'next/server'
import { pgSafe } from '@/lib/security'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/slug'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminClient()

  // Accept either a UUID or a slug
  let q = admin
    .from('products')
    // Public page. The row used to go out as '*' — cost, cost_vat_rate, shelf
    // location, min_stock_level, parent_product_id, the lot — to every visitor
    // and every competitor. Only what the listing shows.
    .select('id, vendor_id, sku, name, description, category, make, model, model_code, year, condition, side, color, oem_code, price, show_price, quantity, slug, product_type, tyre_width, tyre_profile, tyre_rim, origin_country, created_at, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
    .eq('is_active', true)
  q = isUUID(id) ? q.eq('id', id) : q.eq('slug', id)

  const { data: product, error } = await q.single()

  if (error || !product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  if (product.images) {
    product.images.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
  }

  // Related products — include slug so client can build correct links
  const { data: related } = await admin
    .from('products')
    .select('id, name, price, show_price, category, condition, make, model, slug, images:product_images(url, sort_order)')
    .eq('is_active', true)
    .neq('id', product.id)
    // category is vendor-typed text inside a filter string; quote it so a comma
    // or paren in a category name cannot reshape the query
    .or(`vendor_id.eq.${product.vendor_id},category.eq."${pgSafe(product.category)}"`)
    .gt('quantity', 0)
    .limit(8)

  return NextResponse.json({ product, related: related || [] })
}
