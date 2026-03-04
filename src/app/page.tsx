'use client'

import { useState, useEffect, useRef } from 'react'
import type { Product, Vendor } from '@/types'

const CATEGORIES = [
  'All', 'Engine Parts', 'Transmission', 'Brakes', 'Suspension',
  'Electrical', 'Body Parts', 'Interior', 'Exhaust',
  'Cooling System', 'Fuel System', 'Steering',
  'Wheels & Tires', 'Lighting', 'AC & Heating', 'Other'
]

const CATEGORY_COLORS: Record<string, string> = {
  'Engine Parts': 'bg-red-100 text-red-700',
  'Transmission': 'bg-purple-100 text-purple-700',
  'Brakes': 'bg-orange-100 text-orange-700',
  'Suspension': 'bg-blue-100 text-blue-700',
  'Electrical': 'bg-yellow-100 text-yellow-700',
  'Body Parts': 'bg-emerald-100 text-emerald-700',
  'Interior': 'bg-pink-100 text-pink-700',
  'Exhaust': 'bg-gray-100 text-gray-700',
  'Cooling System': 'bg-cyan-100 text-cyan-700',
  'Fuel System': 'bg-amber-100 text-amber-700',
  'Steering': 'bg-indigo-100 text-indigo-700',
  'Wheels & Tires': 'bg-stone-100 text-stone-700',
  'Lighting': 'bg-lime-100 text-lime-700',
  'AC & Heating': 'bg-sky-100 text-sky-700',
  'Other': 'bg-slate-100 text-slate-700',
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

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'products' | 'shops'>('products')
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [products, setProducts] = useState<(Product & { vendor: Vendor; images: any[] })[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set())
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Feature 4: Filtering & sorting
  const [sortBy, setSortBy] = useState<string>('newest')
  const [conditionFilter, setConditionFilter] = useState<string>('All')
  const [makeFilter, setMakeFilter] = useState<string>('All')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 0])
  const [priceFilter, setPriceFilter] = useState<[number, number]>([0, 999999999])
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/store')
        if (res.ok) {
          const json = await res.json()
          setProducts(json.products)
          setVendors(json.vendors)
        }
      } catch (err) {
        console.error('Failed to fetch:', err)
      }
      setLoading(false)
    }
    fetchData()
  }, [])

  // Feature 4: Computed filter values
  const uniqueMakes = ['All', ...Array.from(new Set(products.map(p => p.make).filter(Boolean))).sort()] as string[]
  const uniqueConditions = ['All', 'Excellent', 'Good', 'Fair', 'Salvage']

  useEffect(() => {
    if (products.length > 0) {
      const prices = products.filter(p => p.price && p.show_price).map(p => p.price!)
      if (prices.length > 0) {
        const min = Math.min(...prices)
        const max = Math.max(...prices)
        setPriceRange([min, max])
        setPriceFilter([min, max])
      }
    }
  }, [products])

  const activeFilterCount = [
    conditionFilter !== 'All',
    makeFilter !== 'All',
    priceRange[1] > 0 && (priceFilter[0] !== priceRange[0] || priceFilter[1] !== priceRange[1]),
  ].filter(Boolean).length

  const filteredProducts = products
    .filter((p) => {
      const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory
      const matchesVendor = !selectedVendor || p.vendor_id === selectedVendor
      const searchLower = search.toLowerCase()
      const matchesSearch = !search ||
        p.name.toLowerCase().includes(searchLower) ||
        (p.sku || '').toLowerCase().includes(searchLower) ||
        (p.make || '').toLowerCase().includes(searchLower) ||
        (p.model || '').toLowerCase().includes(searchLower) ||
        (p.vendor?.name || '').toLowerCase().includes(searchLower)
      const matchesCondition = conditionFilter === 'All' || p.condition === conditionFilter
      const matchesMake = makeFilter === 'All' || p.make === makeFilter
      const price = p.price || 0
      const matchesPrice = !p.show_price || !p.price || (price >= priceFilter[0] && price <= priceFilter[1])
      return matchesCategory && matchesSearch && matchesVendor && matchesCondition && matchesMake && matchesPrice
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'price-low': return (a.price || 0) - (b.price || 0)
        case 'price-high': return (b.price || 0) - (a.price || 0)
        case 'name-az': return a.name.localeCompare(b.name)
        case 'name-za': return b.name.localeCompare(a.name)
        case 'newest':
        default: return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      }
    })

  const selectedVendorObj = selectedVendor ? vendors.find(v => v.id === selectedVendor) : null
  const isVendorView = !!(selectedVendor && selectedVendorObj)

  function selectVendor(vendorId: string) {
    setSelectedVendor(vendorId)
    setActiveTab('products')
    setSelectedCategory('All')
    setSearch('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function clearVendor() {
    setSelectedVendor(null)
    setActiveTab('products')
  }

  function toggleSelect(productId: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) { next.delete(productId) } else { next.add(productId) }
      return next
    })
  }

  function getSelectedByVendor() {
    const groups: Record<string, { vendor: Vendor; items: Product[] }> = {}
    products.forEach((p) => {
      if (selectedItems.has(p.id) && p.vendor) {
        if (!groups[p.vendor_id]) { groups[p.vendor_id] = { vendor: p.vendor, items: [] } }
        groups[p.vendor_id].items.push(p)
      }
    })
    return groups
  }

  function buildWhatsAppUrl(vendor: Vendor, items: Product[]) {
    const lines = items.map((p) => `- ${p.sku} - ${p.name}`).join('%0A')
    const msg = `Hi ${vendor.name},%0AI'm interested in these parts:%0A${lines}%0A%0APlease let me know availability and pricing.`
    return `https://wa.me/${vendor.whatsapp}?text=${msg}`
  }

  return (
    <div className="min-h-screen bg-slate-50">

      {/* ─── HEADER ─── */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-4">

          {isVendorView ? (
            /* ── Vendor-filtered header: back + vendor info ── */
            <div className="flex items-center gap-2.5 py-2.5">
              <button onClick={clearVendor} className="flex items-center gap-1 text-sm font-semibold text-slate-500 active:text-slate-700 py-1 -ml-1 flex-shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                <span className="hidden sm:inline">All Shops</span>
              </button>
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-400 to-purple-500 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                  {selectedVendorObj!.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-sm text-slate-900 truncate">{selectedVendorObj!.name}</h2>
                  <p className="text-[11px] text-slate-400 truncate">{selectedVendorObj!.location} · {filteredProducts.length} parts</p>
                </div>
              </div>
              <div className="flex gap-1.5 flex-shrink-0">
                <a href={`tel:${selectedVendorObj!.phone}`} className="w-10 h-10 rounded-full border border-slate-200 flex items-center justify-center text-base active:bg-slate-50">📞</a>
                <a href={`https://wa.me/${selectedVendorObj!.whatsapp}`} target="_blank" className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center text-base active:bg-green-600">💬</a>
              </div>
            </div>
          ) : (
            /* ── Normal header ── */
            <>
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-black text-orange-500">kuruma.lk</h1>
                  <span className="text-[10px] text-slate-400 hidden sm:inline">Auto Parts Marketplace</span>
                </div>
                {/* Mobile: compact icons. Desktop: full buttons */}
                <div className="flex items-center gap-1.5 sm:gap-2">
                  <a href="/login" className="sm:hidden w-9 h-9 rounded-full border border-slate-200 flex items-center justify-center text-sm active:bg-slate-50">🏪</a>
                  <a href="/register" className="sm:hidden w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-sm active:bg-orange-600">🚀</a>
                  <a href="/login" className="hidden sm:flex text-sm font-semibold text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg border border-slate-200 items-center gap-1.5">🏪 Vendor Portal</a>
                  <a href="/register" className="hidden sm:flex text-sm font-bold bg-orange-500 text-white px-4 py-1.5 rounded-lg items-center gap-1.5 hover:bg-orange-600">🚀 Start Selling</a>
                </div>
              </div>

              {/* Search with clear button */}
              <div className="relative pb-2">
                <input
                  ref={searchRef} type="text"
                  placeholder="Search parts, vehicles, shops..."
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border-2 border-slate-200 text-sm outline-none focus:border-orange-400 transition bg-slate-50 focus:bg-white"
                />
                {search && (
                  <button onClick={() => { setSearch(''); searchRef.current?.focus() }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400 active:text-slate-600 rounded-full">
                    ✕
                  </button>
                )}
              </div>

              {/* Two clean tabs only — no dynamic 3rd tab */}
              <div className="flex border-t border-slate-100">
                <button onClick={() => { setActiveTab('products'); setSelectedVendor(null) }}
                  className={`flex-1 py-2.5 text-center text-sm font-bold border-b-2 transition ${activeTab === 'products' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-400 active:text-slate-600'}`}>
                  Products
                </button>
                <button onClick={() => { setActiveTab('shops'); setSelectedVendor(null) }}
                  className={`flex-1 py-2.5 text-center text-sm font-bold border-b-2 transition ${activeTab === 'shops' ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-400 active:text-slate-600'}`}>
                  Shops ({vendors.length})
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4">

        {/* ─── PRODUCTS VIEW (also used for vendor-filtered) ─── */}
        {(activeTab === 'products' || isVendorView) && (
          <div>
            {/* Vendor description */}
            {isVendorView && selectedVendorObj!.description && (
              <p className="text-xs text-slate-500 bg-white rounded-lg border border-slate-100 px-3 py-2.5 mb-3 line-clamp-2">{selectedVendorObj!.description}</p>
            )}

            {/* In-vendor search */}
            {isVendorView && (
              <div className="relative mb-3">
                <input type="text" placeholder={`Search in ${selectedVendorObj!.name}...`} value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-4 pr-10 py-2.5 rounded-xl border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white" />
                {search && <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center text-slate-400">✕</button>}
              </div>
            )}

            {/* Category pills with fade scroll hint */}
            <div className="relative mb-3">
              <div className="flex gap-2 overflow-x-auto pb-2" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {CATEGORIES.map((cat) => (
                  <button key={cat} onClick={() => setSelectedCategory(cat)}
                    className={`whitespace-nowrap px-3.5 py-2 rounded-full text-xs font-bold transition flex-shrink-0 ${selectedCategory === cat ? 'bg-orange-500 text-white shadow-sm' : 'bg-white text-slate-500 border border-slate-200 active:border-orange-300 active:bg-orange-50'}`}>
                    {cat}
                  </button>
                ))}
              </div>
              <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-slate-50 to-transparent pointer-events-none" />
            </div>

            {/* Feature 4: Sort & Filter Bar */}
            <div className="flex items-center gap-2 mb-3">
              <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                className="text-xs font-semibold bg-white border border-slate-200 rounded-lg px-2.5 py-2 outline-none focus:border-orange-400 text-slate-600 appearance-none pr-7"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%2394a3b8' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}>
                <option value="newest">Newest First</option>
                <option value="price-low">Price: Low → High</option>
                <option value="price-high">Price: High → Low</option>
                <option value="name-az">Name: A → Z</option>
                <option value="name-za">Name: Z → A</option>
              </select>
              <button onClick={() => setShowFilters(!showFilters)}
                className={`text-xs font-bold px-3 py-2 rounded-lg border transition flex items-center gap-1.5 ${
                  showFilters || activeFilterCount > 0 ? 'bg-orange-50 border-orange-300 text-orange-600' : 'bg-white border-slate-200 text-slate-500 active:border-orange-300'
                }`}>
                🔍 Filters
                {activeFilterCount > 0 && <span className="bg-orange-500 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center">{activeFilterCount}</span>}
              </button>
              {activeFilterCount > 0 && (
                <button onClick={() => { setConditionFilter('All'); setMakeFilter('All'); setPriceFilter([priceRange[0], priceRange[1]]) }}
                  className="text-[11px] text-orange-500 font-semibold active:text-orange-700">Clear filters</button>
              )}
            </div>

            {/* Expandable Filter Panel */}
            {showFilters && (
              <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3 space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Condition</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {uniqueConditions.map(cond => (
                      <button key={cond} onClick={() => setConditionFilter(cond)}
                        className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
                          conditionFilter === cond ? 'bg-orange-500 text-white' : 'bg-slate-50 text-slate-500 border border-slate-200 active:bg-orange-50'
                        }`}>{cond}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">Vehicle Make</label>
                  <select value={makeFilter} onChange={e => setMakeFilter(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
                    {uniqueMakes.map(make => <option key={make} value={make}>{make}</option>)}
                  </select>
                </div>
                {priceRange[1] > 0 && (
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 block">
                      Price Range: Rs.{priceFilter[0].toLocaleString()} – Rs.{priceFilter[1].toLocaleString()}
                    </label>
                    <div className="flex items-center gap-3">
                      <input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[0]}
                        onChange={e => { const val = parseInt(e.target.value); setPriceFilter([Math.min(val, priceFilter[1] - 100), priceFilter[1]]) }}
                        className="flex-1 accent-orange-500 h-2" />
                      <input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[1]}
                        onChange={e => { const val = parseInt(e.target.value); setPriceFilter([priceFilter[0], Math.max(val, priceFilter[0] + 100)]) }}
                        className="flex-1 accent-orange-500 h-2" />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>Rs.{priceRange[0].toLocaleString()}</span>
                      <span>Rs.{priceRange[1].toLocaleString()}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Results count + clear filters */}
            {!loading && (
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-slate-400 font-semibold">{filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''}{selectedCategory !== 'All' ? ` in ${selectedCategory}` : ''}</p>
                {(search || selectedCategory !== 'All' || activeFilterCount > 0) && (
                  <button onClick={() => { setSearch(''); setSelectedCategory('All'); setConditionFilter('All'); setMakeFilter('All'); setPriceFilter([priceRange[0], priceRange[1]]); setSortBy('newest') }} className="text-xs text-orange-500 font-semibold active:text-orange-700">Clear all</button>
                )}
              </div>
            )}

            {/* Product grid */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-slate-200 overflow-hidden animate-pulse">
                    <div className="aspect-square bg-slate-100" />
                    <div className="p-2.5 space-y-2"><div className="h-3 bg-slate-100 rounded w-1/2" /><div className="h-3.5 bg-slate-100 rounded" /><div className="h-3 bg-slate-100 rounded w-2/3" /></div>
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-5xl mb-3 opacity-80">🔍</p>
                <p className="text-slate-500 font-bold text-base">No parts found</p>
                <p className="text-slate-400 text-sm mt-1">Try a different search or category</p>
                {isVendorView && <button onClick={clearVendor} className="mt-4 text-sm font-bold text-orange-500 active:text-orange-700 underline">Browse all shops</button>}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4">
                {filteredProducts.map((product) => {
                  const imageUrl = getProductImage(product)
                  const imageCount = product.images?.length || 0
                  const isSelected = selectedItems.has(product.id)

                  return (
                    <div key={product.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden active:shadow-md transition group relative">

                      {/* Select: 44px min touch target */}
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(product.id) }}
                        className={`absolute top-1.5 right-1.5 z-10 w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition ${
                          isSelected ? 'bg-orange-500 border-orange-500 text-white scale-110' : 'bg-white/90 border-slate-300/70 text-transparent backdrop-blur-sm'
                        }`}>✓</button>

                      <a href={`/product/${product.id}`} className="block">
                        {/* Square on mobile, 4:3 on desktop */}
                        <div className="aspect-square sm:aspect-[4/3] bg-gradient-to-br from-slate-50 to-slate-100 relative overflow-hidden">
                          {imageUrl ? (
                            <img src={imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center"><span className="text-3xl opacity-20">🔧</span></div>
                          )}
                          {imageCount > 1 && (
                            <span className="absolute bottom-1.5 left-1.5 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded">{imageCount} photos</span>
                          )}
                        </div>

                        <div className="p-2.5 sm:p-3">
                          {/* Price first — most important */}
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-black text-orange-600 text-sm sm:text-base">{formatPrice(product.price, product.show_price)}</span>
                            <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              product.condition === 'Excellent' ? 'bg-emerald-100 text-emerald-700' :
                              product.condition === 'Good' ? 'bg-blue-100 text-blue-700' :
                              product.condition === 'Fair' ? 'bg-amber-100 text-amber-700' :
                              'bg-red-100 text-red-700'
                            }`}>{product.condition}</span>
                          </div>

                          <h3 className="font-bold text-xs sm:text-sm text-slate-900 leading-tight line-clamp-2">{product.name}</h3>

                          {(product.make || product.model) && (
                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">{[product.make, product.model, product.year].filter(Boolean).join(' · ')}</p>
                          )}

                          {/* Shop name — tappable to filter by vendor */}
                          {!isVendorView && product.vendor && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectVendor(product.vendor_id) }}
                              className="text-[11px] text-orange-500 font-semibold mt-1 truncate block w-full text-left active:text-orange-700">
                              {product.vendor.name} →
                            </button>
                          )}

                          <div className="flex items-center gap-2 mt-1">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${CATEGORY_COLORS[product.category] || 'bg-slate-100 text-slate-600'}`}>{product.category}</span>
                            <span className="text-[10px] text-slate-300">{product.quantity} in stock</span>
                          </div>
                        </div>
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── SHOPS TAB ─── */}
        {activeTab === 'shops' && !isVendorView && (() => {
          const filteredVendors = vendors.filter(v => {
            if (!search) return true
            const s = search.toLowerCase()
            return v.name.toLowerCase().includes(s) || (v.location || '').toLowerCase().includes(s)
          })
          return filteredVendors.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-5xl mb-3 opacity-80">🏪</p>
              <p className="text-slate-500 font-bold">No shops found</p>
            </div>
          ) : (
            <div className="space-y-2.5 sm:space-y-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-4">
              {filteredVendors.map((vendor) => {
                const vendorProducts = products.filter((p) => p.vendor_id === vendor.id)
                const vendorCategories = [...new Set(vendorProducts.map(p => p.category))].slice(0, 4)
                return (
                  <div key={vendor.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    {/* Main tappable area */}
                    <button onClick={() => selectVendor(vendor.id)} className="w-full p-4 pb-3 text-left active:bg-orange-50 transition">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-orange-400 to-purple-500 flex items-center justify-center text-white font-black text-base flex-shrink-0">
                          {vendor.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-sm text-slate-900">{vendor.name}</h3>
                          <p className="text-xs text-slate-400 truncate">{vendor.location}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-black text-orange-500">{vendorProducts.length}</p>
                          <p className="text-[10px] text-slate-400">parts</p>
                        </div>
                      </div>
                      {vendor.description && <p className="text-xs text-slate-400 mt-2 ml-14 line-clamp-1">{vendor.description}</p>}
                      {vendorCategories.length > 0 && (
                        <div className="flex gap-1 flex-wrap mt-2 ml-14">
                          {vendorCategories.map(cat => (
                            <span key={cat} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[cat] || 'bg-slate-100 text-slate-600'}`}>{cat}</span>
                          ))}
                        </div>
                      )}
                    </button>
                    {/* Contact bar — separate from main tap */}
                    <div className="flex border-t border-slate-100">
                      <a href={`tel:${vendor.phone}`} className="flex-1 text-center text-xs font-semibold text-slate-500 py-2.5 active:bg-slate-50 border-r border-slate-100">📞 Call</a>
                      <a href={`https://wa.me/${vendor.whatsapp}`} target="_blank" className="flex-1 text-center text-xs font-semibold text-green-600 py-2.5 active:bg-green-50 border-r border-slate-100">💬 WhatsApp</a>
                      <button onClick={() => selectVendor(vendor.id)} className="flex-1 text-center text-xs font-bold text-orange-500 py-2.5 active:bg-orange-50">View parts →</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </main>

      {/* ─── SELECTED ITEMS BAR ─── */}
      {selectedItems.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-orange-500 shadow-2xl z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center justify-between sm:justify-start gap-2">
                <div>
                  <span className="font-bold text-slate-900 text-sm">{selectedItems.size} item{selectedItems.size > 1 ? 's' : ''}</span>
                  <span className="text-slate-400 text-xs ml-1.5">· {Object.keys(getSelectedByVendor()).length} shop{Object.keys(getSelectedByVendor()).length > 1 ? 's' : ''}</span>
                </div>
                <button onClick={() => setSelectedItems(new Set())} className="text-xs text-slate-400 font-semibold px-2 py-1 active:text-slate-600 rounded">Clear</button>
              </div>
              <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {Object.entries(getSelectedByVendor()).map(([vendorId, group]) => (
                  <a key={vendorId} href={buildWhatsAppUrl(group.vendor, group.items)} target="_blank"
                    className="flex-shrink-0 inline-flex items-center gap-1.5 bg-green-500 active:bg-green-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">
                    💬 {group.vendor.name} ({group.items.length})
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className={`bg-slate-900 text-slate-400 text-xs py-6 text-center ${selectedItems.size > 0 ? 'pb-28' : ''}`}>
        <p className="font-bold text-white text-sm mb-0.5">kuruma.lk</p>
        <p>Sri Lanka&apos;s Auto Parts Marketplace</p>
      </footer>

      <style jsx global>{`
        div::-webkit-scrollbar { display: none; }
        .aspect-square { aspect-ratio: 1/1; }
      `}</style>
    </div>
  )
}
