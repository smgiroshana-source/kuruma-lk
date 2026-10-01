import { storefrontImages } from '@/lib/damage'
import { createAdminClient } from '@/lib/supabase/admin'
import HomePage from './HomeClient'

export const revalidate = 3600 // ISR: regenerate every 1 hour (was 60s — caused 305K ISR writes)

async function getStoreData() {
  const admin = createAdminClient()

  const [productsRes, vendorsRes, synonymsRes] = await Promise.all([
    admin
      .from('products')
      .select('id, name, sku, category, make, model, condition, price, show_price, quantity, vendor_id, created_at, slug, product_type, tyre_width, tyre_profile, tyre_rim, origin_country, vendor:vendors(id, name, slug, phone, whatsapp), images:product_images(url, sort_order, is_damage, damage_resolved_at)')
      .eq('is_active', true)
      .gt('quantity', 0)
      .order('created_at', { ascending: false })
      .limit(2000),
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
    // Cover = the product's own photo, never a damage photo; damage_photos
    // drives the card's "Damage photos" tag (2026-10-01)
    images: storefrontImages(p.images).cover ? [storefrontImages(p.images).cover] : [],
    ...(storefrontImages(p.images).damage.length ? { damage_photos: storefrontImages(p.images).damage.length } : {}),
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
