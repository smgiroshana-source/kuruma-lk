'use client'

import { useState, useEffect, useRef } from 'react'
import type { Product, Vendor } from '@/types'

const CATEGORIES = [
  'All', 'Engine Parts', 'Transmission', 'Brakes', 'Suspension',
  'Electrical', 'Body Parts', 'Interior', 'Exhaust',
  'Cooling System', 'Fuel System', 'Steering',
  'Wheels & Tires', 'Lighting', 'AC & Heating', 'Other'
]

function formatPrice(price: number | null, showPrice: boolean) {
  if (!showPrice || price === null) return 'Ask Price'
  return 'Rs. ' + price.toLocaleString()
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
    return `https://wa.me/${(vendor.whatsapp || '').replace(/[^0-9]/g, '')}?text=${msg}`
  }

  function clearAllFilters() {
    setSearch(''); setSelectedCategory('All'); setConditionFilter('All'); setMakeFilter('All'); setPriceFilter([priceRange[0], priceRange[1]]); setSortBy('newest')
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5]">

      {/* ═══ HEADER ═══ */}
      <header className="bg-white sticky top-0 z-50 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-b border-[#f0f0f0]">
        <div className="max-w-7xl mx-auto px-3 sm:px-5">

          {isVendorView ? (
            <div className="flex items-center gap-3 py-2.5">
              <button onClick={clearVendor} className="flex items-center gap-1 text-sm font-semibold text-[#666] active:text-[#333] py-1 -ml-1 flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
                Back
              </button>
              <div className="w-px h-6 bg-[#eee]" />
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow-[0_2px_8px_rgba(255,107,53,0.3)]" style={{ background: 'linear-gradient(135deg, #ff6b35, #ff8f65)' }}>
                  {selectedVendorObj!.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-[15px] text-[#111] truncate">{selectedVendorObj!.name}</h2>
                  <p className="text-xs text-[#999] truncate">{selectedVendorObj!.location} · {filteredProducts.length} parts</p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <a href={`tel:${selectedVendorObj!.phone}`} className="w-9 h-9 rounded-[10px] bg-[#f7f7f7] border border-[#eee] flex items-center justify-center text-sm active:bg-[#eee]">📞</a>
                <a href={`https://wa.me/${(selectedVendorObj!.whatsapp || '').replace(/[^0-9]/g, '')}`} target="_blank" className="w-9 h-9 rounded-[10px] bg-[#25d366] flex items-center justify-center text-sm active:bg-[#1fb855]">💬</a>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-0.5">
                  <span className="text-2xl font-black tracking-tight text-[#ff6b35]">kuruma</span>
                  <span className="text-2xl font-black tracking-tight text-[#222]">.lk</span>
                </div>
                <div className="flex gap-2 items-center">
                  <a href="/login" className="sm:hidden text-xs font-semibold px-3 py-2 rounded-[10px] bg-white text-[#555] border-[1.5px] border-[#e5e5e5] active:bg-[#f5f5f5]">Login</a>
                  <a href="/login" className="hidden sm:flex text-xs font-semibold px-3.5 py-2 rounded-[10px] bg-white text-[#555] border-[1.5px] border-[#e5e5e5] items-center active:bg-[#f5f5f5]">Vendor Login</a>
                  <a href="/register" className="text-xs font-bold px-4 py-2 rounded-[10px] text-white flex items-center gap-1 shadow-[0_2px_8px_rgba(255,107,53,0.3)]" style={{ background: 'linear-gradient(135deg, #ff6b35, #ff8f65)' }}>
                    <span className="hidden sm:inline">Start Selling</span>
                    <span className="sm:hidden">Sell</span>
                  </a>
                </div>
              </div>

              <div className="relative pb-2.5">
                <svg className="absolute left-3.5 top-[13px] text-[#bbb]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                <input
                  ref={searchRef} type="text"
                  placeholder="Search parts, vehicles, shops..."
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-11 pr-10 py-[11px] rounded-[14px] text-sm outline-none bg-[#f7f7f7] text-[#333] transition-all duration-200 border-2 border-transparent focus:bg-white focus:border-[#ff6b35] focus:shadow-[0_0_0_4px_rgba(255,107,53,0.08)]"
                />
                {search && (
                  <button onClick={() => { setSearch(''); searchRef.current?.focus() }}
                    className="absolute right-3 top-[11px] w-[22px] h-[22px] bg-[#eee] rounded-full flex items-center justify-center text-[11px] text-[#888] active:bg-[#ddd]">✕</button>
                )}
              </div>

              <div className="flex">
                {[
                  { key: 'products' as const, label: 'Products' },
                  { key: 'shops' as const, label: `Shops (${vendors.length})` },
                ].map(t => (
                  <button key={t.key}
                    onClick={() => { setActiveTab(t.key); setSelectedVendor(null) }}
                    className={`flex-1 py-3 text-center text-[13px] font-bold transition-colors border-b-[2.5px] ${activeTab === t.key ? 'border-[#ff6b35] text-[#ff6b35]' : 'border-transparent text-[#aaa] active:text-[#666]'
                      }`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-5 py-4">

        {(activeTab === 'products' || isVendorView) && (
          <div>
            {isVendorView && selectedVendorObj!.description && (
              <p className="text-[13px] bg-white rounded-[14px] px-4 py-3 mb-3.5 text-[#777] border border-[#eee] leading-relaxed">{selectedVendorObj!.description}</p>
            )}

            {isVendorView && (
              <div className="relative mb-3">
                <svg className="absolute left-3 top-[11px] text-[#bbb]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                <input type="text" placeholder={`Search in ${selectedVendorObj!.name}...`} value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-10 py-2.5 rounded-[14px] text-sm outline-none bg-white border-[1.5px] border-[#e8e8e8] focus:border-[#ff6b35]" />
                {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#aaa]">✕</button>}
              </div>
            )}

            {/* Category pills */}
            <div className="relative mb-3">
              <div className="flex gap-2 overflow-x-auto pb-1.5" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {CATEGORIES.map((cat) => (
                  <button key={cat} onClick={() => setSelectedCategory(cat)}
                    className={`whitespace-nowrap px-4 py-[9px] rounded-full text-xs font-semibold transition-all duration-200 flex-shrink-0 ${selectedCategory === cat
                      ? 'bg-[#ff6b35] text-white shadow-[0_4px_12px_rgba(255,107,53,0.3)]'
                      : 'bg-white text-[#777] border-[1.5px] border-[#e8e8e8] active:border-[#ff6b35] active:bg-[#fff5f0]'
                      }`}>
                    {cat}
                  </button>
                ))}
              </div>
              <div className="absolute right-0 top-0 bottom-1.5 w-12 bg-gradient-to-l from-[#f5f5f5] to-transparent pointer-events-none" />
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 mb-3.5 flex-wrap">
              <div className="relative">
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  className="text-xs font-semibold bg-white rounded-[10px] pl-3 pr-8 py-[9px] border-[1.5px] border-[#e8e8e8] text-[#555] outline-none appearance-none cursor-pointer">
                  <option value="newest">Newest First</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="name-az">Name: A → Z</option>
                  <option value="name-za">Name: Z → A</option>
                </select>
                <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#999]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
              </div>

              <button onClick={() => setShowFilters(!showFilters)}
                className={`text-xs font-semibold px-3.5 py-[9px] rounded-[10px] flex items-center gap-1.5 transition-all duration-200 ${showFilters || activeFilterCount > 0
                  ? 'bg-[#fff5f0] border-[1.5px] border-[#ff6b35] text-[#ff6b35]'
                  : 'bg-white border-[1.5px] border-[#e8e8e8] text-[#777] active:border-[#ff6b35]'
                  }`}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="12" y1="18" x2="20" y2="18" /></svg>
                Filters
                {activeFilterCount > 0 && <span className="bg-[#ff6b35] text-white text-[9px] font-black w-[18px] h-[18px] rounded-full flex items-center justify-center">{activeFilterCount}</span>}
              </button>

              {activeFilterCount > 0 && (
                <button onClick={() => { setConditionFilter('All'); setMakeFilter('All'); setPriceFilter([priceRange[0], priceRange[1]]) }}
                  className="text-xs font-semibold text-[#ff6b35] underline underline-offset-2">Clear all</button>
              )}
              <div className="flex-1" />
              {!loading && <span className="text-xs text-[#bbb] font-medium">{filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''}</span>}
            </div>

            {/* Filter Panel */}
            {showFilters && (
              <div className="bg-white rounded-2xl p-4 sm:p-5 mb-4 border border-[#eee] shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
                <div className="flex flex-col sm:flex-row gap-5">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#bbb] mb-2.5 block">Condition</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {uniqueConditions.map(cond => (
                        <button key={cond} onClick={() => setConditionFilter(cond)}
                          className={`px-3.5 py-[7px] rounded-lg text-xs font-semibold transition-all duration-150 ${conditionFilter === cond
                            ? 'bg-[#ff6b35] text-white shadow-[0_2px_8px_rgba(255,107,53,0.25)]'
                            : 'bg-[#f5f5f5] text-[#888] active:bg-[#eee]'
                            }`}>{cond}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#bbb] mb-2.5 block">Vehicle Make</label>
                    <div className="relative">
                      <select value={makeFilter} onChange={e => setMakeFilter(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-[10px] text-sm font-semibold border-[1.5px] border-[#eee] text-[#555] outline-none bg-[#fafafa] appearance-none cursor-pointer">
                        {uniqueMakes.map(make => <option key={make} value={make}>{make}</option>)}
                      </select>
                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#999]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
                    </div>
                  </div>
                </div>
                {priceRange[1] > 0 && (
                  <div className="mt-4 pt-4 border-t border-[#f0f0f0]">
                    <label className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#bbb] mb-2.5 block">
                      Price: <span className="text-[#ff6b35]">Rs.{priceFilter[0].toLocaleString()}</span> – <span className="text-[#ff6b35]">Rs.{priceFilter[1].toLocaleString()}</span>
                    </label>
                    <div className="flex items-center gap-3">
                      <input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[0]}
                        onChange={e => { const val = parseInt(e.target.value); setPriceFilter([Math.min(val, priceFilter[1] - 100), priceFilter[1]]) }}
                        className="flex-1 h-1.5 accent-[#ff6b35]" />
                      <input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[1]}
                        onChange={e => { const val = parseInt(e.target.value); setPriceFilter([priceFilter[0], Math.max(val, priceFilter[0] + 100)]) }}
                        className="flex-1 h-1.5 accent-[#ff6b35]" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Product Grid */}
            {loading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[...Array(8)].map((_, i) => (
                  <div key={i} className="bg-white rounded-2xl overflow-hidden border border-[#eee]">
                    <div className="aspect-[4/3] bg-gradient-to-br from-[#f5f5f5] to-[#eee] animate-pulse" />
                    <div className="p-3 space-y-2.5">
                      <div className="flex gap-1.5"><div className="h-5 w-16 bg-[#f0f0f0] rounded-md animate-pulse" /><div className="h-5 w-12 bg-[#f0f0f0] rounded-md animate-pulse" /></div>
                      <div className="h-4 bg-[#f0f0f0] rounded animate-pulse" />
                      <div className="h-3.5 bg-[#f0f0f0] rounded animate-pulse w-2/3" />
                      <div className="h-5 bg-[#f0f0f0] rounded animate-pulse w-1/2 mt-1" />
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="text-center py-20">
                <div className="w-[72px] h-[72px] rounded-full bg-[#f5f5f5] mx-auto mb-4 flex items-center justify-center text-[28px]">🔍</div>
                <p className="font-bold text-[17px] text-[#333]">No parts found</p>
                <p className="text-sm text-[#aaa] mt-1.5">Try adjusting your search or filters</p>
                {(search || selectedCategory !== 'All' || activeFilterCount > 0) && (
                  <button onClick={clearAllFilters} className="mt-5 text-sm font-bold px-6 py-2.5 rounded-xl text-white shadow-[0_4px_12px_rgba(255,107,53,0.25)]" style={{ background: 'linear-gradient(135deg, #ff6b35, #ff8f65)' }}>Clear all filters</button>
                )}
                {isVendorView && <button onClick={clearVendor} className="mt-3 block mx-auto text-sm font-bold text-[#ff6b35] underline">Browse all shops</button>}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {filteredProducts.map((product) => {
                  const imageUrl = getProductImage(product)
                  const imageCount = product.images?.length || 0
                  const isSelected = selectedItems.has(product.id)

                  return (
                    <div key={product.id}
                      className="bg-white rounded-2xl overflow-hidden relative group transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.1)]"
                      style={{ border: isSelected ? '2px solid #ff6b35' : '1px solid #eee' }}>

                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(product.id) }}
                        className={`absolute top-2.5 right-2.5 z-10 w-[30px] h-[30px] rounded-lg flex items-center justify-center text-xs font-bold transition-all duration-200 ${isSelected
                          ? 'bg-[#ff6b35] text-white shadow-[0_2px_12px_rgba(255,107,53,0.4)] scale-105'
                          : 'bg-white/95 backdrop-blur-sm text-transparent group-hover:text-[#ccc] border-[1.5px] border-black/10 shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
                          }`}>✓</button>

                      <a href={`/product/${product.id}`} className="block">
                        <div className="aspect-square sm:aspect-[4/3] bg-[#fafafa] relative overflow-hidden">
                          {imageUrl ? (
                            <img src={imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#f8f8f8] to-[#f0f0f0]"><span className="text-[40px] opacity-[0.08]">🔧</span></div>
                          )}
                          {imageCount > 1 && (
                            <span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] font-bold px-2 py-0.5 rounded-md">📷 {imageCount}</span>
                          )}
                        </div>

                        <div className="p-3">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className={`text-[10px] font-bold px-2 py-[3px] rounded-md ${product.condition === 'Excellent' ? 'bg-[#ecfdf5] text-[#059669]' :
                              product.condition === 'Good' ? 'bg-[#eff6ff] text-[#2563eb]' :
                                product.condition === 'Fair' ? 'bg-[#fffbeb] text-[#d97706]' :
                                  'bg-[#fef2f2] text-[#dc2626]'
                              }`}>{product.condition}</span>
                            <span className="text-[10px] font-medium text-[#ccc]">{product.category}</span>
                          </div>

                          <h3 className="font-bold text-[13px] text-[#222] leading-tight line-clamp-2 min-h-[36px]">{product.name}</h3>

                          {(product.make || product.model) && (
                            <p className="text-[11px] text-[#aaa] mt-1 truncate">🚗 {[product.make, product.model, product.year].filter(Boolean).join(' · ')}</p>
                          )}

                          <div className="flex items-baseline justify-between mt-2 pt-2 border-t border-[#f5f5f5]">
                            <span className="font-black text-base text-[#ff6b35] tracking-tight">{formatPrice(product.price, product.show_price)}</span>
                            <span className={`text-[10px] font-semibold px-[7px] py-[2px] rounded-[5px] ${product.quantity <= 3 ? 'bg-[#fef2f2] text-[#ef4444]' : 'bg-[#ecfdf5] text-[#10b981]'
                              }`}>{product.quantity <= 3 ? `Only ${product.quantity}` : 'In Stock'}</span>
                          </div>

                          {!isVendorView && product.vendor && (
                            <button
                              onClick={(e) => { e.preventDefault(); e.stopPropagation(); selectVendor(product.vendor_id) }}
                              className="text-[11px] font-semibold text-[#888] hover:text-[#ff6b35] mt-2 flex items-center gap-1 transition-colors">
                              🏪 {product.vendor.name}
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7" /></svg>
                            </button>
                          )}
                        </div>
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ SHOPS TAB ═══ */}
        {activeTab === 'shops' && !isVendorView && (() => {
          const filteredVendors = vendors.filter(v => {
            if (!search) return true
            const s = search.toLowerCase()
            return v.name.toLowerCase().includes(s) || (v.location || '').toLowerCase().includes(s)
          })
          return filteredVendors.length === 0 ? (
            <div className="text-center py-20">
              <div className="w-[72px] h-[72px] rounded-full bg-[#f5f5f5] mx-auto mb-4 flex items-center justify-center text-[28px]">🏪</div>
              <p className="font-bold text-[17px] text-[#333]">No shops found</p>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-3">
              {filteredVendors.map((vendor) => {
                const vendorProducts = products.filter((p) => p.vendor_id === vendor.id)
                const vendorCategories = [...new Set(vendorProducts.map(p => p.category))].slice(0, 4)
                return (
                  <div key={vendor.id} className="bg-white rounded-2xl overflow-hidden border border-[#eee] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
                    <button onClick={() => selectVendor(vendor.id)} className="w-full p-[18px] pb-3.5 text-left active:bg-[#fafafa] transition">
                      <div className="flex items-center gap-3.5">
                        <div className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center text-white font-black text-[22px] flex-shrink-0 shadow-[0_4px_12px_rgba(255,107,53,0.25)]" style={{ background: 'linear-gradient(135deg, #ff6b35, #ff8f65)' }}>
                          {vendor.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-[16px] text-[#222]">{vendor.name}</h3>
                          <p className="text-[13px] text-[#999] mt-0.5">📍 {vendor.location}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[22px] font-black text-[#ff6b35]">{vendorProducts.length}</p>
                          <p className="text-[10px] font-semibold text-[#ccc] uppercase tracking-wide">parts</p>
                        </div>
                      </div>
                      {vendor.description && <p className="text-xs text-[#aaa] mt-3 leading-relaxed">{vendor.description}</p>}
                      {vendorCategories.length > 0 && (
                        <div className="flex gap-1.5 flex-wrap mt-2.5">
                          {vendorCategories.map(cat => (
                            <span key={cat} className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#f7f7f7] text-[#888]">{cat}</span>
                          ))}
                        </div>
                      )}
                    </button>
                    <div className="flex border-t border-[#f0f0f0]">
                      <a href={`tel:${vendor.phone}`} className="flex-1 text-center text-xs font-semibold text-[#888] py-3.5 active:bg-[#fafafa] hover:bg-[#fafafa] transition border-r border-[#f0f0f0]">📞 Call</a>
                      <a href={`https://wa.me/${(vendor.whatsapp || '').replace(/[^0-9]/g, '')}`} target="_blank" className="flex-1 text-center text-xs font-bold text-[#25d366] py-3.5 active:bg-[#f0fdf4] hover:bg-[#f0fdf4] transition border-r border-[#f0f0f0]">💬 WhatsApp</a>
                      <button onClick={() => selectVendor(vendor.id)} className="flex-1 text-center text-xs font-bold text-[#ff6b35] py-3.5 active:bg-[#fff5f0] hover:bg-[#fff5f0] transition">View Parts →</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </main>

      {/* ═══ SELECTED ITEMS BAR ═══ */}
      {selectedItems.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t-2 border-[#ff6b35] shadow-[0_-4px_24px_rgba(0,0,0,0.1)]" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="max-w-7xl mx-auto px-3 sm:px-5 py-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div className="flex items-center justify-between sm:justify-start gap-3">
                <div>
                  <span className="font-bold text-[#222] text-sm">{selectedItems.size} item{selectedItems.size > 1 ? 's' : ''} selected</span>
                  <span className="text-xs text-[#aaa] ml-2">from {Object.keys(getSelectedByVendor()).length} shop{Object.keys(getSelectedByVendor()).length > 1 ? 's' : ''}</span>
                </div>
                <button onClick={() => setSelectedItems(new Set())} className="text-[11px] font-semibold text-[#aaa] bg-[#f5f5f5] px-3 py-1.5 rounded-lg active:bg-[#eee]">Clear</button>
              </div>
              <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                {Object.entries(getSelectedByVendor()).map(([vendorId, group]) => (
                  <a key={vendorId} href={buildWhatsAppUrl(group.vendor, group.items)} target="_blank"
                    className="flex-shrink-0 inline-flex items-center gap-1.5 bg-[#25d366] active:bg-[#1fb855] text-white text-xs font-bold px-5 py-2.5 rounded-xl shadow-[0_2px_8px_rgba(37,211,102,0.3)]">
                    💬 {group.vendor.name} ({group.items.length})
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className={`bg-[#fafafa] border-t border-[#eee] py-7 text-center ${selectedItems.size > 0 ? 'pb-24' : ''}`}>
        <div className="flex items-baseline justify-center gap-0.5 mb-1">
          <span className="text-lg font-black text-[#ff6b35]">kuruma</span>
          <span className="text-lg font-black text-[#333]">.lk</span>
        </div>
        <p className="text-xs text-[#bbb]">Sri Lanka&apos;s Auto Parts Marketplace</p>
      </footer>

      <style jsx global>{`
        div::-webkit-scrollbar { display: none; }
        .aspect-square { aspect-ratio: 1/1; }
      `}</style>
    </div>
  )
}
