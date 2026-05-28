import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
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
      'name, description, price, show_price, category, condition, make, model, year, sku, slug, vendor:vendors(name, location), images:product_images(url, sort_order)'
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
    const description = [
      `${product.condition ? product.condition + ' ' : ''}${product.name}${vehicle ? ' for ' + vehicle : ''} available in Sri Lanka.`,
      priceText ? `Price: ${priceText}.` : 'Contact for price.',
      vendorName ? `Sold by ${vendorName}${vendorLocation ? ', ' + vendorLocation : ''}.` : '',
      'Buy auto parts online at kuruma.lk — Sri Lanka\'s trusted vehicle parts marketplace.',
    ].filter(Boolean).join(' ')

    return {
      title,
      description,
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
      'name, description, price, show_price, category, condition, make, model, year, sku, slug, quantity, vendor:vendors(name, location), images:product_images(url, sort_order)'
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

  // If the URL contains a raw UUID, redirect permanently to the slug URL.
  // This handles all old links (from Google, WhatsApp shares, etc.) without breaking them.
  if (isUUID(id)) {
    const admin = createAdminClient()
    const { data } = await admin
      .from('products')
      .select('slug')
      .eq('id', id)
      .eq('is_active', true)
      .single()
    if (data?.slug) {
      redirect(`/product/${data.slug}`)
    }
    // No slug yet — render normally with UUID (product pages created before backfill)
  }

  const jsonLd = await getProductJsonLd(id)

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <ProductDetailClient />
    </>
  )
}
