import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { fetchAllRows } from '@/lib/fetchAll'
import MakePageClient from './MakePageClient'

// Regenerate every hour — same cadence as homepage
export const revalidate = 3600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.kuruma.lk'

type Props = { params: Promise<{ make: string }> }

/**
 * "toyota" → "Toyota"
 * "mercedes-benz" → "Mercedes-Benz"
 */
function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join('-')
}

/**
 * "mercedes-benz" → "mercedes benz"  (for Supabase ilike query)
 * Most makes are single-word so this is a no-op.
 */
function slugToMakeQuery(slug: string): string {
  return slug.replace(/-/g, ' ')
}

/** Build all make slug paths at deploy time from the DB */
export async function generateStaticParams() {
  const admin = createAdminClient()
  const { data } = await (admin.from('products') as any)
    .select('make')
    .eq('is_active', true)
    .gt('quantity', 0)

  const makes = [
    ...new Set(
      (data || [])
        .map((p: any) => p.make as string | null)
        .filter(Boolean) as string[],
    ),
  ]

  return makes.map((make) => ({
    make: make.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
  }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { make: makeSlug } = await params
  const displayName = slugToDisplayName(makeSlug)
  const makeQuery = slugToMakeQuery(makeSlug)

  const admin = createAdminClient()
  const { count } = await (admin.from('products') as any)
    .select('id', { count: 'exact', head: true })
    .ilike('make', makeQuery)
    .eq('is_active', true)
    .gt('quantity', 0)

  if (!count) {
    return { title: 'Parts Not Found', robots: { index: false, follow: false } }
  }

  const title = `${displayName} Parts Sri Lanka`
  const description =
    `Shop ${count} ${displayName} spare parts & accessories in Sri Lanka. ` +
    `New-genuine, reconditioned & aftermarket parts from trusted dealers. ` +
    `Buy ${displayName} auto parts online at kuruma.lk.`

  return {
    title,
    description,
    keywords: [
      `${displayName} parts Sri Lanka`,
      `${displayName} spare parts`,
      `buy ${displayName} parts online Sri Lanka`,
      `${displayName} auto parts`,
      `${displayName} spare parts price Sri Lanka`,
      `${displayName} genuine parts`,
      `${displayName} reconditioned parts Sri Lanka`,
    ],
    openGraph: {
      title: `${displayName} Parts Sri Lanka | kuruma.lk`,
      description,
      url: `${SITE_URL}/${makeSlug}`,
      siteName: 'kuruma.lk',
      type: 'website',
      locale: 'en_LK',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${displayName} Parts Sri Lanka | kuruma.lk`,
      description,
    },
    alternates: { canonical: `${SITE_URL}/${makeSlug}` },
  }
}

export default async function MakePage({ params }: Props) {
  const { make: makeSlug } = await params
  const makeQuery = slugToMakeQuery(makeSlug)
  const displayName = slugToDisplayName(makeSlug)

  const admin = createAdminClient()
  // Load ALL in-stock parts for this make (paginated, id tiebreaker for stable
  // order). The old .limit(500) both truncated browsing AND made the header
  // read a flat "500" for any make with 500+ parts (Toyota 1819, Suzuki 2739…).
  const products = await fetchAllRows((from, to) => (admin.from('products') as any)
    .select(
      'id, name, sku, category, make, model, year, condition, price, show_price, quantity, slug, created_at, ' +
      'product_type, tyre_width, tyre_profile, tyre_rim, origin_country, ' +
      'vendor:vendors(id, name, slug, phone, whatsapp), images:product_images(url, sort_order)',
    )
    .ilike('make', makeQuery)
    .eq('is_active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to))

  // No products → proper 404 (also blocks random slugs like /blahblah)
  if (!products || products.length === 0) notFound()

  // Keep only primary image per product (reduces client payload)
  const normalizedProducts = products.map((p: any) => ({
    ...p,
    images: p.images
      ? [p.images.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0]].filter(Boolean)
      : [],
  }))

  const count = products.length

  // Top categories actually in stock for this make (drives the on-page content)
  const catCounts: Record<string, number> = {}
  for (const p of products) { const c = (p.category || '').trim(); if (c && c !== 'Other') catCounts[c] = (catCounts[c] || 0) + 1 }
  const topCategories = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, n]) => ({ name, count: n }))

  // FAQ shown on the page AND mirrored into FAQPage schema (Google requires the
  // schema's text to be visible on the page).
  const faqs = [
    {
      q: `Where can I buy ${displayName} spare parts in Sri Lanka?`,
      a: `kuruma.lk lists ${count} ${displayName} part${count === 1 ? '' : 's'} and accessories from verified Sri Lankan dealers. Browse the parts on this page, then contact the seller directly by WhatsApp or phone to buy.`,
    },
    {
      q: `Are these ${displayName} parts genuine or reconditioned?`,
      a: `You'll find new-genuine, brand-new aftermarket, and quality reconditioned ${displayName} parts. Every listing clearly shows its condition so you can choose what suits your budget.`,
    },
    {
      q: `How much do ${displayName} spare parts cost in Sri Lanka?`,
      a: `Prices vary by part and condition. Many listings show the price directly; others are marked "Ask Price", so message the dealer for a quick quote.`,
    },
    {
      q: `Is island-wide delivery available for ${displayName} parts?`,
      a: `Most dealers on kuruma.lk arrange delivery across Sri Lanka. Confirm delivery and payment options with the seller when you contact them.`,
    },
  ]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${displayName} Parts Sri Lanka`,
    description: `${displayName} spare parts available in Sri Lanka on kuruma.lk`,
    url: `${SITE_URL}/${makeSlug}`,
    numberOfItems: count,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: `${displayName} Parts`, item: `${SITE_URL}/${makeSlug}` },
      ],
    },
  }

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <MakePageClient
        makeSlug={makeSlug}
        displayName={displayName}
        products={normalizedProducts}
        topCategories={topCategories}
        faqs={faqs}
      />
    </>
  )
}
