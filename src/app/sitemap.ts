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
    .select('make, model, tyre_width, tyre_profile, tyre_rim')
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

  // Model hub pages — /suzuki/wagon-r etc. (≥3 in-stock parts). These target
  // the model-level queries that dominate the SL parts market.
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '')
  const modelCounts = new Map<string, number>()
  const sizeCounts = new Map<string, number>()
  for (const row of (makeRows || [])) {
    if (row.make && row.model) {
      const mk = norm(row.make), md = norm(row.model)
      if (mk.length >= 2 && md.length >= 1) {
        const key = `${mk}/${md}`
        modelCounts.set(key, (modelCounts.get(key) || 0) + 1)
      }
    }
    if (row.tyre_width && row.tyre_profile && row.tyre_rim) {
      const s = `${row.tyre_width}-${row.tyre_profile}-r${row.tyre_rim}`
      sizeCounts.set(s, (sizeCounts.get(s) || 0) + 1)
    }
  }
  const modelPages: MetadataRoute.Sitemap = [...modelCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([path]) => ({
      url: `${SITE_URL}/${path}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.9,
    }))

  // Tyre pages — the /tyres hub plus one page per in-stock size
  const tyrePages: MetadataRoute.Sitemap = sizeCounts.size === 0 ? [] : [
    { url: `${SITE_URL}/tyres`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.9 },
    ...[...sizeCounts.keys()].map((size) => ({
      url: `${SITE_URL}/tyres/${size}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.85,
    })),
  ]

  return [...staticPages, ...makePages, ...modelPages, ...tyrePages, ...productPages]
}
