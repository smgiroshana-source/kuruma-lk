import { createAdminClient } from '@/lib/supabase/admin'
import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const admin = createAdminClient()

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/register`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.3,
    },
  ]

  // All active, in-stock products WITH a slug. UUID-only URLs are excluded:
  // Search Console flagged them as soft-404/low-value entries, and each gains
  // a slug (and joins the sitemap) on its next catalog fetch anyway.
  const { data: products } = await admin
    .from('products')
    .select('id, slug, updated_at, created_at')
    .eq('is_active', true)
    .gt('quantity', 0)
    .not('slug', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5000)

  const productPages: MetadataRoute.Sitemap = (products || []).map((p) => ({
    url: `${SITE_URL}/product/${p.slug}`,
    lastModified: new Date(p.updated_at || p.created_at),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  // Make hub pages — /toyota, /honda, /nissan, etc.
  const { data: makeRows } = await (admin.from('products') as any)
    .select('make')
    .eq('is_active', true)
    .gt('quantity', 0)

  // Dedupe on the NORMALISED SLUG, not the raw string — "Toyota", "TOYOTA"
  // and "Toyota " all collapse to /toyota (Search Console showed duplicate
  // and malformed entries like "toyota-"). Junk filters: strip stray dashes,
  // require ≥2 chars, and require ≥2 in-stock products so one-off typo makes
  // ("Susuki") don't earn their own hub page.
  const slugCounts = new Map<string, number>()
  for (const row of (makeRows || [])) {
    const raw = (row.make as string | null)?.trim()
    if (!raw) continue
    const slug = raw.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '')
    if (slug.length < 2) continue
    slugCounts.set(slug, (slugCounts.get(slug) || 0) + 1)
  }
  const makePages: MetadataRoute.Sitemap = [...slugCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([slug]) => ({
      url: `${SITE_URL}/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9, // Higher than product pages — these rank for broad "Toyota parts Sri Lanka" queries
    }))

  return [...staticPages, ...makePages, ...productPages]
}
