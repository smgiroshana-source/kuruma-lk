'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { thumbnail, medium, thumb64, imgFallback } from '@/lib/image'

const CONDITION_COLORS: Record<string, string> = {
  'Excellent': 'bg-emerald-100 text-emerald-700',
  'Good': 'bg-blue-100 text-blue-700',
  'Fair': 'bg-amber-100 text-amber-700',
  'Salvage': 'bg-red-100 text-red-700',
}

function formatPrice(price: number | null, showPrice: boolean) {
  if (!showPrice || price === null) return 'Ask Price'
  return 'Rs.' + price.toLocaleString()
}

function getProductImage(product: any): string | null {
  if (!product.images || product.images.length === 0) return null
  const primary = product.images.find((img: any) => img.sort_order === 0)
  return (primary || product.images[0])?.url || null
}

export default function ProductDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [product, setProduct] = useState<any>(null)
  const [related, setRelated] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeImage, setActiveImage] = useState(0)
  const [lightbox, setLightbox] = useState(false)
  const imageScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function fetchProduct() {
      try {
        const res = await fetch(`/api/products/${params.id}`)
        if (!res.ok) { setError('Product not found'); setLoading(false); return }
        const json = await res.json()
        setProduct(json.product)
        setRelated(json.related || [])
      } catch { setError('Failed to load product') }
      setLoading(false)
    }
    if (params.id) fetchProduct()
  }, [params.id])

  function buildWhatsAppUrl() {
    if (!product || !product.vendor) return '#'
    const price = product.show_price && product.price ? `Rs.${Number(product.price).toLocaleString()}` : 'price not listed'
    const vehicle = [product.make, product.model, product.year].filter(Boolean).join(' ')
    const link = typeof window !== 'undefined' ? window.location.href : ''
    const msg = encodeURIComponent(
      `Hi ${product.vendor.name},\n\n` +
      `I'm interested in this part:\n` +
      `🔧 *${product.name}*\n` +
      `📋 Part ID: ${product.sku}\n` +
      (vehicle ? `🚗 Vehicle: ${vehicle}\n` : '') +
      `💰 Listed: ${price}\n` +
      `📦 Condition: ${product.condition}\n` +
      (link ? `🔗 ${link}\n` : '') +
      `\nIs this available? Please confirm price and stock.`
    )
    return `https://wa.me/${product.vendor.whatsapp}?text=${msg}`
  }

  function buildShareUrl() {
    if (!product) return '#'
    const price = product.show_price && product.price ? `Rs.${Number(product.price).toLocaleString()}` : ''
    const link = typeof window !== 'undefined' ? window.location.href : ''
    const msg = encodeURIComponent(
      `Check out this part on kuruma.lk:\n\n` +
      `🔧 *${product.name}*\n` +
      (price ? `💰 ${price}\n` : '') +
      `📦 ${product.condition}\n` +
      `🏪 ${product.vendor?.name || ''}\n` +
      `\n${link}`
    )
    return `https://wa.me/?text=${msg}`
  }

  function navigateImage(dir: number) {
    if (!product?.images) return
    const len = product.images.length
    const next = (activeImage + dir + len) % len
    setActiveImage(next)
    // Scroll to image on mobile
    if (imageScrollRef.current) {
      const child = imageScrollRef.current.children[next] as HTMLElement
      if (child) child.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }

  // Handle swipe-based image scroll
  function handleImageScroll() {
    if (!imageScrollRef.current || !product?.images) return
    const el = imageScrollRef.current
    const imageWidth = el.scrollWidth / product.images.length
    const idx = Math.round(el.scrollLeft / imageWidth)
    if (idx !== activeImage && idx >= 0 && idx < product.images.length) setActiveImage(idx)
  }

  if (loading) return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-3 py-2.5">
        <div className="max-w-5xl mx-auto flex items-center gap-2">
          <div className="w-8 h-8 bg-slate-100 rounded-full animate-pulse" />
          <div className="h-4 bg-slate-100 rounded w-24 animate-pulse" />
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-3 py-4">
        <div className="animate-pulse"><div className="aspect-square bg-slate-100 rounded-xl mb-4" /><div className="h-5 bg-slate-100 rounded w-1/3 mb-2" /><div className="h-7 bg-slate-100 rounded w-2/3 mb-2" /><div className="h-4 bg-slate-100 rounded w-1/2" /></div>
      </div>
    </div>
  )

  if (error || !product) return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 px-3 py-2.5">
        <div className="max-w-5xl mx-auto"><a href="/" className="text-xl font-black text-orange-500">kuruma.lk</a></div>
      </header>
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <p className="text-5xl mb-3 opacity-80">😔</p>
        <p className="text-slate-500 font-bold text-lg">{error || 'Product not found'}</p>
        <a href="/" className="inline-block mt-4 bg-orange-500 active:bg-orange-600 text-white font-bold px-6 py-2.5 rounded-xl">Back to Marketplace</a>
      </div>
    </div>
  )

  const images = (product.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
  const vendor = product.vendor

  return (
    <div className="min-h-screen bg-slate-50 pb-20 sm:pb-4">

      {/* Lightbox */}
      {lightbox && images.length > 0 && (
        <div className="fixed inset-0 bg-black z-[100] flex items-center justify-center" onClick={() => setLightbox(false)}>
          <button onClick={() => setLightbox(false)} className="absolute top-3 right-3 text-white z-10 w-11 h-11 flex items-center justify-center bg-white/10 rounded-full active:bg-white/20 text-xl">✕</button>
          {images.length > 1 && (<>
            <button onClick={(e) => { e.stopPropagation(); navigateImage(-1) }} className="absolute left-2 top-1/2 -translate-y-1/2 text-white z-10 w-12 h-12 flex items-center justify-center bg-white/10 rounded-full active:bg-white/20 text-2xl font-bold">‹</button>
            <button onClick={(e) => { e.stopPropagation(); navigateImage(1) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-white z-10 w-12 h-12 flex items-center justify-center bg-white/10 rounded-full active:bg-white/20 text-2xl font-bold">›</button>
          </>)}
          <img src={images[activeImage]?.url} alt={product.name} className="max-w-[95vw] max-h-[85vh] object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_: any, i: number) => (
              <button key={i} onClick={(e) => { e.stopPropagation(); setActiveImage(i) }}
                className={`w-2 h-2 rounded-full transition ${i === activeImage ? 'bg-white w-5' : 'bg-white/40'}`} />
            ))}
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => router.back()} className="flex items-center gap-1 text-sm font-semibold text-slate-500 active:text-slate-700 -ml-1 flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <a href="/" className="text-lg font-black text-orange-500">kuruma.lk</a>
        </div>
      </header>

      <main className="max-w-5xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 md:gap-6 md:px-4 md:py-6">

          {/* ─── IMAGE GALLERY ─── */}
          <div>
            {images.length > 0 ? (
              <div>
                {/* Mobile: horizontally scrollable full-bleed images */}
                <div className="md:hidden">
                  <div ref={imageScrollRef} onScroll={handleImageScroll}
                    className="flex overflow-x-auto snap-x snap-mandatory" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
                    {images.map((img: any, i: number) => (
                      <div key={img.id} className="w-full flex-shrink-0 snap-center aspect-square bg-white" onClick={() => setLightbox(true)}>
                        <img src={medium(img.url)} alt={product.name} loading={i === 0 ? 'eager' : 'lazy'} onError={imgFallback} className="w-full h-full object-contain" />
                      </div>
                    ))}
                  </div>
                  {/* Dots */}
                  {images.length > 1 && (
                    <div className="flex justify-center gap-1.5 py-2 bg-white">
                      {images.map((_: any, i: number) => (
                        <span key={i} className={`h-1.5 rounded-full transition-all ${i === activeImage ? 'w-5 bg-orange-500' : 'w-1.5 bg-slate-300'}`} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Desktop: main image + thumbnails */}
                <div className="hidden md:block">
                  <div className="relative bg-white rounded-2xl border border-slate-200 overflow-hidden cursor-zoom-in aspect-square" onClick={() => setLightbox(true)}>
                    <img src={medium(images[activeImage]?.url)} alt={product.name} onError={imgFallback} className="w-full h-full object-contain" />
                    {images.length > 1 && (<>
                      <button onClick={(e) => { e.stopPropagation(); navigateImage(-1) }} className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full shadow-lg flex items-center justify-center text-slate-600 hover:bg-white text-lg font-bold">‹</button>
                      <button onClick={(e) => { e.stopPropagation(); navigateImage(1) }} className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/90 rounded-full shadow-lg flex items-center justify-center text-slate-600 hover:bg-white text-lg font-bold">›</button>
                    </>)}
                    <span className="absolute bottom-3 right-3 bg-black/60 text-white text-[11px] font-bold px-2 py-1 rounded-lg">{activeImage + 1} / {images.length}</span>
                  </div>
                  {images.length > 1 && (
                    <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
                      {images.map((img: any, i: number) => (
                        <button key={img.id} onClick={() => setActiveImage(i)}
                          className={`w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 border-2 transition ${i === activeImage ? 'border-orange-500 shadow-md' : 'border-slate-200 hover:border-slate-400'}`}>
                          <img src={thumb64(img.url)} alt="" onError={imgFallback} className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-white aspect-square flex items-center justify-center md:rounded-2xl md:border md:border-slate-200">
                <div className="text-center"><span className="text-6xl opacity-20">🔧</span><p className="text-slate-400 text-sm mt-2">No photos</p></div>
              </div>
            )}
          </div>

          {/* ─── PRODUCT INFO ─── */}
          <div className="px-3 sm:px-4 md:px-0 pt-3 md:pt-0">
            {/* Badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded font-semibold text-slate-500">{product.sku}</span>
              <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${CONDITION_COLORS[product.condition] || 'bg-slate-100 text-slate-600'}`}>{product.condition}</span>
              <span className="text-[11px] font-semibold text-slate-400">{product.category}</span>
            </div>

            <h1 className="text-xl sm:text-2xl font-black text-slate-900 leading-tight">{product.name}</h1>

            {(product.make || product.model || product.year) && (
              <p className="text-sm text-slate-500 mt-1">{[product.make, product.model, product.year].filter(Boolean).join(' · ')}</p>
            )}

            {/* Price — visible immediately */}
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-black text-orange-600">{formatPrice(product.price, product.show_price)}</span>
              {product.quantity > 0 && <span className="text-sm text-emerald-600 font-semibold">{product.quantity} in stock</span>}
            </div>

            {/* Desktop: WhatsApp + Call (mobile has sticky bar) */}
            {vendor && (
              <div className="hidden md:flex gap-2 mt-4">
                <a href={buildWhatsAppUrl()} target="_blank" className="flex-1 bg-green-500 hover:bg-green-600 text-white font-bold text-sm text-center py-3 rounded-xl transition">💬 WhatsApp Inquiry</a>
                <a href={`tel:${vendor.phone}`} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm px-6 py-3 rounded-xl transition">📞 Call</a>
                <button
                  onClick={() => {
                    if (navigator.share) {
                      navigator.share({
                        title: product.name,
                        text: `Check out this part on kuruma.lk: ${product.name}`,
                        url: window.location.href,
                      }).catch(() => {})
                    } else {
                      window.open(buildShareUrl(), '_blank')
                    }
                  }}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-sm px-4 py-3 rounded-xl transition"
                  title="Share this product">
                  📤 Share
                </button>
              </div>
            )}

            {product.description && (
              <div className="mt-4 bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                <h3 className="text-[11px] font-bold text-slate-400 uppercase mb-1.5">Description</h3>
                <p className="text-sm text-slate-700 whitespace-pre-line leading-relaxed">{product.description}</p>
              </div>
            )}

            {/* Vendor Card */}
            {vendor && (
              <div className="mt-3 bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-purple-500 flex items-center justify-center text-white font-black flex-shrink-0">
                    {vendor.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-900">{vendor.name}</p>
                    <p className="text-xs text-slate-400">{vendor.location}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Specs table */}
            <div className="mt-3 bg-white rounded-xl border border-slate-200 overflow-hidden">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase px-3.5 pt-3 pb-1.5">Details</h3>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ['Part ID', product.sku],
                    ['Category', product.category],
                    ['Condition', product.condition],
                    ['Make', product.make],
                    ['Model', product.model],
                    ['Year', product.year],
                    ['In Stock', product.quantity + ' available'],
                  ].filter(([, val]) => val).map(([label, val], i) => (
                    <tr key={label} className={i % 2 === 0 ? 'bg-slate-50/50' : ''}>
                      <td className="px-3.5 py-2 text-slate-400 font-semibold text-xs w-1/3">{label}</td>
                      <td className="px-3.5 py-2 text-slate-800 font-semibold text-sm">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Related products */}
        {related.length > 0 && (
          <div className="px-3 sm:px-4 mt-6 mb-6">
            <h2 className="text-base font-black text-slate-900 mb-3">Related Parts</h2>
            <div className="flex gap-2.5 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
              {related.slice(0, 8).map((item: any) => {
                const imgUrl = getProductImage(item)
                return (
                  <a key={item.id} href={`/product/${item.id}`} className="flex-shrink-0 w-36 sm:w-44 bg-white rounded-xl border border-slate-200 overflow-hidden active:shadow-md transition">
                    <div className="aspect-square bg-slate-50 overflow-hidden">
                      {imgUrl ? <img src={thumbnail(imgUrl)} alt={item.name} loading="lazy" onError={imgFallback} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center"><span className="text-2xl opacity-20">🔧</span></div>}
                    </div>
                    <div className="p-2">
                      <h3 className="font-bold text-[11px] text-slate-900 line-clamp-2 leading-tight">{item.name}</h3>
                      <p className="font-black text-orange-600 text-xs mt-1">{formatPrice(item.price, item.show_price)}</p>
                    </div>
                  </a>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* ─── MOBILE STICKY ACTION BAR ─── */}
      {vendor && (
        <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-50 shadow-2xl" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex items-center gap-2 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <p className="font-black text-orange-600 text-lg leading-tight">{formatPrice(product.price, product.show_price)}</p>
              <p className="text-[10px] text-slate-400 truncate">{product.name}</p>
            </div>
            <button
              onClick={() => {
                if (navigator.share) {
                  navigator.share({ title: product.name, text: `Check out this part on kuruma.lk: ${product.name}`, url: window.location.href }).catch(() => {})
                } else {
                  window.open(buildShareUrl(), '_blank')
                }
              }}
              className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-sm active:bg-slate-50 flex-shrink-0" title="Share">📤</button>
            <a href={`tel:${vendor.phone}`} className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-base active:bg-slate-50 flex-shrink-0">📞</a>
            <a href={buildWhatsAppUrl()} target="_blank" className="bg-green-500 active:bg-green-600 text-white font-bold text-sm px-5 py-2.5 rounded-xl flex-shrink-0">💬 WhatsApp</a>
          </div>
        </div>
      )}

      <footer className="bg-slate-900 text-slate-400 text-xs py-6 text-center">
        <p className="font-bold text-white text-sm mb-0.5">kuruma.lk</p>
        <p>Sri Lanka&apos;s Auto Parts Marketplace</p>
      </footer>
    </div>
  )
}
