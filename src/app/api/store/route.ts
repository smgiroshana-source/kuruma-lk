import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const admin = createAdminClient()
  const { searchParams } = new URL(req.url)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const all = searchParams.get('all') === 'true'
  const searchQuery = searchParams.get('q')?.trim() || ''
  const category = searchParams.get('category') || ''
  const condition = searchParams.get('condition') || ''
  const make = searchParams.get('make') || ''
  const vendorId = searchParams.get('vendor') || ''

  const isSearch = searchQuery || (category && category !== 'All') || (condition && condition !== 'All') || (make && make !== 'All') || vendorId

  // If searching, do server-side search across ALL products
  if (isSearch) {
    let query = admin
      .from('products')
      .select('*, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
      .eq('is_active', true)
      .gt('quantity', 0)

    if (category && category !== 'All') query = query.eq('category', category)
    if (condition && condition !== 'All') query = query.eq('condition', condition)
    if (make && make !== 'All') query = query.eq('make', make)
    if (vendorId) query = query.eq('vendor_id', vendorId)

    // For text search, expand with synonyms then use ilike
    let searchTerms: string[] = []
    if (searchQuery) {
      // Fetch synonyms to expand search
      const { data: synonymsData } = await admin.from('search_synonyms').select('keywords')
      const synonymGroups = (synonymsData || []).map(s => s.keywords as string[])

      // Split query into words, expand each via synonyms
      const words = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0)
      const expandedWords: string[][] = words.map(word => {
        const alternatives = new Set<string>([word])
        for (const group of synonymGroups) {
          if (group.some(kw => kw === word || kw.includes(word) || word.includes(kw))) {
            group.forEach(kw => alternatives.add(kw))
          }
        }
        return Array.from(alternatives)
      })

      // Collect all unique terms for OR matching
      searchTerms = expandedWords.flat()
    }

    const { data: products } = await query
      .order('created_at', { ascending: false })
      .limit(10000)

    // Filter by search terms client-side (Supabase can't do complex OR+AND with ilike)
    let filtered = products || []
    if (searchTerms.length > 0 && searchQuery) {
      const words = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0)
      // Rebuild word groups for AND matching
      const { data: synonymsData } = await admin.from('search_synonyms').select('keywords')
      const synonymGroups = (synonymsData || []).map(s => s.keywords as string[])
      const wordGroups = words.map(word => {
        const alts = new Set<string>([word])
        for (const group of synonymGroups) {
          if (group.some(kw => kw === word || kw.includes(word) || word.includes(kw))) {
            group.forEach(kw => alts.add(kw))
          }
        }
        return Array.from(alts)
      })

      filtered = filtered.filter(p => {
        const searchable = `${p.name} ${p.sku || ''} ${p.make || ''} ${p.model || ''} ${(p as any).vendor?.name || ''}`.toLowerCase()
        return wordGroups.every(alts => alts.some(alt => searchable.includes(alt)))
      })
    }

    return NextResponse.json({
      products: filtered,
      isSearchResult: true,
      totalCount: filtered.length,
      hasMore: false,
    })
  }

  // First request: get total count, vendors, synonyms + first batch of products
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
