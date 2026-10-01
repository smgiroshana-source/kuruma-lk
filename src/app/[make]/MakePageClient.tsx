'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { thumbnail, imgFallback } from '@/lib/image'
import ProductThumb, { showsThumb } from '@/components/ProductThumb'

const ALL_CATEGORIES = [
  'Engine Parts', 'Transmission & Drivetrain', 'Suspension & Steering', 'Brake System',
  'Electrical & Electronics', 'Body Parts', 'Lighting', 'Interior Parts',
  'A/C & Radiator', 'Wheels & Tires', 'Exhaust System', 'Filters & Fluids',
  'Accessories', 'Hybrid & EV Parts', 'Other', 'Windscreen',
  'Beading Belts & Rubber', 'Audio & Video', 'Safety',
]

function formatPrice(price: number | null, showPrice: boolean) {
  if (!showPrice || price === null) return 'Ask Price'
  return 'Rs. ' + price.toLocaleString()
}

function getPrimaryImage(product: any): string | null {
  if (!product.images || product.images.length === 0) return null
  const primary = product.images.find((img: any) => img.sort_order === 0)
  return (primary || product.images[0])?.url || null
}

function conditionBadge(condition: string) {
  if (condition === 'New-Genuine' || condition === 'New-Other') {
    return 'bg-[#ecfdf5] text-[#059669]'
  }
  if (condition === 'Reconditioned') return 'bg-[#eff6ff] text-[#2563eb]'
  if (condition === 'Damaged') return 'bg-[#fef2f2] text-[#dc2626]'
  return 'bg-[#f5f5f5] text-[#888]'
}

type Props = {
  makeSlug: string
  displayName: string
  products: any[]
  topCategories?: { name: string; count: number }[]
  faqs?: { q: string; a: string }[]
}

export default function MakePageClient({ makeSlug, displayName, products, topCategories = [], faqs = [] }: Props) {
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [conditionFilter, setConditionFilter] = useState('All')
  const [sortBy, setSortBy] = useState('newest')
  const [search, setSearch] = useState('')
  const [visibleCount, setVisibleCount] = useState(50)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  // Reset pagination when filters change
  useEffect(() => { setVisibleCount(50) }, [selectedCategory, conditionFilter, sortBy, search])

  // Infinite scroll. Re-observe on each visibleCount change: IntersectionObserver
  // only fires on a state CHANGE, so a still-intersecting sentinel after a load
  // would otherwise never fire again (stuck on "Loading more…").
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) setVisibleCount(n => n + 50) },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [visibleCount])

  // Categories that have stock (respecting current condition filter)
  const availableCategories = useMemo(() => {
    const cats = new Set(
      products
        .filter(p => conditionFilter === 'All' || p.condition === conditionFilter)
        .map((p: any) => p.category as string)
        .filter(Boolean),
    )
    return ALL_CATEGORIES.filter(c => cats.has(c))
  }, [products, conditionFilter])

  const filteredProducts = useMemo(() => {
    let result = products.filter(p => {
      if (selectedCategory !== 'All' && p.category !== selectedCategory) return false
      if (conditionFilter !== 'All' && p.condition !== conditionFilter) return false
      if (search) {
        const s = search.toLowerCase()
        if (
          !p.name.toLowerCase().includes(s) &&
          !(p.sku || '').toLowerCase().includes(s) &&
          !(p.model || '').toLowerCase().includes(s)
        ) return false
      }
      return true
    })

    switch (sortBy) {
      case 'price-low':  result.sort((a, b) => (a.price || 0) - (b.price || 0)); break
      case 'price-high': result.sort((a, b) => (b.price || 0) - (a.price || 0)); break
      case 'name-az':    result.sort((a, b) => a.name.localeCompare(b.name)); break
      default:           result.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    }

    return result
  }, [products, selectedCategory, conditionFilter, sortBy, search])

  const visibleProducts = filteredProducts.slice(0, visibleCount)
  const hasMore = filteredProducts.length > visibleCount

  function clearFilters() {
    setSelectedCategory('All')
    setConditionFilter('All')
    setSearch('')
    setSortBy('newest')
  }

  const activeFilterCount = [
    selectedCategory !== 'All',
    conditionFilter !== 'All',
    !!search,
  ].filter(Boolean).length

  return (
    <div className="min-h-screen bg-[#f5f5f5] overflow-x-hidden">
      {/* ── Header ── */}
      <header className="bg-white sticky top-0 z-50 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-b border-[#f0f0f0]">
        <div className="max-w-7xl mx-auto px-3 sm:px-5">
          <div className="flex items-center justify-between py-2.5">
            <a href="/" className="flex items-center gap-0.5 flex-shrink-0">
              <span className="text-2xl font-black tracking-tight text-[#ff6b35]">kuruma</span>
              <span className="text-2xl font-black tracking-tight text-[#222]">.lk</span>
            </a>
            <a
              href="/"
              className="text-xs font-semibold px-3.5 py-2 rounded-[10px] bg-white text-[#555] border-[1.5px] border-[#e5e5e5] active:bg-[#f5f5f5] flex items-center gap-1"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
              All Parts
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-5 py-4">
        {/* ── Page title + breadcrumb ── */}
        <div className="mb-4">
          <nav className="text-xs text-[#aaa] mb-1.5">
            <a href="/" className="hover:text-[#ff6b35] transition-colors">Home</a>
            <span className="mx-1.5">›</span>
            <span className="text-[#555] font-semibold">{displayName} Parts</span>
          </nav>
          <h1 className="text-[22px] sm:text-2xl font-black text-[#111] leading-tight">
            {displayName} Parts <span className="text-[#aaa] font-semibold text-[18px]">Sri Lanka</span>
          </h1>
          <p className="text-sm text-[#888] mt-1">
            {filteredProducts.length.toLocaleString()} part{filteredProducts.length !== 1 ? 's' : ''} available
            {selectedCategory !== 'All' ? ` · ${selectedCategory}` : ''}
            {conditionFilter !== 'All' ? ` · ${conditionFilter}` : ''}
          </p>
        </div>

        {/* ── Search box ── */}
        <div className="relative mb-3">
          <svg className="absolute left-3.5 top-[13px] text-[#bbb]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder={`Search ${displayName} parts, models…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-[11px] rounded-[14px] text-[15px] outline-none bg-[#f7f7f7] text-[#333] transition-all duration-200 border-2 border-transparent focus:bg-white focus:border-[#ff6b35] focus:shadow-[0_0_0_4px_rgba(255,107,53,0.08)]"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-[9px] w-[26px] h-[26px] bg-[#ddd] rounded-full flex items-center justify-center text-[13px] text-[#666] font-bold active:bg-[#ccc]"
            >✕</button>
          )}
        </div>

        {/* ── Category pills ── */}
        {availableCategories.length > 0 && (
          <div className="relative mb-3">
            <div
              className="flex gap-2 overflow-x-auto pb-1.5"
              style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}
            >
              <button
                onClick={() => setSelectedCategory('All')}
                className={`whitespace-nowrap px-4 py-[9px] rounded-full text-xs font-semibold flex-shrink-0 transition-all duration-200 ${
                  selectedCategory === 'All'
                    ? 'bg-[#ff6b35] text-white shadow-[0_4px_12px_rgba(255,107,53,0.3)]'
                    : 'bg-white text-[#777] border-[1.5px] border-[#e8e8e8] active:border-[#ff6b35] active:bg-[#fff5f0]'
                }`}
              >All</button>
              {availableCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`whitespace-nowrap px-4 py-[9px] rounded-full text-xs font-semibold flex-shrink-0 transition-all duration-200 ${
                    selectedCategory === cat
                      ? 'bg-[#ff6b35] text-white shadow-[0_4px_12px_rgba(255,107,53,0.3)]'
                      : 'bg-white text-[#777] border-[1.5px] border-[#e8e8e8] active:border-[#ff6b35] active:bg-[#fff5f0]'
                  }`}
                >{cat}</button>
              ))}
            </div>
            {/* Fade right edge */}
            <div className="absolute right-0 top-0 bottom-1.5 w-10 bg-gradient-to-l from-[#f5f5f5] to-transparent pointer-events-none" />
          </div>
        )}

        {/* ── Sort + condition row ── */}
        <div className="flex items-center gap-2 mb-3.5 flex-wrap">
          {/* Sort dropdown */}
          <div className="relative flex-shrink-0">
            <select
              value={sortBy}
              onChange={e => setSortBy(e.target.value)}
              className="text-xs font-semibold bg-white rounded-[10px] pl-3 pr-8 py-[9px] border-[1.5px] border-[#e8e8e8] text-[#555] outline-none appearance-none cursor-pointer"
            >
              <option value="newest">Newest First</option>
              <option value="price-low">Price: Low → High</option>
              <option value="price-high">Price: High → Low</option>
              <option value="name-az">Name: A → Z</option>
            </select>
            <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#999]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
          </div>

          {/* Condition chips */}
          {['All', 'New-Genuine', 'New-Other', 'Reconditioned', 'Damaged'].map(c => (
            <button
              key={c}
              onClick={() => setConditionFilter(c)}
              className={`px-3 py-[7px] rounded-lg text-[11px] font-semibold transition-all duration-150 flex-shrink-0 ${
                conditionFilter === c
                  ? 'bg-[#ff6b35] text-white shadow-[0_2px_8px_rgba(255,107,53,0.25)]'
                  : 'bg-white text-[#888] border-[1.5px] border-[#e8e8e8] active:border-[#ff6b35]'
              }`}
            >{c}</button>
          ))}

          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button onClick={clearFilters} className="ml-auto text-xs font-bold text-[#ff6b35] underline underline-offset-2 flex-shrink-0">
              Clear
            </button>
          )}
        </div>

        {/* ── Product grid ── */}
        {visibleProducts.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-[72px] h-[72px] rounded-full bg-[#f5f5f5] mx-auto mb-4 flex items-center justify-center text-[28px]">🔍</div>
            <p className="font-bold text-[17px] text-[#333]">No {displayName} parts found</p>
            <p className="text-sm text-[#aaa] mt-1.5">Try adjusting your search or filters</p>
            {activeFilterCount > 0 && (
              <button
                onClick={clearFilters}
                className="mt-5 text-sm font-bold px-6 py-2.5 rounded-xl text-white shadow-[0_4px_12px_rgba(255,107,53,0.25)]"
                style={{ background: 'linear-gradient(135deg,#ff6b35,#ff8f65)' }}
              >Clear filters</button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {visibleProducts.map((product, idx) => {
              const imageUrl = getPrimaryImage(product)
              return (
                <a
                  key={product.id}
                  href={`/product/${product.slug || product.id}`}
                  className="bg-white rounded-2xl overflow-hidden relative group transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.1)] border border-[#eee] block"
                >
                  {/* Image */}
                  <div className="aspect-[4/3] bg-[#fafafa] relative overflow-hidden">
                    {imageUrl
                      ? <img
                          src={thumbnail(imageUrl)}
                          alt={product.name}
                          loading={idx < 6 ? 'eager' : 'lazy'}
                          fetchPriority={idx < 4 ? 'high' : undefined}
                          onError={imgFallback}
                          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
                        />
                      : showsThumb(product)
                      ? <ProductThumb product={product} variant="card" className="w-full h-full" />
                      : <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#f8f8f8] to-[#f0f0f0]">
                          <span className="text-[40px] opacity-[0.08]">🔧</span>
                        </div>
                    }
                  </div>

                  {/* Info */}
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`text-[10px] font-bold px-2 py-[3px] rounded-md ${conditionBadge(product.condition || '')}`}>
                        {product.condition}
                      </span>
                      <span className="text-[10px] font-medium text-[#ccc] truncate">{product.category}</span>
                    </div>
                    <h3 className="font-bold text-[13px] text-[#222] leading-tight line-clamp-2 min-h-[36px]">
                      {product.name}
                    </h3>
                    {product.model && (
                      <p className="text-[11px] text-[#aaa] mt-1 truncate">
                        🚗 {[product.model, product.year].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    <div className="flex items-baseline justify-between mt-2 pt-2 border-t border-[#f5f5f5]">
                      <span className="font-black text-base text-[#ff6b35] tracking-tight">
                        {formatPrice(product.price, product.show_price)}
                      </span>
                      <span className={`text-[10px] font-semibold px-[7px] py-[2px] rounded-[5px] ${product.quantity <= 3 ? 'bg-[#fef2f2] text-[#ef4444]' : 'bg-[#ecfdf5] text-[#10b981]'}`}>
                        {product.quantity <= 3 ? `Only ${product.quantity}` : 'In Stock'}
                      </span>
                    </div>
                    {product.vendor && (
                      <p className="text-[11px] font-semibold text-[#888] mt-2 truncate">🏪 {product.vendor.name}</p>
                    )}
                  </div>
                </a>
              )
            })}
          </div>
        )}

        {/* Infinite scroll sentinel */}
        {hasMore && <div ref={loadMoreRef} />}
        {hasMore && (
          <div className="flex justify-center py-6">
            <div className="flex items-center gap-3 text-sm text-slate-400">
              <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
              Loading more…
            </div>
          </div>
        )}
        {!hasMore && visibleProducts.length > 0 && (
          <p className="text-center text-xs text-slate-300 py-6">
            All {filteredProducts.length.toLocaleString()} {displayName} parts shown
          </p>
        )}
      </main>

      {/* ── SEO content: intro + popular categories + FAQ (server-rendered) ── */}
      <section className="max-w-[1200px] mx-auto px-4 sm:px-6 mt-4 mb-2">
        <div className="bg-white border border-[#eee] rounded-2xl p-5 sm:p-7">
          <h2 className="text-lg sm:text-xl font-black text-[#222] mb-2">{displayName} Spare Parts in Sri Lanka</h2>
          <p className="text-sm text-[#666] leading-relaxed max-w-3xl">
            Looking for {displayName} spare parts in Sri Lanka? kuruma.lk lists {products.length.toLocaleString()} {displayName} part{products.length === 1 ? '' : 's'} and accessories from trusted dealers — new-genuine, brand-new aftermarket and quality reconditioned. Compare options, check the condition and price on each listing, and contact the seller directly by WhatsApp or phone.
          </p>

          {topCategories.length > 0 && (
            <div className="mt-5">
              <h3 className="text-sm font-bold text-[#333] mb-2">Popular {displayName} part categories</h3>
              <div className="flex flex-wrap gap-2">
                {topCategories.map(c => (
                  <button
                    key={c.name}
                    onClick={() => { setSelectedCategory(c.name); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                    className="text-xs font-semibold text-[#444] bg-[#f5f5f5] hover:bg-[#ffe9df] hover:text-[#ff6b35] border border-[#eee] rounded-full px-3 py-1.5 transition"
                  >
                    {c.name} <span className="text-[#aaa] font-normal">({c.count})</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {faqs.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-bold text-[#333] mb-3">Frequently asked questions</h3>
              <div className="space-y-3 max-w-3xl">
                {faqs.map((f, i) => (
                  <div key={i}>
                    <p className="text-sm font-semibold text-[#222]">{f.q}</p>
                    <p className="text-sm text-[#666] leading-relaxed mt-0.5">{f.a}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <footer className="bg-[#fafafa] border-t border-[#eee] py-7 text-center mt-6">
        <div className="flex items-baseline justify-center gap-0.5 mb-1">
          <a href="/" className="text-lg font-black text-[#ff6b35]">kuruma</a>
          <a href="/" className="text-lg font-black text-[#333]">.lk</a>
        </div>
        <p className="text-xs text-[#bbb]">Sri Lanka&apos;s Auto Parts Marketplace</p>
      </footer>

      <style jsx global>{`html,body{overflow-x:hidden;max-width:100vw}`}</style>
    </div>
  )
}
