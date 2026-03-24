import { createAdminClient } from '@/lib/supabase/admin'
import HomePage from './HomeClient'

export const revalidate = 60 // ISR: regenerate every 60 seconds

async function getStoreData() {
  const admin = createAdminClient()

  const [productsRes, vendorsRes, synonymsRes] = await Promise.all([
    admin
      .from('products')
      .select('id, name, sku, category, make, model, year, model_code, condition, price, show_price, quantity, vendor_id, created_at, side, color, oem_code, vendor:vendors(id, name, slug, location, phone, whatsapp), images:product_images(id, url, sort_order)')
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

  const products = (productsRes.data || []).map((p: any) => ({
    ...p,
    images: p.images
      ? [p.images.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0]].filter(Boolean)
      : [],
  }))

  return {
    products,
    vendors: vendorsRes.data || [],
    synonyms: (synonymsRes.data || []).map((s: any) => s.keywords),
  }
}

export default async function Page() {
  const { products, vendors, synonyms } = await getStoreData()

  return (
    <HomePage
      initialProducts={products}
      initialVendors={vendors}
      initialSynonyms={synonyms}
    />
  )
}
