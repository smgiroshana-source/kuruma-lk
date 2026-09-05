import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A product slug nobody else holds.
 *
 * Slugs are global (one storefront URL per product across every vendor), and
 * a shop like Sakura lists ten "Toyota Aqua NHP10 Hybrid Battery 2023" units
 * whose only difference is the SKU. Trying the bare slug and then slug-sku
 * once is not enough: when such a part is TRANSFERRED, the sender already owns
 * slug-sku for the very item being sent, and the receiver's copy failed with
 * "you already list a product under the same web address" — which told the
 * operator to rename a product that was named correctly.
 *
 * Order: base, base-sku, base-sku-2 … base-sku-9, then a short random tail.
 * SEO cares about the first two; the rest only need to be unique.
 */
export async function uniqueProductSlug(admin: SupabaseClient<any, any, any>, baseSlug: string, sku?: string | null): Promise<string> {
  const skuPart = (sku || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const candidates: string[] = [baseSlug]
  if (skuPart) {
    candidates.push(`${baseSlug}-${skuPart}`)
    for (let n = 2; n <= 9; n++) candidates.push(`${baseSlug}-${skuPart}-${n}`)
  } else {
    for (let n = 2; n <= 9; n++) candidates.push(`${baseSlug}-${n}`)
  }
  const { data: taken } = await admin.from('products').select('slug').in('slug', candidates)
  const used = new Set((taken || []).map((r: any) => r.slug))
  for (const c of candidates) if (!used.has(c)) return c
  return `${baseSlug}-${skuPart || 'x'}-${Math.random().toString(36).slice(2, 6)}`
}
