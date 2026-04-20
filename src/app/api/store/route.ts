import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'edge'

export async function GET() {
  const admin = createAdminClient()

  // Load all products but only with primary image (sort_order = 0) for speed
  const [productsRes, vendorsRes, synonymsRes] = await Promise.all([
    admin
      .from('products')
      .select('id, name, sku, category, make, model, condition, price, show_price, quantity, vendor_id, created_at, vendor:vendors(id, name, slug, phone, whatsapp), images:product_images(url, sort_order)')
      .eq('is_active', true)
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .limit(10000),
    admin
      .from('vendors')
      .select('*')
      .eq('status', 'approved')
      .order('name'),
    admin
      .from('search_synonyms')
      .select('keywords'),
  ])

  // Strip to only primary image per product to reduce payload size
  const products = (productsRes.data || []).map(p => ({
    ...p,
    images: p.images
      ? [p.images.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0]].filter(Boolean)
      : [],
  }))

  const response = NextResponse.json({
    products,
    vendors: vendorsRes.data || [],
    synonyms: (synonymsRes.data || []).map(s => s.keywords),
  })

  // Cache at CDN edge for 1 hour, serve stale for up to 4 hours (reduces Fast Origin Transfer)
  response.headers.set('Cache-Control', 's-maxage=3600, stale-while-revalidate=14400')

  return response
}
