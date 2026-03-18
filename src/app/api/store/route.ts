import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const admin = createAdminClient()

  const { data: products } = await admin
    .from('products')
    .select('*, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
    .eq('is_active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false }).limit(10000)

  const { data: vendors } = await admin
    .from('vendors')
    .select('*')
    .eq('status', 'approved')
    .order('name')

  const { data: synonyms } = await admin
    .from('search_synonyms')
    .select('keywords')

  return NextResponse.json({
    products: products || [],
    vendors: vendors || [],
    synonyms: (synonyms || []).map(s => s.keywords),
  })
}
