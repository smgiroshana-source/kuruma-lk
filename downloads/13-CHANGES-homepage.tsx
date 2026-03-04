// ============================================================
// CHANGES FOR: src/app/page.tsx (Homepage)
// Feature: 4 (Dynamic filtering & sorting for customers)
// ============================================================


// ═══════════════════════════════════════════════════════════
// CHANGE 1: Add new state variables (after existing useState)
// ═══════════════════════════════════════════════════════════
// FIND: const searchRef = useRef<HTMLInputElement>(null)
// ADD AFTER IT:

  const [sortBy, setSortBy] = useState<string>('newest')
  const [conditionFilter, setConditionFilter] = useState<string>('All')
  const [makeFilter, setMakeFilter] = useState<string>('All')
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 0])
  const [priceFilter, setPriceFilter] = useState<[number, number]>([0, 999999999])
  const [showFilters, setShowFilters] = useState(false)


// ═══════════════════════════════════════════════════════════
// CHANGE 2: Add computed values (after the useEffect that fetches data)
// ═══════════════════════════════════════════════════════════

  const uniqueMakes = ['All', ...Array.from(new Set(products.map(p => p.make).filter(Boolean))).sort()] as string[]
  const uniqueConditions = ['All', 'Excellent', 'Good', 'Fair', 'Salvage']

  // Calculate price range from data
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


// ═══════════════════════════════════════════════════════════
// CHANGE 3: Replace the filteredProducts computation
// ═══════════════════════════════════════════════════════════
// FIND the existing filteredProducts block:
//   const filteredProducts = products.filter((p) => {
//     const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory
//     const matchesVendor = ...
//     ...
//     return matchesCategory && matchesSearch && matchesVendor
//   })
//
// REPLACE WITH:

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


// ═══════════════════════════════════════════════════════════
// CHANGE 4: Add Sort & Filter Bar in JSX
// ═══════════════════════════════════════════════════════════
// FIND the category pills closing div (the one with fade scroll hint):
//   <div className="absolute right-0 top-0 bottom-2 w-8 bg-gradient-to-l from-slate-50 to-transparent pointer-events-none" />
// </div>
//
// ADD THIS BLOCK right AFTER it:

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
