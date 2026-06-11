import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import MakePageClient from './MakePageClient'

// Regenerate every hour — same cadence as homepage
export const revalidate = 3600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'

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
  const { data: products } = await (admin.from('products') as any)
    .select(
      'id, name, sku, category, make, model, year, condition, price, show_price, quantity, slug, created_at, ' +
      'product_type, tyre_width, tyre_profile, tyre_rim, origin_country, ' +
      'vendor:vendors(id, name, slug, phone, whatsapp), images:product_images(url, sort_order)',
    )
    .ilike('make', makeQuery)
    .eq('is_active', true)
    .gt('quantity', 0)
    .order('created_at', { ascending: false })
    .limit(500)

  // No products → proper 404 (also blocks random slugs like /blahblah)
  if (!products || products.length === 0) notFound()

  // Keep only primary image per product (reduces client payload)
  const normalizedProducts = products.map((p: any) => ({
    ...p,
    images: p.images
      ? [p.images.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0]].filter(Boolean)
      : [],
  }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${displayName} Parts Sri Lanka`,
    description: `${displayName} spare parts available in Sri Lanka on kuruma.lk`,
    url: `${SITE_URL}/${makeSlug}`,
    numberOfItems: products.length,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: `${displayName} Parts`, item: `${SITE_URL}/${makeSlug}` },
      ],
    },
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MakePageClient
        makeSlug={makeSlug}
        displayName={displayName}
        products={normalizedProducts}
      />
    </>
  )
}
