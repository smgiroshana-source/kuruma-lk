import type { Metadata } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import ProductDetailClient from './ProductDetail'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://kuruma.lk'

type Props = {
  params: Promise<{ id: string }>
}

// Dynamic SEO metadata for each product
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  try {
    const admin = createAdminClient()
    const { data: product } = await admin
      .from('products')
      .select('name, description, price, show_price, category, condition, make, model, year, sku, vendor:vendors(name, location), images:product_images(url, sort_order)')
      .eq('id', id)
      .eq('is_active', true)
      .single()

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

    const title = `${product.name}${vehicle ? ' — ' + vehicle : ''}${priceText ? ' — ' + priceText : ''}`
    const description = [
      product.name,
      vehicle ? `for ${vehicle}` : '',
      product.condition ? `Condition: ${product.condition}` : '',
      priceText || 'Ask for price',
      vendorName ? `Available at ${vendorName}, ${vendorLocation}` : '',
      'Buy on kuruma.lk — Sri Lanka\'s auto parts marketplace.',
    ].filter(Boolean).join('. ')

    return {
      title,
      description,
      keywords: [
        product.name, product.category, product.make, product.model,
        `${product.make} ${product.model} parts`, 'auto parts Sri Lanka',
        product.sku, vendorName,
      ].filter(Boolean),
      openGraph: {
        title: `${product.name} | kuruma.lk`,
        description,
        url: `${SITE_URL}/product/${id}`,
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
        canonical: `${SITE_URL}/product/${id}`,
      },
    }
  } catch {
    return { title: 'Auto Part | kuruma.lk' }
  }
}

// JSON-LD structured data for rich snippets in Google
async function getProductJsonLd(id: string) {
  try {
    const admin = createAdminClient()
    const { data: product } = await admin
      .from('products')
      .select('name, description, price, show_price, category, condition, make, model, year, sku, quantity, vendor:vendors(name, location), images:product_images(url, sort_order)')
      .eq('id', id)
      .eq('is_active', true)
      .single()

    if (!product) return null

    const images = (product.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
    const imageUrls = images.map((img: any) => img.url)
    const vendorName = (product.vendor as any)?.name || 'kuruma.lk'

    const conditionMap: Record<string, string> = {
      'Excellent': 'https://schema.org/NewCondition',
      'Good': 'https://schema.org/UsedCondition',
      'Fair': 'https://schema.org/UsedCondition',
      'Salvage': 'https://schema.org/DamagedCondition',
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
        url: `${SITE_URL}/product/${id}`,
        priceCurrency: 'LKR',
        price: product.show_price && product.price ? Number(product.price) : undefined,
        availability: product.quantity > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
        seller: {
          '@type': 'Organization',
          name: vendorName,
        },
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
