'use client'

import { useState, useEffect, useRef } from 'react'
import type { Product, Vendor } from '@/types'

// Levenshtein distance between two strings
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => {
    const row = new Array(n + 1).fill(0)
    row[0] = i
    return row
  })
  for (let j = 1; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1])
  return dp[m][n]
}

// Soundex phonetic encoding
function soundex(s: string): string {
  const str = s.toLowerCase().replace(/[^a-z]/g, '')
  if (!str) return ''
  const map: Record<string, string> = { b:'1',f:'1',p:'1',v:'1', c:'2',g:'2',j:'2',k:'2',q:'2',s:'2',x:'2',z:'2', d:'3',t:'3', l:'4', m:'5',n:'5', r:'6' }
  let result = str[0].toUpperCase()
  let prev = map[str[0]] || ''
  for (let i = 1; i < str.length && result.length < 4; i++) {
    const code = map[str[i]] || ''
    if (code && code !== prev) result += code
    prev = code || prev
  }
  return result.padEnd(4, '0')
}

const CATEGORIES = [
  'All', 'Engine Parts', 'Transmission & Drivetrain', 'Suspension & Steering', 'Brake System',
  'Electrical & Electronics', 'Body Parts', 'Lighting', 'Interior Parts',
  'A/C & Radiator', 'Wheels & Tires', 'Exhaust System', 'Filters & Fluids',
  'Accessories', 'Hybrid & EV Parts', 'Others', 'Windscreen',
  'Beading Belts and Rubber', 'Audio & Video', 'Safety'
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
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const trackingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [wishlist, setWishlist] = useState<Set<string>>(new Set())
  const [wishlistOpen, setWishlistOpen] = useState(false)
  const [sortBy, setSortBy] = useState<string>('recommended')
  const [conditionFilter, setConditionFilter] = useState<string>('All')
  const [makeFilter, setMakeFilter] = useState<string>('All')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 0])
  const [priceFilter, setPriceFilter] = useState<[number, number]>([0, 999999999])
  const [showFilters, setShowFilters] = useState(false)
  const [synonyms, setSynonyms] = useState<string[][]>([])
  const [visibleCount, setVisibleCount] = useState(50)
  const loadMoreRef = useRef<HTMLDivElement>(null)

  useEffect(() => { (async () => {
    // Try cache first for instant load
    try {
      const cached = sessionStorage.getItem('kuruma_store')
      if (cached) {
        const j = JSON.parse(cached)
        setProducts(j.products); setVendors(j.vendors); setSynonyms(j.synonyms || [])
        setLoading(false)
      }
    } catch {}
    // Fetch fresh data (updates cache)
    try {
      const r = await fetch('/api/store')
      if (r.ok) {
        const j = await r.json()
        setProducts(j.products); setVendors(j.vendors); setSynonyms(j.synonyms || [])
        try { sessionStorage.setItem('kuruma_store', JSON.stringify(j)) } catch {}
      }
    } catch (e) { console.error(e) }
    setLoading(false)
  })() }, [])
  useEffect(() => { try { const s = localStorage.getItem('kuruma_wishlist'); if (s) setWishlist(new Set(JSON.parse(s))) } catch {} }, [])

  // Reset visible count when filters change
  useEffect(() => { setVisibleCount(50) }, [search, selectedCategory, conditionFilter, makeFilter, selectedVendor, sortBy])

  // Infinite scroll - show more products as user scrolls
  useEffect(() => {
    if (!loadMoreRef.current) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setVisibleCount(prev => prev + 50)
    }, { rootMargin: '400px' })
    observer.observe(loadMoreRef.current)
    return () => observer.disconnect()
  }, [])

  function updateWishlist(n: Set<string>) { setWishlist(n); try { localStorage.setItem('kuruma_wishlist', JSON.stringify([...n])) } catch {} }
  function toggleWishlist(id: string) { const n = new Set(wishlist); n.has(id) ? n.delete(id) : n.add(id); updateWishlist(n) }
  function removeFromWishlist(id: string) { const n = new Set(wishlist); n.delete(id); updateWishlist(n) }

  const uniqueMakes = ['All', ...Array.from(new Set(products.map(p => p.make).filter(Boolean))).sort()] as string[]
  const uniqueConditions = ['All', 'New-Genuine', 'New-Other', 'Reconditioned', 'Damaged']
  useEffect(() => { if (products.length > 0) { const pr = products.filter(p => p.price && p.show_price).map(p => p.price!); if (pr.length > 0) { setPriceRange([Math.min(...pr), Math.max(...pr)]); setPriceFilter([Math.min(...pr), Math.max(...pr)]) } } }, [products])

  // Popular part types — each group gets equal priority
  const PRIORITY_PART_GROUPS = [
    ['head light', 'headlight', 'head lamp', 'headlamp'],
    ['bonnet', 'hood'],
    ['door', 'front door', 'rear door'],
    ['tail light', 'tail lamp', 'taillight', 'rear light'],
    ['bumper', 'buffer', 'front bumper', 'rear bumper'],
    ['fender', 'mudguard'],
    ['side mirror', 'wing mirror', 'door mirror'],
    ['windshield', 'windscreen'],
    ['boot', 'trunk', 'boot lid'],
    ['radiator grill', 'grille', 'grill'],
    ['shock absorber', 'absorber'],
    ['brake pad', 'disc rotor', 'brake disc'],
    ['radiator'],
    ['alternator', 'starter motor'],
    ['compressor'],
  ]

  // Popular car models in Sri Lanka
  const PRIORITY_MODELS = ['wagon r', 'vezel', 'prius', 'aqua', 'corolla', 'civic', 'fit', 'vitz', 'axio', 'premio', 'alto', 'swift', 'every']

  // Track user searches in localStorage for personalized recommendations
  const [userSearchHistory, setUserSearchHistory] = useState<string[]>([])
  useEffect(() => {
    try { const h = localStorage.getItem('kuruma_search_history'); if (h) setUserSearchHistory(JSON.parse(h)) } catch {}
  }, [])

  function trackUserSearch(query: string) {
    if (!query || query.length < 2) return
    const q = query.toLowerCase().trim()
    setUserSearchHistory(prev => {
      const updated = [q, ...prev.filter(s => s !== q)].slice(0, 30) // Keep last 30 searches
      try { localStorage.setItem('kuruma_search_history', JSON.stringify(updated)) } catch {}
      return updated
    })
  }

  // Smart sort: show variety of popular parts × popular models
  function getProductRelevanceScore(p: any): number {
    const name = p.name.toLowerCase()
    const model = (p.model || '').toLowerCase()
    const make = (p.make || '').toLowerCase()
    const searchable = `${name} ${make} ${model}`
    let score = 0

    // Returning user: boost products matching their search history (higher weight for recent searches)
    if (userSearchHistory.length > 0) {
      for (let i = 0; i < userSearchHistory.length; i++) {
        const term = userSearchHistory[i]
        if (searchable.includes(term) || term.split(/\s+/).every(w => searchable.includes(w))) {
          score += Math.max(100 - i * 5, 10)
          break
        }
      }
    }

    // Demote minor/accessory items — these shouldn't appear at the top
    const DEMOTE_KEYWORDS = ['frame', 'retainer', 'bracket', 'bulb', 'hinge', 'clip', 'bolt', 'nut', 'washer', 'seal', 'gasket', 'bush', 'pin', 'cap', 'cover plate', 'garnish', 'switch', 'sensor', 'relay', 'fuse', 'connector', 'holder', 'mount', 'arm cup']
    const isDemoted = DEMOTE_KEYWORDS.some(kw => name.includes(kw))
    if (isDemoted) score -= 40

    // Demote damaged items
    if ((p.condition || '').toLowerCase() === 'damaged') score -= 50

    // Match against priority part types (all groups get equal base score)
    let partGroupIndex = -1
    if (!isDemoted) {
      for (let g = 0; g < PRIORITY_PART_GROUPS.length; g++) {
        if (PRIORITY_PART_GROUPS[g].some(kw => name.includes(kw))) {
          partGroupIndex = g
          score += 50 // All popular parts get same base score
          break
        }
      }
    }

    // Boost popular car models
    let modelIndex = -1
    for (let m = 0; m < PRIORITY_MODELS.length; m++) {
      if (model.includes(PRIORITY_MODELS[m]) || name.includes(PRIORITY_MODELS[m])) {
        modelIndex = m
        score += 30 // Popular model boost
        break
      }
    }

    // Extra boost if both popular part AND popular model (e.g., "Wagon R Head Light")
    if (partGroupIndex >= 0 && modelIndex >= 0) score += 20

    // Use part group + model index to interleave variety
    // This creates a pattern: Wagon R Headlight, Vezel Bonnet, Prius Door, etc.
    if (partGroupIndex >= 0 && modelIndex >= 0) {
      // Spread different part types across results by using group index as sub-sort
      score += (100 - (partGroupIndex * PRIORITY_MODELS.length + modelIndex) % 100) * 0.01
    }

    // Boost products with images (they look better in the grid)
    if (p.imageUrl) score += 3

    // Boost products with prices shown
    if (p.price && p.show_price) score += 2

    return score
  }

  // Search tracking (fire-and-forget, debounced)
  useEffect(() => {
    if (loading) return
    if (trackingTimeout.current) clearTimeout(trackingTimeout.current)
    trackingTimeout.current = setTimeout(() => {
      const hasQuery = search.trim().length > 0
      const hasCategory = selectedCategory !== 'All'
      const hasCondition = conditionFilter !== 'All'
      const hasMake = makeFilter !== 'All'
      if (!hasQuery && !hasCategory && !hasCondition && !hasMake) return
      if (hasQuery) trackUserSearch(search.trim())
      fetch('/api/analytics/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: search.trim(), category: selectedCategory, conditionFilter, makeFilter, resultCount: allFilteredProducts.length }),
      }).catch(() => {})
    }, 1500)
    return () => { if (trackingTimeout.current) clearTimeout(trackingTimeout.current) }
  }, [search, selectedCategory, conditionFilter, makeFilter, loading])

  const activeFilterCount = [conditionFilter !== 'All', makeFilter !== 'All', priceRange[1] > 0 && (priceFilter[0] !== priceRange[0] || priceFilter[1] !== priceRange[1])].filter(Boolean).length

  // Build vocabulary of known words from product names + synonym keywords
  const knownTerms = (() => {
    const terms = new Set<string>()
    products.forEach(p => {
      p.name.toLowerCase().split(/\s+/).forEach(w => { if (w.length > 2) terms.add(w) })
      // Also add multi-word product name segments (e.g., "brake pad", "timing belt")
      const name = p.name.toLowerCase()
      if (name.length > 2) terms.add(name)
    })
    synonyms.flat().forEach(kw => terms.add(kw.toLowerCase()))
    return Array.from(terms)
  })()

  // Expand search: split into words, expand each word via synonyms
  // Returns array of word groups — each group is alternatives for one search word
  // ALL word groups must match (AND), any alternative within a group can match (OR)
  function getSearchWordGroups(query: string): string[][] {
    if (!query) return []
    const q = query.toLowerCase().trim()
    const words = q.split(/\s+/).filter(w => w.length > 0)

    return words.map(word => {
      const alternatives = new Set<string>([word])
      for (const group of synonyms) {
        // Match if: exact match, or word is a whole word within a multi-word synonym, or synonym is a whole word within the search word
        const matched = group.some(kw => {
          if (kw === word) return true
          // Multi-word synonym contains this word as a whole word (e.g., "head lamp" contains "lamp")
          if (kw.includes(' ') && kw.split(' ').includes(word)) return true
          // This word exactly matches a synonym keyword
          if (!kw.includes(' ') && kw === word) return true
          return false
        })
        if (matched) group.forEach(kw => alternatives.add(kw))
      }
      return Array.from(alternatives)
    })
  }

  // Check if a product matches all search word groups
  function matchesAllWords(product: Product, wordGroups: string[][]): boolean {
    const searchable = `${product.name} ${product.sku || ''} ${product.make || ''} ${product.model || ''} ${product.vendor?.name || ''}`.toLowerCase()
    return wordGroups.every(alternatives =>
      alternatives.some(alt => searchable.includes(alt))
    )
  }

  // Find the best fuzzy/phonetic match for a search term
  function findCorrectedQuery(query: string): string | null {
    if (!query || knownTerms.length === 0) return null
    const q = query.toLowerCase().trim()
    if (q.length < 3) return null // Too short to correct
    const qSoundex = soundex(q)
    let bestMatch = ''
    let bestScore = Infinity

    for (const term of knownTerms) {
      // Skip multi-word terms and very short terms
      if (term.includes(' ') || term.length < 3) continue
      // Skip if lengths are too different (likely unrelated words)
      if (Math.abs(q.length - term.length) > 2) continue
      // Skip if it's an exact substring match (no correction needed)
      if (term.includes(q) || q.includes(term)) return null

      const dist = levenshtein(q, term)
      // Only consider if edit distance is max 2 (strict)
      if (dist > 2) continue

      // Must share first or last letter (likely same word, just misspelled)
      if (q[0] !== term[0] && q[q.length-1] !== term[term.length-1]) continue

      // Boost score for phonetic match
      const phoneticBonus = soundex(term) === qSoundex ? -1 : 0
      const score = dist + phoneticBonus

      if (score < bestScore) {
        bestScore = score
        bestMatch = term
      }
    }

    // Only suggest if very close (max 2 edits)
    if (bestMatch && bestScore <= 2) return bestMatch
    return null
  }

  // Client-side filtering with synonym expansion
  const searchWordGroups = getSearchWordGroups(search)
  const sortFn = (a: any, b: any) => {
    switch(sortBy) {
      case 'price-low': return (a.price||0)-(b.price||0)
      case 'price-high': return (b.price||0)-(a.price||0)
      case 'name-az': return a.name.localeCompare(b.name)
      case 'name-za': return b.name.localeCompare(a.name)
      case 'newest': return new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()
      default: {
        // Smart/recommended sort: relevance score first, then newest
        const scoreA = getProductRelevanceScore(a)
        const scoreB = getProductRelevanceScore(b)
        if (scoreA !== scoreB) return scoreB - scoreA
        return new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime()
      }
    }
  }

  const applyFilters = (p: any, matchesSearch: boolean) =>
    (selectedCategory === 'All' || p.category === selectedCategory)
    && (!selectedVendor || p.vendor_id === selectedVendor)
    && matchesSearch
    && (conditionFilter === 'All' || p.condition === conditionFilter)
    && (makeFilter === 'All' || p.make === makeFilter)
    && (!p.show_price || !p.price || ((p.price||0) >= priceFilter[0] && (p.price||0) <= priceFilter[1]))

  // Try direct search first
  const directResults = products.filter(p => applyFilters(p, !search || matchesAllWords(p, searchWordGroups)))

  // If 0 results and there's a search, try fuzzy/phonetic correction
  const correctedQuery = (search && directResults.length === 0) ? findCorrectedQuery(search.toLowerCase().trim()) : null
  const correctedWordGroups = correctedQuery ? getSearchWordGroups(correctedQuery) : []

  // Diversify recommended results: no same model+partType back-to-back
  function diversifyResults(sorted: any[]): any[] {
    if (sortBy !== 'recommended' || search) return sorted // Only diversify default recommended view

    // Get the part type group for a product
    function getPartType(p: any): string {
      const name = p.name.toLowerCase()
      for (const group of PRIORITY_PART_GROUPS) {
        if (group.some(kw => name.includes(kw))) return group[0]
      }
      return (p.category || 'other').toLowerCase()
    }

    function getModelKey(p: any): string {
      return `${(p.make || '').toLowerCase()}-${(p.model || '').toLowerCase()}`
    }

    const result: any[] = []
    const remaining = [...sorted]
    const recentModels: string[] = [] // track last 5 models shown
    const recentParts: string[] = [] // track last 5 part types shown
    const recentCategories: string[] = [] // track last 3 categories shown

    while (remaining.length > 0) {
      let bestIdx = 0
      let bestPenalty = Infinity

      // Look ahead up to 200 items to find variety
      for (let i = 0; i < Math.min(remaining.length, 200); i++) {
        const p = remaining[i]
        const modelKey = getModelKey(p)
        const partType = getPartType(p)
        const category = (p.category || '').toLowerCase()
        let penalty = 0

        // Penalize if same model was shown recently (track 5)
        const modelPos = recentModels.indexOf(modelKey)
        if (modelPos >= 0) penalty += Math.max(150 - modelPos * 30, 20)

        // Penalize if same part type was shown recently (track 5)
        const partPos = recentParts.indexOf(partType)
        if (partPos >= 0) penalty += Math.max(120 - partPos * 25, 15)

        // Penalize if same category was shown recently (track 3)
        const catPos = recentCategories.indexOf(category)
        if (catPos === 0) penalty += 60
        else if (catPos === 1) penalty += 25

        // Slight penalty for being further in the original sorted list
        penalty += i * 0.05

        if (penalty < bestPenalty) {
          bestPenalty = penalty
          bestIdx = i
        }
        if (penalty === 0) break
      }

      const picked = remaining.splice(bestIdx, 1)[0]
      result.push(picked)

      recentModels.unshift(getModelKey(picked))
      recentParts.unshift(getPartType(picked))
      recentCategories.unshift((picked.category || '').toLowerCase())
      if (recentModels.length > 5) recentModels.pop()
      if (recentParts.length > 5) recentParts.pop()
      if (recentCategories.length > 3) recentCategories.pop()
    }

    return result
  }

  const sortedResults = (directResults.length > 0 || !correctedQuery)
    ? directResults.sort(sortFn)
    : products.filter(p => applyFilters(p, matchesAllWords(p, correctedWordGroups))).sort(sortFn)

  const allFilteredProducts = diversifyResults(sortedResults)

  // Only render visible portion (infinite scroll)
  const filteredProducts = allFilteredProducts.slice(0, visibleCount)
  const hasMoreToShow = allFilteredProducts.length > visibleCount

  const selectedVendorObj = selectedVendor ? vendors.find(v => v.id === selectedVendor) : null
  const isVendorView = !!(selectedVendor && selectedVendorObj)
  function selectVendor(id: string) { setSelectedVendor(id); setActiveTab('products'); setSelectedCategory('All'); setSearch(''); window.scrollTo({top:0,behavior:'smooth'}) }
  function clearVendor() { setSelectedVendor(null); setActiveTab('products') }
  function clearAllFilters() { setSearch(''); setSelectedCategory('All'); setConditionFilter('All'); setMakeFilter('All'); setPriceFilter([priceRange[0],priceRange[1]]); setSortBy('newest') }

  const wishlistProducts = products.filter(p => wishlist.has(p.id)).sort((a,b) => new Date(b.created_at||0).getTime()-new Date(a.created_at||0).getTime())
  const wishlistByVendor: Record<string, {vendor:Vendor; items:typeof wishlistProducts}> = {}
  wishlistProducts.forEach(p => { if(p.vendor) { if(!wishlistByVendor[p.vendor_id]) wishlistByVendor[p.vendor_id]={vendor:p.vendor,items:[]}; wishlistByVendor[p.vendor_id].items.push(p) } })

  return (
    <div className="min-h-screen bg-[#f5f5f5] overflow-x-hidden">
      <header className="bg-white sticky top-0 z-50 shadow-[0_1px_3px_rgba(0,0,0,0.06)] border-b border-[#f0f0f0]">
        <div className="max-w-7xl mx-auto px-3 sm:px-5">
          {isVendorView ? (
            <div className="flex items-center gap-3 py-2.5">
              <button onClick={clearVendor} className="flex items-center gap-1 text-sm font-semibold text-[#666] active:text-[#333] py-1 -ml-1 flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>Back
              </button>
              <div className="w-px h-6 bg-[#eee]"/>
              <div className="flex items-center gap-2.5 flex-1 min-w-0">
                <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-white font-black text-sm flex-shrink-0 shadow-[0_2px_8px_rgba(255,107,53,0.3)]" style={{background:'linear-gradient(135deg,#ff6b35,#ff8f65)'}}>{selectedVendorObj!.name.charAt(0)}</div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-bold text-[15px] text-[#111] truncate">{selectedVendorObj!.name}</h2>
                  <p className="text-xs text-[#999] truncate">{selectedVendorObj!.location} · {filteredProducts.length} parts</p>
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <a href={`tel:${selectedVendorObj!.phone}`} className="w-9 h-9 rounded-[10px] bg-[#f7f7f7] border border-[#eee] flex items-center justify-center text-sm active:bg-[#eee]">📞</a>
                <a href={`https://wa.me/${(selectedVendorObj!.whatsapp||'').replace(/[^0-9]/g,'')}`} target="_blank" className="w-9 h-9 rounded-[10px] bg-[#25d366] flex items-center justify-center text-sm active:bg-[#1fb855]">💬</a>
              </div>
            </div>
          ) : (<>
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-0.5"><span className="text-2xl font-black tracking-tight text-[#ff6b35]">kuruma</span><span className="text-2xl font-black tracking-tight text-[#222]">.lk</span></div>
              <div className="flex gap-2 items-center">
                <a href="/login" className="sm:hidden text-xs font-semibold px-3 py-2 rounded-[10px] bg-white text-[#555] border-[1.5px] border-[#e5e5e5] active:bg-[#f5f5f5]">Login</a>
                <a href="/login" className="hidden sm:flex text-xs font-semibold px-3.5 py-2 rounded-[10px] bg-white text-[#555] border-[1.5px] border-[#e5e5e5] items-center active:bg-[#f5f5f5]">Vendor Login</a>
                <a href="/register" className="text-xs font-bold px-4 py-2 rounded-[10px] text-white flex items-center gap-1 shadow-[0_2px_8px_rgba(255,107,53,0.3)]" style={{background:'linear-gradient(135deg,#ff6b35,#ff8f65)'}}><span className="hidden sm:inline">Start Selling</span><span className="sm:hidden">Sell</span></a>
              </div>
            </div>
            <div className="relative pb-2.5">
              <svg className="absolute left-3.5 top-[13px] text-[#bbb]" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input ref={searchRef} type="text" placeholder="Search parts, vehicles, shops..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-11 pr-10 py-[11px] rounded-[14px] text-base sm:text-sm outline-none bg-[#f7f7f7] text-[#333] transition-all duration-200 border-2 border-transparent focus:bg-white focus:border-[#ff6b35] focus:shadow-[0_0_0_4px_rgba(255,107,53,0.08)]"/>
              {search && <button onClick={()=>{setSearch('');searchRef.current?.focus()}} className="absolute right-3 top-[11px] w-[22px] h-[22px] bg-[#eee] rounded-full flex items-center justify-center text-[11px] text-[#888] active:bg-[#ddd]">✕</button>}
            </div>
            <div className="flex">
              {[{key:'products' as const,label:'Products'},{key:'shops' as const,label:`Shops (${vendors.length})`}].map(t=>(<button key={t.key} onClick={()=>{setActiveTab(t.key);setSelectedVendor(null)}} className={`flex-1 py-3 text-center text-[13px] font-bold transition-colors border-b-[2.5px] ${activeTab===t.key?'border-[#ff6b35] text-[#ff6b35]':'border-transparent text-[#aaa] active:text-[#666]'}`}>{t.label}</button>))}
            </div>
          </>)}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-5 py-4">
        {(activeTab==='products'||isVendorView) && (<div>
          {isVendorView && selectedVendorObj!.description && <p className="text-[13px] bg-white rounded-[14px] px-4 py-3 mb-3.5 text-[#777] border border-[#eee] leading-relaxed">{selectedVendorObj!.description}</p>}
          {isVendorView && (<div className="relative mb-3"><svg className="absolute left-3 top-[11px] text-[#bbb]" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="text" placeholder={`Search in ${selectedVendorObj!.name}...`} value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-9 pr-10 py-2.5 rounded-[14px] text-sm outline-none bg-white border-[1.5px] border-[#e8e8e8] focus:border-[#ff6b35]"/>{search&&<button onClick={()=>setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#aaa]">✕</button>}</div>)}

          {/* ── Desktop sidebar + Mobile pills layout ── */}
          <div className="flex gap-6">

          {/* ── Desktop Left Sidebar ── */}
          <aside className="hidden lg:flex flex-col gap-0 w-52 flex-shrink-0">
            <div className="sticky top-4 bg-white rounded-2xl border border-[#eee] overflow-hidden shadow-sm">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[#f5f5f5]">
                <span className="font-black text-sm text-[#222]">Filters</span>
                {activeFilterCount>0&&<button onClick={clearAllFilters} className="text-[11px] font-bold text-[#ff6b35]">Clear all</button>}
              </div>
              <div className="p-3 max-h-[calc(100vh-32px)] overflow-y-auto">
                {/* Categories */}
                <p className="text-[10px] font-black text-[#bbb] uppercase tracking-wider mb-2">Category</p>
                <div className="space-y-0.5 mb-4">
                  {CATEGORIES.map(cat=>(
                    <button key={cat} onClick={()=>setSelectedCategory(cat)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${selectedCategory===cat?'bg-[#ff6b35] text-white':'text-[#555] hover:bg-[#fff5f0] hover:text-[#ff6b35]'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
                {/* Condition */}
                <p className="text-[10px] font-black text-[#bbb] uppercase tracking-wider mb-2">Condition</p>
                <div className="space-y-0.5 mb-4">
                  {['All','New-Genuine','New-Other','Reconditioned','Damaged'].map(c=>(
                    <button key={c} onClick={()=>setConditionFilter(c)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${conditionFilter===c?'bg-[#ff6b35] text-white':'text-[#555] hover:bg-[#fff5f0] hover:text-[#ff6b35]'}`}>
                      {c}
                    </button>
                  ))}
                </div>
                {/* Make */}
                <p className="text-[10px] font-black text-[#bbb] uppercase tracking-wider mb-2">Make</p>
                <select value={makeFilter} onChange={e=>{setMakeFilter(e.target.value)}}
                  className="w-full px-2.5 py-2 rounded-lg border border-[#eee] text-xs font-semibold text-[#555] outline-none bg-white mb-4 cursor-pointer">
                  {['All',...Array.from(new Set(products.map((p:any)=>p.make).filter(Boolean))).sort()].map((m:any)=><option key={m} value={m}>{m}</option>)}
                </select>
                {/* Price range */}
                {priceRange[1]>0&&(<>
                  <p className="text-[10px] font-black text-[#bbb] uppercase tracking-wider mb-2">Price Range</p>
                  <div className="px-1 mb-1">
                    <div className="flex justify-between text-[10px] text-[#aaa] mb-2">
                      <span>Rs.{priceFilter[0].toLocaleString()}</span>
                      <span>Rs.{priceFilter[1].toLocaleString()}</span>
                    </div>
                    <input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[0]}
                      onChange={e=>{const v=parseInt(e.target.value);setPriceFilter([Math.min(v,priceFilter[1]-100),priceFilter[1]])}}
                      className="w-full h-1.5 accent-[#ff6b35] mb-1"/>
                    <input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[1]}
                      onChange={e=>{const v=parseInt(e.target.value);setPriceFilter([priceFilter[0],Math.max(v,priceFilter[0]+100)])}}
                      className="w-full h-1.5 accent-[#ff6b35]"/>
                  </div>
                </>)}
              </div>
            </div>
          </aside>

          {/* ── Right column: mobile pills + sort + grid ── */}
          <div className="flex-1 min-w-0">

          {/* Category pills — mobile only */}
          <div className="relative mb-3 lg:hidden"><div className="flex gap-2 overflow-x-auto pb-1.5" style={{WebkitOverflowScrolling:'touch',scrollbarWidth:'none',msOverflowStyle:'none'}}>
            {CATEGORIES.map(cat=>(<button key={cat} onClick={()=>setSelectedCategory(cat)} className={`whitespace-nowrap px-4 py-[9px] rounded-full text-xs font-semibold transition-all duration-200 flex-shrink-0 ${selectedCategory===cat?'bg-[#ff6b35] text-white shadow-[0_4px_12px_rgba(255,107,53,0.3)]':'bg-white text-[#777] border-[1.5px] border-[#e8e8e8] active:border-[#ff6b35] active:bg-[#fff5f0]'}`}>{cat}</button>))}
          </div><div className="absolute right-0 top-0 bottom-1.5 w-12 bg-gradient-to-l from-[#f5f5f5] to-transparent pointer-events-none"/></div>

          {/* Sort / Filter / Wishlist row */}
          <div className="flex items-center gap-2 mb-3.5">
            <div className="relative flex-shrink-0">
              <select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="text-xs font-semibold bg-white rounded-[10px] pl-3 pr-8 py-[9px] border-[1.5px] border-[#e8e8e8] text-[#555] outline-none appearance-none cursor-pointer">
                <option value="recommended">Recommended</option><option value="newest">Newest First</option><option value="price-low">Price: Low to High</option><option value="price-high">Price: High to Low</option><option value="name-az">Name: A → Z</option><option value="name-za">Name: Z → A</option>
              </select>
              <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[#999]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg>
            </div>
            <button onClick={()=>setShowFilters(!showFilters)} className={`text-xs font-semibold px-3.5 py-[9px] rounded-[10px] flex items-center gap-1.5 transition-all duration-200 flex-shrink-0 ${showFilters||activeFilterCount>0?'bg-[#fff5f0] border-[1.5px] border-[#ff6b35] text-[#ff6b35]':'bg-white border-[1.5px] border-[#e8e8e8] text-[#777] active:border-[#ff6b35]'}`}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="12" y1="18" x2="20" y2="18"/></svg>Filters
              {activeFilterCount>0&&<span className="bg-[#ff6b35] text-white text-[9px] font-black w-[18px] h-[18px] rounded-full flex items-center justify-center">{activeFilterCount}</span>}
            </button>
            {activeFilterCount>0&&<button onClick={()=>{setConditionFilter('All');setMakeFilter('All');setPriceFilter([priceRange[0],priceRange[1]])}} className="text-xs font-semibold text-[#ff6b35] underline underline-offset-2 flex-shrink-0">Clear</button>}
            <div className="flex-1"/>
            <button onClick={()=>setWishlistOpen(true)} className="relative text-xs font-bold px-3.5 py-[9px] rounded-[10px] bg-white border-[1.5px] border-[#e8e8e8] text-[#555] flex items-center gap-1.5 active:bg-[#fef2f2] active:border-[#fca5a5] transition-all flex-shrink-0">
              ❤️ Saved{wishlist.size>0&&<span className="bg-[#ef4444] text-white text-[9px] font-black min-w-[18px] h-[18px] rounded-full flex items-center justify-center px-1">{wishlist.size}</span>}
            </button>
          </div>

          {/* Filter Panel */}
          {showFilters&&(<div className="bg-white rounded-2xl p-4 sm:p-5 mb-4 border border-[#eee] shadow-[0_4px_24px_rgba(0,0,0,0.04)]">
            <div className="flex flex-col sm:flex-row gap-5">
              <div className="flex-1"><label className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#bbb] mb-2.5 block">Condition</label><div className="flex gap-1.5 flex-wrap">{uniqueConditions.map(c=>(<button key={c} onClick={()=>setConditionFilter(c)} className={`px-3.5 py-[7px] rounded-lg text-xs font-semibold transition-all duration-150 ${conditionFilter===c?'bg-[#ff6b35] text-white shadow-[0_2px_8px_rgba(255,107,53,0.25)]':'bg-[#f5f5f5] text-[#888] active:bg-[#eee]'}`}>{c}</button>))}</div></div>
              <div className="flex-1"><label className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#bbb] mb-2.5 block">Vehicle Make</label><div className="relative"><select value={makeFilter} onChange={e=>setMakeFilter(e.target.value)} className="w-full px-3.5 py-2.5 rounded-[10px] text-sm font-semibold border-[1.5px] border-[#eee] text-[#555] outline-none bg-[#fafafa] appearance-none cursor-pointer">{uniqueMakes.map(m=><option key={m} value={m}>{m}</option>)}</select><svg className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[#999]" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6"/></svg></div></div>
            </div>
            {priceRange[1]>0&&(<div className="mt-4 pt-4 border-t border-[#f0f0f0]"><label className="text-[10px] font-bold uppercase tracking-[1.2px] text-[#bbb] mb-2.5 block">Price: <span className="text-[#ff6b35]">Rs.{priceFilter[0].toLocaleString()}</span> – <span className="text-[#ff6b35]">Rs.{priceFilter[1].toLocaleString()}</span></label><div className="flex items-center gap-3"><input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[0]} onChange={e=>{const v=parseInt(e.target.value);setPriceFilter([Math.min(v,priceFilter[1]-100),priceFilter[1]])}} className="flex-1 h-1.5 accent-[#ff6b35]"/><input type="range" min={priceRange[0]} max={priceRange[1]} step={100} value={priceFilter[1]} onChange={e=>{const v=parseInt(e.target.value);setPriceFilter([priceFilter[0],Math.max(v,priceFilter[0]+100)])}} className="flex-1 h-1.5 accent-[#ff6b35]"/></div></div>)}
          </div>)}

          {/* Spell correction notice */}
          {correctedQuery && allFilteredProducts.length > 0 && (
            <div className="mb-3 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-sm">
              <span className="text-blue-600">Showing results for </span>
              <button onClick={() => setSearch(correctedQuery)} className="font-bold text-blue-700 underline">{correctedQuery}</button>
              <span className="text-blue-400 ml-2">·</span>
              <span className="text-blue-400 ml-2">Search instead for </span>
              <span className="font-medium text-blue-500 line-through">{search}</span>
            </div>
          )}

          {/* Product Grid */}
          {loading ?(<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{[...Array(8)].map((_,i)=>(<div key={i} className="bg-white rounded-2xl overflow-hidden border border-[#eee]"><div className="aspect-[4/3] bg-gradient-to-br from-[#f5f5f5] to-[#eee] animate-pulse"/><div className="p-3 space-y-2.5"><div className="h-5 w-16 bg-[#f0f0f0] rounded-md animate-pulse"/><div className="h-4 bg-[#f0f0f0] rounded animate-pulse"/><div className="h-3.5 bg-[#f0f0f0] rounded animate-pulse w-2/3"/></div></div>))}</div>
          ) : filteredProducts.length===0 ? (<div className="text-center py-20"><div className="w-[72px] h-[72px] rounded-full bg-[#f5f5f5] mx-auto mb-4 flex items-center justify-center text-[28px]">🔍</div><p className="font-bold text-[17px] text-[#333]">No parts found</p><p className="text-sm text-[#aaa] mt-1.5">Try adjusting your search or filters</p>{(search||selectedCategory!=='All'||activeFilterCount>0)&&<button onClick={clearAllFilters} className="mt-5 text-sm font-bold px-6 py-2.5 rounded-xl text-white shadow-[0_4px_12px_rgba(255,107,53,0.25)]" style={{background:'linear-gradient(135deg,#ff6b35,#ff8f65)'}}>Clear all filters</button>}{isVendorView&&<button onClick={clearVendor} className="mt-3 block mx-auto text-sm font-bold text-[#ff6b35] underline">Browse all shops</button>}</div>
          ) : (<div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-3 gap-3">
            {filteredProducts.map(product => {
              const imageUrl = getProductImage(product); const imageCount = product.images?.length||0; const isWished = wishlist.has(product.id)
              return (<div key={product.id} className="bg-white rounded-2xl overflow-hidden relative group transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.1)] border border-[#eee]">
                <button onClick={e=>{e.preventDefault();e.stopPropagation();toggleWishlist(product.id)}} className={`absolute top-2.5 right-2.5 z-10 w-[30px] h-[30px] rounded-lg flex items-center justify-center text-sm transition-all duration-200 ${isWished?'bg-red-500 shadow-[0_2px_12px_rgba(239,68,68,0.4)] scale-105':'bg-white/95 backdrop-blur-sm border-[1.5px] border-black/10 shadow-[0_1px_4px_rgba(0,0,0,0.08)]'}`}>{isWished?'❤️':'🤍'}</button>
                <a href={`/product/${product.id}`} className="block">
                  <div className="aspect-[4/3] bg-[#fafafa] relative overflow-hidden">
                    {imageUrl?<img src={imageUrl} alt={product.name} loading="lazy" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"/>:<div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#f8f8f8] to-[#f0f0f0]"><span className="text-[40px] opacity-[0.08]">🔧</span></div>}
                    {imageCount>1&&<span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur text-white text-[10px] font-bold px-2 py-0.5 rounded-md">📷 {imageCount}</span>}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className={`text-[10px] font-bold px-2 py-[3px] rounded-md ${product.condition==='Excellent'?'bg-[#ecfdf5] text-[#059669]':product.condition==='Good'?'bg-[#eff6ff] text-[#2563eb]':product.condition==='Fair'?'bg-[#fffbeb] text-[#d97706]':'bg-[#fef2f2] text-[#dc2626]'}`}>{product.condition}</span>
                      <span className="text-[10px] font-medium text-[#ccc]">{product.category}</span>
                    </div>
                    <h3 className="font-bold text-[13px] text-[#222] leading-tight line-clamp-2 min-h-[36px]">{product.name}</h3>
                    {(product.make||product.model)&&<p className="text-[11px] text-[#aaa] mt-1 truncate">🚗 {[product.make,product.model,product.year].filter(Boolean).join(' · ')}</p>}
                    <div className="flex items-baseline justify-between mt-2 pt-2 border-t border-[#f5f5f5]">
                      <span className="font-black text-base text-[#ff6b35] tracking-tight">{formatPrice(product.price,product.show_price)}</span>
                      <span className={`text-[10px] font-semibold px-[7px] py-[2px] rounded-[5px] ${product.quantity<=3?'bg-[#fef2f2] text-[#ef4444]':'bg-[#ecfdf5] text-[#10b981]'}`}>{product.quantity<=3?`Only ${product.quantity}`:'In Stock'}</span>
                    </div>
                    {!isVendorView&&product.vendor&&<button onClick={e=>{e.preventDefault();e.stopPropagation();selectVendor(product.vendor_id)}} className="text-[11px] font-semibold text-[#888] hover:text-[#ff6b35] mt-2 flex items-center gap-1 transition-colors">🏪 {product.vendor.name} <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>}
                  </div>
                </a>
              </div>)
            })}
          </div>)}

          {/* Infinite scroll sentinel */}
          <div ref={loadMoreRef} />
          {hasMoreToShow && (
            <div className="flex justify-center py-6">
              <div className="flex items-center gap-3 text-sm text-slate-400">
                <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" />
                Loading more...
              </div>
            </div>
          )}
          {!hasMoreToShow && allFilteredProducts.length > 0 && !loading && (
            <p className="text-center text-xs text-slate-300 py-6">Showing all {allFilteredProducts.length} products</p>
          )}
        </div>{/* end right column */}
          </div>{/* end sidebar flex */}
        </div>)}

        {/* ═══ SHOPS TAB ═══ */}
        {activeTab==='shops'&&!isVendorView&&(()=>{
          const fv = vendors.filter(v=>{if(!search)return true;const s=search.toLowerCase();return v.name.toLowerCase().includes(s)||(v.location||'').toLowerCase().includes(s)})
          return fv.length===0?(<div className="text-center py-20"><div className="w-[72px] h-[72px] rounded-full bg-[#f5f5f5] mx-auto mb-4 flex items-center justify-center text-[28px]">🏪</div><p className="font-bold text-[17px] text-[#333]">No shops found</p></div>
          ):(<div className="space-y-3 sm:space-y-0 sm:grid sm:grid-cols-2 lg:grid-cols-3 sm:gap-3">
            {fv.map(vendor=>{const vp=products.filter(p=>p.vendor_id===vendor.id);const vc=[...new Set(vp.map(p=>p.category))].slice(0,4);return(
              <div key={vendor.id} className="bg-white rounded-2xl overflow-hidden border border-[#eee] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]">
                <button onClick={()=>selectVendor(vendor.id)} className="w-full p-[18px] pb-3.5 text-left active:bg-[#fafafa] transition">
                  <div className="flex items-center gap-3.5">
                    <div className="w-[52px] h-[52px] rounded-[14px] flex items-center justify-center text-white font-black text-[22px] flex-shrink-0 shadow-[0_4px_12px_rgba(255,107,53,0.25)]" style={{background:'linear-gradient(135deg,#ff6b35,#ff8f65)'}}>{vendor.name.charAt(0)}</div>
                    <div className="flex-1 min-w-0"><h3 className="font-bold text-[16px] text-[#222]">{vendor.name}</h3><p className="text-[13px] text-[#999] mt-0.5">📍 {vendor.location}</p></div>
                    <div className="text-right flex-shrink-0"><p className="text-[22px] font-black text-[#ff6b35]">{vp.length}</p><p className="text-[10px] font-semibold text-[#ccc] uppercase tracking-wide">parts</p></div>
                  </div>
                  {vendor.description&&<p className="text-xs text-[#aaa] mt-3 leading-relaxed">{vendor.description}</p>}
                  {vc.length>0&&<div className="flex gap-1.5 flex-wrap mt-2.5">{vc.map(c=><span key={c} className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#f7f7f7] text-[#888]">{c}</span>)}</div>}
                </button>
                <div className="flex border-t border-[#f0f0f0]">
                  <a href={`tel:${vendor.phone}`} className="flex-1 text-center text-xs font-semibold text-[#888] py-3.5 active:bg-[#fafafa] hover:bg-[#fafafa] transition border-r border-[#f0f0f0]">📞 Call</a>
                  <a href={`https://wa.me/${(vendor.whatsapp||'').replace(/[^0-9]/g,'')}`} target="_blank" className="flex-1 text-center text-xs font-bold text-[#25d366] py-3.5 active:bg-[#f0fdf4] hover:bg-[#f0fdf4] transition border-r border-[#f0f0f0]">💬 WhatsApp</a>
                  <button onClick={()=>selectVendor(vendor.id)} className="flex-1 text-center text-xs font-bold text-[#ff6b35] py-3.5 active:bg-[#fff5f0] hover:bg-[#fff5f0] transition">View Parts →</button>
                </div>
              </div>
            )})}
          </div>)
        })()}
      </main>

      {/* ═══ WISHLIST SLIDE-IN ═══ */}
      {wishlistOpen&&(<div className="fixed inset-0 z-[100]" onClick={()=>setWishlistOpen(false)}>
        <div className="absolute inset-0 bg-black/40"/>
        <div className="absolute right-0 top-0 bottom-0 w-full sm:w-[420px] bg-[#f5f5f5] shadow-[-8px_0_30px_rgba(0,0,0,0.15)] flex flex-col overflow-hidden" onClick={e=>e.stopPropagation()}>
          <div className="bg-white px-4 py-3.5 flex items-center justify-between border-b border-[#eee] flex-shrink-0">
            <div className="flex items-center gap-2.5"><span className="text-lg">❤️</span><div><h2 className="font-bold text-[15px] text-[#222]">Saved Parts</h2><p className="text-[11px] text-[#aaa]">{wishlistProducts.length} item{wishlistProducts.length!==1?'s':''}</p></div></div>
            <div className="flex items-center gap-2">
              {wishlistProducts.length>0&&<button onClick={()=>{if(confirm('Clear entire wishlist?'))updateWishlist(new Set())}} className="text-[11px] font-semibold text-[#aaa] bg-[#f5f5f5] px-2.5 py-1.5 rounded-lg active:bg-[#eee]">Clear All</button>}
              <button onClick={()=>setWishlistOpen(false)} className="w-8 h-8 rounded-lg bg-[#f5f5f5] flex items-center justify-center text-[#888] text-sm font-bold active:bg-[#eee]">✕</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {wishlistProducts.length===0?(<div className="text-center py-16 px-6"><div className="w-16 h-16 rounded-full bg-[#fef2f2] mx-auto mb-4 flex items-center justify-center text-[24px]">❤️</div><p className="font-bold text-[15px] text-[#333]">Your wishlist is empty</p><p className="text-sm text-[#aaa] mt-1">Tap the heart on any part to save it</p><button onClick={()=>setWishlistOpen(false)} className="mt-5 text-sm font-bold px-6 py-2.5 rounded-xl text-white" style={{background:'linear-gradient(135deg,#ff6b35,#ff8f65)'}}>Browse Parts</button></div>
            ):(<div className="p-4 space-y-5">
              {Object.entries(wishlistByVendor).map(([vid,group])=>(<div key={vid}>
                <div className="flex items-center justify-between mb-2.5 bg-white rounded-xl px-3.5 py-3 border border-[#eee]">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-xs flex-shrink-0" style={{background:'linear-gradient(135deg,#ff6b35,#ff8f65)'}}>{group.vendor.name.charAt(0)}</div>
                    <div className="min-w-0"><p className="font-bold text-[13px] text-[#222] truncate">{group.vendor.name}</p><p className="text-[10px] text-[#aaa]">{group.items.length} saved</p></div>
                  </div>
                  <a href={`https://wa.me/${(group.vendor.whatsapp||'').replace(/[^0-9]/g,'')}?text=${encodeURIComponent(`Hi ${group.vendor.name},\n\nI'm interested in these parts:\n${group.items.map(p=>`- ${p.sku} - ${p.name}`).join('\n')}\n\nPlease let me know availability and pricing.`)}`} target="_blank" className="flex items-center gap-1.5 bg-[#25d366] active:bg-[#1fb855] text-white text-[11px] font-bold px-3.5 py-2 rounded-lg shadow-[0_2px_8px_rgba(37,211,102,0.25)] flex-shrink-0">💬 WhatsApp All</a>
                </div>
                <div className="space-y-2">{group.items.map(product=>{const img=getProductImage(product);return(<div key={product.id} className="bg-white rounded-xl border border-[#eee] overflow-hidden flex">
                  <a href={`/product/${product.id}`} onClick={()=>setWishlistOpen(false)} className="w-[90px] flex-shrink-0 bg-[#fafafa]">{img?<img src={img} alt={product.name} className="w-full h-full object-cover" style={{minHeight:90}}/>:<div className="w-full flex items-center justify-center" style={{minHeight:90}}><span className="text-2xl opacity-10">🔧</span></div>}</a>
                  <div className="flex-1 p-2.5 min-w-0 flex flex-col justify-between">
                    <div>
                      <span className={`text-[9px] font-bold px-1.5 py-[2px] rounded ${product.condition==='Excellent'?'bg-[#ecfdf5] text-[#059669]':product.condition==='Good'?'bg-[#eff6ff] text-[#2563eb]':product.condition==='Fair'?'bg-[#fffbeb] text-[#d97706]':'bg-[#fef2f2] text-[#dc2626]'}`}>{product.condition}</span>
                      <a href={`/product/${product.id}`} onClick={()=>setWishlistOpen(false)} className="font-bold text-[12px] text-[#222] leading-tight line-clamp-2 block mt-1">{product.name}</a>
                      {(product.make||product.model)&&<p className="text-[10px] text-[#aaa] mt-0.5 truncate">{[product.make,product.model,product.year].filter(Boolean).join(' · ')}</p>}
                    </div>
                    <div className="flex items-center justify-between mt-1.5"><span className="font-black text-[14px] text-[#ff6b35]">{formatPrice(product.price,product.show_price)}</span><button onClick={()=>removeFromWishlist(product.id)} className="text-[10px] font-semibold text-[#ccc] active:text-red-400 px-1.5 py-0.5">Remove</button></div>
                  </div>
                </div>)})}</div>
              </div>))}
            </div>)}
          </div>
        </div>
      </div>)}

      <footer className="bg-[#fafafa] border-t border-[#eee] py-7 text-center">
        <div className="flex items-baseline justify-center gap-0.5 mb-1"><span className="text-lg font-black text-[#ff6b35]">kuruma</span><span className="text-lg font-black text-[#333]">.lk</span></div>
        <p className="text-xs text-[#bbb]">Sri Lanka&apos;s Auto Parts Marketplace</p>
      </footer>
      <style jsx global>{`html,body{overflow-x:hidden;max-width:100vw}div::-webkit-scrollbar{display:none}.aspect-square{aspect-ratio:1/1}`}</style>
    </div>
  )
}
