import type { Metadata } from 'next'
import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase/admin'

// Tyre hub — lists every size currently in stock, linking to /tyres/[size].
// Sri Lankan tyre buyers search by size ("195/65R15 price in sri lanka");
// this page + the size pages capture those queries.
export const revalidate = 3600

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.kuruma.lk'

export const metadata: Metadata = {
  title: 'Tyres Sri Lanka — All Sizes In Stock',
  description:
    'Browse tyres in stock in Sri Lanka by size — 13" to 22" rims, top brands. ' +
    'Tyre prices follow the market daily, so message the seller on WhatsApp for today\'s best price. kuruma.lk.',
  alternates: { canonical: `${SITE_URL}/tyres` },
  openGraph: {
    title: 'Tyres Sri Lanka — All Sizes In Stock | kuruma.lk',
    description: 'Browse in-stock tyres by size. Message the seller for today\'s best market price.',
    url: `${SITE_URL}/tyres`, siteName: 'kuruma.lk', type: 'website', locale: 'en_LK',
  },
}

export default async function TyresPage() {
  const admin = createAdminClient()
  const { data } = await (admin.from('products') as any)
    .select('tyre_width, tyre_profile, tyre_rim')
    .eq('is_active', true)
    .gt('quantity', 0)
    .not('tyre_width', 'is', null)
    .not('tyre_profile', 'is', null)
    .not('tyre_rim', 'is', null)

  const sizeCounts = new Map<string, number>()
  for (const t of (data || [])) {
    const key = `${t.tyre_width}/${t.tyre_profile}R${t.tyre_rim}`
    sizeCounts.set(key, (sizeCounts.get(key) || 0) + 1)
  }
  // Group by rim for a scannable page
  const byRim = new Map<number, Array<{ size: string; slug: string; count: number }>>()
  for (const [size, count] of sizeCounts) {
    const rim = parseInt(size.split('R')[1])
    const slug = size.toLowerCase().replace('/', '-').replace('r', '-r')
    if (!byRim.has(rim)) byRim.set(rim, [])
    byRim.get(rim)!.push({ size, slug, count })
  }
  const rims = [...byRim.keys()].sort((a, b) => a - b)
  for (const r of rims) byRim.get(r)!.sort((a, b) => a.size.localeCompare(b.size))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Tyres Sri Lanka — All Sizes',
    url: `${SITE_URL}/tyres`,
    numberOfItems: sizeCounts.size,
    breadcrumb: {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'Tyres', item: `${SITE_URL}/tyres` },
      ],
    },
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <nav className="text-xs text-slate-400 mb-3">
          <Link href="/" className="hover:text-orange-500">Home</Link> <span className="mx-1">›</span>
          <span className="text-slate-600 font-semibold">Tyres</span>
        </nav>
        <h1 className="text-2xl sm:text-3xl font-black text-slate-900">
          Tyres in Sri Lanka <span className="text-slate-400 font-semibold text-lg">by size</span>
        </h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          {[...sizeCounts.values()].reduce((a, b) => a + b, 0)} tyres in stock across {sizeCounts.size} sizes.
          Tyre prices move with the market daily — pick your size, then message the seller on WhatsApp for
          <strong> today&apos;s best price</strong>.
        </p>

        {rims.map(rim => (
          <div key={rim} className="mt-8">
            <h2 className="text-base font-black text-slate-700 mb-3">{rim}&quot; rim tyres</h2>
            <div className="flex flex-wrap gap-2">
              {byRim.get(rim)!.map(({ size, slug, count }) => (
                <Link key={slug} href={`/tyres/${slug}`}
                  className="bg-white border border-slate-200 hover:border-orange-400 rounded-xl px-4 py-2.5 text-sm font-bold text-slate-800 transition-colors">
                  {size} <span className="text-slate-400 font-semibold">({count})</span>
                </Link>
              ))}
            </div>
          </div>
        ))}

        <div className="mt-10 bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
          <h2 className="text-lg font-black text-slate-900 mb-2">Buying tyres in Sri Lanka on kuruma.lk</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Find your tyre size on the sidewall of your current tyre — for example <strong>195/65R15</strong> means
            195&nbsp;mm width, 65% profile, 15&quot; rim. Choose your size above to see every tyre in stock from
            verified Sri Lankan sellers, including brands like Bridgestone, Dunlop, Hankook, Michelin and more.
            Because tyre prices change with import availability and the exchange rate, sellers quote the current
            market price on request — message them on WhatsApp with the size you need for a quick, no-obligation quote.
          </p>
        </div>
      </div>
    </div>
  )
}
