import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/fetchAll'
import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/siteUrl'


// Rebuilt once a day so new stock joins (it was built only at deploy time)
export const revalidate = 86400

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const admin = createAdminClient()

  // Every in-stock product, read in pages (2026-10-25): the old single query
  // stopped at 5,000 while 6,170 were live, and the hub counts below came
  // from one unpaginated read. One read feeds the products AND the hubs.
  const rows: any[] = await fetchAllRows((from, to) => (admin.from('products') as any)
    .select('id, slug, updated_at, created_at, make, model, tyre_width, tyre_profile, tyre_rim')
    .eq('is_active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .order('id')
    .range(from, to))
  const changed = (r: any) => new Date(r.updated_at || r.created_at)
  const newest = rows.length ? new Date(Math.max(...rows.map(r => changed(r).getTime()))) : new Date()

  // Home only. /login and /register were listed here while robots.txt
  // blocks them — Search Console's "Blocked by robots.txt".
  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: newest, changeFrequency: 'daily', priority: 1 },
  ]

  // Products WITH a slug. UUID-only URLs are excluded: Search Console flagged
  // them as soft-404/low-value entries, and each gains a slug on its next
  // catalog fetch anyway.
  const products = rows.filter(r => r.slug)

  const productPages: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${SITE_URL}/product/${p.slug}`,
    lastModified: changed(p),
    changeFrequency: 'weekly' as const,
    priority: 0.8,
  }))

  // Make hub pages — /toyota, /honda, /nissan, etc. — from the same full read
  const makeRows = rows
  // A hub's "last changed" is its newest product, not "now" on every crawl
  // (a lastmod that always says today teaches Google to ignore it)
  const hubChanged = new Map<string, Date>()
  const touch = (key: string, r: any) => { const d = changed(r); const cur = hubChanged.get(key); if (!cur || d > cur) hubChanged.set(key, d) }

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
    touch(slug, row)
  }
  const makePages: MetadataRoute.Sitemap = [...slugCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([slug]) => ({
      url: `${SITE_URL}/${slug}`,
      lastModified: hubChanged.get(slug) || newest,
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
        touch(key, row)
      }
    }
    if (row.tyre_width && row.tyre_profile && row.tyre_rim) {
      const s = `${row.tyre_width}-${row.tyre_profile}-r${row.tyre_rim}`
      sizeCounts.set(s, (sizeCounts.get(s) || 0) + 1)
      touch('tyres/' + s, row)
    }
  }
  const modelPages: MetadataRoute.Sitemap = [...modelCounts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([path]) => ({
      url: `${SITE_URL}/${path}`,
      lastModified: hubChanged.get(path) || newest,
      changeFrequency: 'daily' as const,
      priority: 0.9,
    }))

  // Tyre pages — the /tyres hub plus one page per in-stock size
  const tyrePages: MetadataRoute.Sitemap = sizeCounts.size === 0 ? [] : [
    { url: `${SITE_URL}/tyres`, lastModified: newest, changeFrequency: 'daily' as const, priority: 0.9 },
    ...[...sizeCounts.keys()].map((size) => ({
      url: `${SITE_URL}/tyres/${size}`,
      lastModified: hubChanged.get('tyres/' + size) || newest,
      changeFrequency: 'daily' as const,
      priority: 0.85,
    })),
  ]

  return [...staticPages, ...makePages, ...modelPages, ...tyrePages, ...productPages]
}
