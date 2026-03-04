import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminClient()

  const { data: product, error } = await admin
    .from('products')
    .select('*, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
    .eq('id', id)
    .eq('is_active', true)
    .single()

  if (error || !product) {
    return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  }

  // Sort images by sort_order
  if (product.images) {
    product.images.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
  }

  // Fetch a few related products from same vendor or category
  const { data: related } = await admin
    .from('products')
    .select('id, name, price, show_price, category, condition, make, model, images:product_images(url, sort_order)')
    .eq('is_active', true)
    .neq('id', id)
    .or(`vendor_id.eq.${product.vendor_id},category.eq.${product.category}`)
    .gt('quantity', 0)
    .limit(8)

  return NextResponse.json({
    product,
    related: related || [],
  })
}
