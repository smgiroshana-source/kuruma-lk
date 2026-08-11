import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import ProductThumb from '@/components/ProductThumb'

// Tyre size landing pages — /tyres/195-65-r15 targets "195/65R15 price sri
// lanka"-style queries, the dominant way tyre buyers search.
export const revalidate = 3600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.kuruma.lk'

type Props = { params: Promise<{ size: string }> }

/** "195-65-r15" → { width: 195, profile: 65, rim: 15, label: "195/65R15" } */
function parseSizeSlug(slug: string) {
  const m = slug.match(/^(\d{3})-(\d{2})-r(\d{2})$/)
  if (!m) return null
  return { width: +m[1], profile: +m[2], rim: +m[3], label: `${m[1]}/${m[2]}R${m[3]}` }
}

export async function generateStaticParams() {
  const admin = createAdminClient()
  const { data } = await (admin.from('products') as any)
    .select('tyre_width, tyre_profile, tyre_rim')
    .eq('is_active', true).gt('quantity', 0)
    .not('tyre_width', 'is', null).not('tyre_profile', 'is', null).not('tyre_rim', 'is', null)
  const sizes = new Set<string>()
  for (const t of (data || [])) sizes.add(`${t.tyre_width}-${t.tyre_profile}-r${t.tyre_rim}`)
  return [...sizes].map(size => ({ size }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { size } = await params
  const parsed = parseSizeSlug(size)
  if (!parsed) return { title: 'Tyres Not Found', robots: { index: false, follow: false } }

  const admin = createAdminClient()
  const { count } = await (admin.from('products') as any)
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true).gt('quantity', 0)
    .eq('tyre_width', parsed.width).eq('tyre_profile', parsed.profile).eq('tyre_rim', parsed.rim)
  if (!count) return { title: 'Tyres Not Found', robots: { index: false, follow: false } }

  const title = `${parsed.label} Tyres Sri Lanka — Today's Price`
  const description =
    `${count} ${parsed.label} tyre${count === 1 ? '' : 's'} in stock in Sri Lanka. ` +
    `Tyre prices follow the market daily — message the seller on WhatsApp for today's best ${parsed.label} price. ` +
    `Brand-new and quality used tyres from verified dealers on kuruma.lk.`

  return {
    title,
    description,
    keywords: [
      `${parsed.label} tyre price Sri Lanka`, `${parsed.label} tyres`, `${parsed.label} price`,
      `${parsed.width}/${parsed.profile}R${parsed.rim} Sri Lanka`, `tyre ${parsed.label}`,
      `${parsed.rim} inch tyres Sri Lanka`, 'tyre price Sri Lanka today',
    ],
    openGraph: {
      title: `${title} | kuruma.lk`, description,
      url: `${SITE_URL}/tyres/${size}`, siteName: 'kuruma.lk', type: 'website', locale: 'en_LK',
    },
    twitter: { card: 'summary_large_image', title: `${title} | kuruma.lk`, description },
    alternates: { canonical: `${SITE_URL}/tyres/${size}` },
  }
}

export default async function TyreSizePage({ params }: Props) {
  const { size } = await params
  const parsed = parseSizeSlug(size)
  if (!parsed) notFound()

  const admin = createAdminClient()
  const { data: products } = await (admin.from('products') as any)
    .select('id, name, sku, make, condition, quantity, slug, product_type, tyre_width, tyre_profile, tyre_rim, origin_country, category, vendor:vendors(name), images:product_images(url, sort_order)')
    .eq('is_active', true).gt('quantity', 0)
    .eq('tyre_width', parsed!.width).eq('tyre_profile', parsed!.profile).eq('tyre_rim', parsed!.rim)
    .order('created_at', { ascending: false })
    .limit(200)

  if (!products || products.length === 0) notFound()

  const faqs = [
    {
      q: `What is the price of ${parsed!.label} tyres in Sri Lanka?`,
      a: `Tyre prices change daily with import availability and exchange rates, so sellers quote the current best market price on request. Message the seller on WhatsApp with the tyre you want — quotes are quick and there's no obligation.`,
    },
    {
      q: `Which brands are available in ${parsed!.label}?`,
      a: `Availability changes with each shipment — currently ${products.length} ${parsed!.label} tyre${products.length === 1 ? ' is' : 's are'} in stock from the sellers on this page. Check each listing for the brand and country of manufacture.`,
    },
    {
      q: `Can I fit ${parsed!.label} tyres at the seller's shop?`,
      a: `Most tyre sellers on kuruma.lk offer fitting, balancing and alignment at their premises. Confirm services when you contact them.`,
    },
  ]

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${parsed!.label} Tyres Sri Lanka`,
    url: `${SITE_URL}/tyres/${size}`,
    numberOfItems: products.length,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Tyres', item: `${SITE_URL}/tyres` },
        { '@type': 'ListItem', position: 3, name: `${parsed!.label} Tyres`, item: `${SITE_URL}/tyres/${size}` },
      ],
    },
  }
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <nav className="text-xs text-slate-400 mb-3">
          <Link href="/" className="hover:text-orange-500">Home</Link> <span className="mx-1">›</span>
          <Link href="/tyres" className="hover:text-orange-500">Tyres</Link> <span className="mx-1">›</span>
          <span className="text-slate-600 font-semibold">{parsed!.label}</span>
        </nav>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
          {parsed!.label} Tyres <span className="text-slate-400 font-semibold text-lg">Sri Lanka</span>
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          {products.length} in stock. Prices follow the market daily — message the seller on WhatsApp for
          <strong> today&apos;s best {parsed!.label} price</strong>.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mt-6">
          {products.map((p: any) => {
            const img = (p.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0]
            return (
              <Link key={p.id} href={`/product/${p.slug || p.id}`}
                className="bg-white rounded-xl border border-slate-200 hover:border-orange-400 overflow-hidden transition-colors">
                {img
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={img.url} alt={p.name} loading="lazy" className="w-full aspect-square object-cover" />
                  : <ProductThumb product={p} variant="card" className="w-full aspect-square" />}
                <div className="p-3">
                  <p className="text-sm font-bold text-slate-900 leading-tight line-clamp-2">{p.name}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {[p.condition, p.origin_country].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs font-bold text-orange-500 mt-1.5">Ask today&apos;s price →</p>
                </div>
              </Link>
            )
          })}
        </div>

        <div className="mt-10 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
          <h2 className="text-lg font-black text-slate-900 mb-3">About {parsed!.label} tyres</h2>
          <p className="text-sm text-slate-600 leading-relaxed mb-4">
            {parsed!.label} means a {parsed!.width}&nbsp;mm tread width, {parsed!.profile}% sidewall profile and
            a {parsed!.rim}&quot; rim diameter. It&apos;s fitted on many popular vehicles in Sri Lanka — check your
            current tyre&apos;s sidewall to confirm the size before ordering. Because tyre prices in Sri Lanka change
            with import availability and the exchange rate, the sellers here quote the live market price on request
            rather than a fixed list price — that way you always get today&apos;s rate, not last month&apos;s.
          </p>
          <div className="space-y-3">
            {faqs.map(f => (
              <div key={f.q}>
                <h3 className="text-sm font-bold text-slate-800">{f.q}</h3>
                <p className="text-sm text-slate-600 mt-0.5">{f.a}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
