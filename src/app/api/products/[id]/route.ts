import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/slug'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminClient()

  // Accept either a UUID or a slug
  let q = admin
    .from('products')
    .select('*, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
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
    .or(`vendor_id.eq.${product.vendor_id},category.eq.${product.category}`)
    .gt('quantity', 0)
    .limit(8)

  return NextResponse.json({ product, related: related || [] })
}
