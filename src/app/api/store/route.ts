import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const all = searchParams.get('all') === 'true'

  // First request: get total count, vendors, synonyms + first batch of products
  // Subsequent requests: just get next batch of products
  if (offset === 0) {
    const [productsRes, vendorsRes, synonymsRes, countRes] = await Promise.all([
      admin
        .from('products')
        .select('*, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
        .eq('is_active', true)
        .gt('quantity', 0)
        .order('created_at', { ascending: false })
        .range(0, all ? 9999 : limit - 1),
      admin
        .from('vendors')
        .select('*')
        .eq('status', 'approved')
        .order('name'),
      admin
        .from('search_synonyms')
        .select('keywords'),
      admin
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .gt('quantity', 0),
    ])

    return NextResponse.json({
      products: productsRes.data || [],
      vendors: vendorsRes.data || [],
      synonyms: (synonymsRes.data || []).map(s => s.keywords),
      totalCount: countRes.count || 0,
      hasMore: !all && (countRes.count || 0) > limit,
    })
  }

  // Paginated fetch - just products
  const { data: products } = await admin
    .from('products')
    .select('*, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
    .eq('is_active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  return NextResponse.json({
    products: products || [],
    hasMore: (products?.length || 0) === limit,
  })
}
