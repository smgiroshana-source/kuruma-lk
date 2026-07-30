import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isUUID } from '@/lib/slug'
import ProductDetailClient from './ProductDetail'

// Cache product pages for 24 hours — revalidated on-demand when product is updated via API
export const revalidate = 86400

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'

type Props = {
  params: Promise<{ id: string }>
}

/** Look up a product by slug OR UUID. Returns {data, error} like any Supabase query. */
async function findProduct(admin: ReturnType<typeof createAdminClient>, idOrSlug: string, select: string) {
  // Cast to any because the `slug` column may not yet be in the generated Supabase types.
  const base = (admin.from('products') as any).select(select).eq('is_active', true)
  const q = isUUID(idOrSlug) ? base.eq('id', idOrSlug) : base.eq('slug', idOrSlug)
  return q.single() as Promise<{ data: any; error: any }>
}

// Dynamic SEO metadata for each product
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  try {
    const admin = createAdminClient()
    const { data: product } = await findProduct(
      admin, id,
      'name, description, price, show_price, category, condition, make, model, model_code, year, sku, slug, quantity, product_type, tyre_width, tyre_profile, tyre_rim, origin_country, vendor:vendors(name, location), images:product_images(url, sort_order)'
    )

    if (!product) {
      return {
        title: 'Product Not Found',
        description: 'This product could not be found on kuruma.lk',
      }
    }

    const images = (product.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    const imageUrl = images[0]?.url || `${SITE_URL}/og-image.png`
    const vehicle = [product.make, product.model, product.year].filter(Boolean).join(' ')
    const vendorName = (product.vendor as any)?.name || ''
    const vendorLocation = (product.vendor as any)?.location || ''
    const priceText = product.show_price && product.price ? `Rs.${Number(product.price).toLocaleString()}` : ''

    // Canonical always points to the slug URL (or UUID if no slug yet)
    const canonicalSlug = (product as any).slug || id
    const canonicalUrl = `${SITE_URL}/product/${canonicalSlug}`

    const conditionLabel = product.condition ? ` (${product.condition})` : ''
    const title = `${product.name}${conditionLabel} Sri Lanka`
    // Per-product uniqueness first: lead with the seller's own description text
    // when it exists (Search Console flagged the old one-template-fits-all
    // descriptions as thin/duplicate), then layer part-specific facts.
    const ownDesc = (product.description || '').replace(/\s+/g, ' ').trim()
    const tyreSize = product.tyre_width && product.tyre_profile && product.tyre_rim
      ? `${product.tyre_width}/${product.tyre_profile}R${product.tyre_rim}` : ''
    const facts = [
      product.model_code ? `Model code ${product.model_code}` : '',
      tyreSize ? `Size ${tyreSize}` : '',
      product.origin_country ? `Imported from ${product.origin_country}` : '',
      `Part ID ${product.sku}`,
    ].filter(Boolean).join(' · ')
    const description = [
      ownDesc ? ownDesc.slice(0, 150) + (ownDesc.length > 150 ? '…' : '') :
        `${product.condition ? product.condition + ' ' : ''}${product.name}${vehicle ? ' for ' + vehicle : ''} available in Sri Lanka.`,
      facts ? facts + '.' : '',
      priceText ? `Price: ${priceText}.` : 'Contact for price.',
      vendorName ? `Sold by ${vendorName}${vendorLocation ? ', ' + vendorLocation : ''}.` : '',
    ].filter(Boolean).join(' ')

    return {
      title,
      description,
      // Sold-out one-of-a-kind used parts are permanently dead pages — keep
      // them reachable for direct links but out of the index (Search Console
      // reported empty stock pages as soft 404s / crawled-not-indexed).
      robots: Number(product.quantity) > 0 ? undefined : { index: false, follow: true },
      keywords: [
        product.name,
        vehicle ? `${vehicle} ${product.name}` : '',
        vehicle ? `${vehicle} parts` : '',
        vehicle ? `${vehicle} spare parts Sri Lanka` : '',
        product.category,
        product.make ? `${product.make} parts Sri Lanka` : '',
        product.condition || '',
        `${product.name} Sri Lanka`,
        `buy ${product.name} Sri Lanka`,
        'auto parts Sri Lanka',
        product.sku,
        vendorName,
      ].filter(Boolean),
      openGraph: {
        title: `${product.name} | kuruma.lk`,
        description,
        url: canonicalUrl,
        siteName: 'kuruma.lk',
        images: [{ url: imageUrl, width: 800, height: 800, alt: product.name }],
        type: 'website',
        locale: 'en_LK',
      },
      twitter: {
        card: 'summary_large_image',
        title: `${product.name} | kuruma.lk`,
        description,
        images: [imageUrl],
      },
      alternates: {
        canonical: canonicalUrl,
      },
    }
  } catch {
    return { title: 'Auto Part | kuruma.lk' }
  }
}

// JSON-LD structured data for rich snippets in Google
async function getProductJsonLd(idOrSlug: string) {
  try {
    const admin = createAdminClient()
    const { data: product } = await findProduct(
      admin, idOrSlug,
      'name, description, price, show_price, category, condition, make, model, year, sku, slug, quantity, product_type, tyre_width, tyre_profile, tyre_rim, origin_country, vendor:vendors(name, location), images:product_images(url, sort_order)'
    )

    if (!product) return null

    const images = (product.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    const imageUrls = images.map((img: any) => img.url)
    const vendorName = (product.vendor as any)?.name || 'kuruma.lk'
    const productSlug = (product as any).slug || idOrSlug
    const productUrl = `${SITE_URL}/product/${productSlug}`

    const conditionMap: Record<string, string> = {
      'New-Genuine': 'https://schema.org/NewCondition',
      'New-Other': 'https://schema.org/NewCondition',
      'Reconditioned': 'https://schema.org/RefurbishedCondition',
      'Damaged': 'https://schema.org/DamagedCondition',
    }

    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description || product.name,
      image: imageUrls.length > 0 ? imageUrls : undefined,
      sku: product.sku,
      brand: product.make ? { '@type': 'Brand', name: product.make } : undefined,
      category: product.category,
      itemCondition: conditionMap[product.condition] || 'https://schema.org/UsedCondition',
      offers: {
        '@type': 'Offer',
        url: productUrl,
        priceCurrency: 'LKR',
        price: product.show_price && product.price ? Number(product.price) : undefined,
        availability: product.quantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        seller: { '@type': 'Organization', name: vendorName },
      },
      additionalProperty: [
        product.model ? { '@type': 'PropertyValue', name: 'Compatible Vehicle', value: [product.make, product.model, product.year].filter(Boolean).join(' ') } : null,
        product.condition ? { '@type': 'PropertyValue', name: 'Condition', value: product.condition } : null,
      ].filter(Boolean),
    }
  } catch {
    return null
  }
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params

  const admin = createAdminClient()

  if (isUUID(id)) {
    // UUID-based URL — look up the product and redirect to its slug.
    const { data } = await admin
      .from('products')
      .select('slug')
      .eq('id', id)
      .eq('is_active', true)
      .single()
    if (!data) notFound()           // Product deleted or hidden → proper 404 (not soft 404)
    if (data!.slug) redirect(`/product/${data!.slug}`)
    // No slug yet — fall through and render with UUID
  }

  // Full product for the server-rendered details section below (also serves as
  // the slug-existence check → proper 404 for unknown slugs).
  const { data: product } = await findProduct(
    admin, id,
    'name, description, price, show_price, category, condition, make, model, model_code, year, sku, quantity, product_type, tyre_width, tyre_profile, tyre_rim, origin_country, vendor:vendors(name, location)'
  )
  if (!product) notFound()

  const jsonLd = await getProductJsonLd(id)

  const vehicle = [product.make, product.model, product.year].filter(Boolean).join(' ')
  const tyreSize = product.tyre_width && product.tyre_profile && product.tyre_rim
    ? `${product.tyre_width}/${product.tyre_profile}R${product.tyre_rim}` : ''
  const vendorName = (product.vendor as any)?.name || ''
  const vendorLocation = (product.vendor as any)?.location || ''
  const specs: Array<[string, string]> = ([
    ['Part ID', product.sku],
    ['Condition', product.condition],
    ['Make', product.make],
    ['Model', [product.model, product.model_code ? `(${product.model_code})` : ''].filter(Boolean).join(' ')],
    ['Year', product.year],
    ['Category', product.category],
    tyreSize ? ['Tyre size', tyreSize] : null,
    product.origin_country ? ['Origin', product.origin_country] : null,
    ['Availability', Number(product.quantity) > 0 ? `In stock (${product.quantity})` : 'Sold out'],
    vendorName ? ['Seller', [vendorName, vendorLocation].filter(Boolean).join(', ')] : null,
  ].filter(Boolean) as Array<[string, any]>).filter(([, v]) => v)

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ProductDetailClient />

      {/* Server-rendered part details — substantive, unique, crawlable content
          on every listing (Search Console flagged the client-rendered pages as
          thin). Real information for buyers, not filler. */}
      <section className="max-w-5xl mx-auto px-4 pb-10">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6">
          <h2 className="text-lg font-black text-slate-900 mb-4">Part Details — {product.name}</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm mb-5">
            {specs.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{label}</dt>
                <dd className="font-semibold text-slate-800 mt-0.5">{String(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm text-slate-600 leading-relaxed">
            This {product.condition ? product.condition.toLowerCase() + ' ' : ''}{product.name}
            {vehicle ? ` fits ${vehicle} vehicles` : ''}
            {tyreSize ? ` in size ${tyreSize}` : ''}
            {product.origin_country ? `, imported from ${product.origin_country}` : ''}.
            {vendorName ? ` It is listed by ${vendorName}${vendorLocation ? ` in ${vendorLocation}` : ''}, a verified seller on kuruma.lk.` : ''}
            {' '}Quote part ID <strong>{product.sku}</strong> when contacting the seller to confirm fitment
            {product.make ? ` for your exact ${product.make} variant` : ''}.
          </p>
        </div>
      </section>
    </>
  )
}
