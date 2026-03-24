// Search worker — runs filtering/sorting off the main thread

// Levenshtein distance
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, (_, i) => {
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

// Soundex
function soundex(s) {
  const str = s.toLowerCase().replace(/[^a-z]/g, '')
  if (!str) return ''
  const map = { b:'1',f:'1',p:'1',v:'1', c:'2',g:'2',j:'2',k:'2',q:'2',s:'2',x:'2',z:'2', d:'3',t:'3', l:'4', m:'5',n:'5', r:'6' }
  let result = str[0].toUpperCase()
  let prev = map[str[0]] || ''
  for (let i = 1; i < str.length && result.length < 4; i++) {
    const code = map[str[i]] || ''
    if (code && code !== prev) result += code
    prev = code || prev
  }
  return result.padEnd(4, '0')
}

function getSearchWordGroups(query, synonyms) {
  if (!query) return []
  const words = query.toLowerCase().trim().split(/\s+/).filter(w => w.length > 0)
  return words.map(word => {
    const alternatives = new Set([word])
    for (const group of synonyms) {
      const matched = group.some(kw => {
        if (kw === word) return true
        if (kw.includes(' ') && kw.split(' ').includes(word)) return true
        return false
      })
      if (matched) group.forEach(kw => alternatives.add(kw))
    }
    return Array.from(alternatives)
  })
}

function matchesAllWords(product, wordGroups) {
  const searchable = `${product.name} ${product.sku || ''} ${product.make || ''} ${product.model || ''} ${product._vendorName || ''}`.toLowerCase()
  return wordGroups.every(alts => alts.some(alt => searchable.includes(alt)))
}

self.onmessage = function(e) {
  const { type, products, search, synonyms, filters } = e.data

  if (type === 'filter') {
    const wordGroups = getSearchWordGroups(search, synonyms)
    const { selectedCategory, selectedVendor, conditionFilter, makeFilter, priceFilter } = filters

    const results = products.filter(p => {
      const matchesSearch = !search || matchesAllWords(p, wordGroups)
      return (selectedCategory === 'All' || p.category === selectedCategory)
        && (!selectedVendor || p.vendor_id === selectedVendor)
        && matchesSearch
        && (conditionFilter === 'All' || p.condition === conditionFilter)
        && (makeFilter === 'All' || p.make === makeFilter)
        && (!p.show_price || !p.price || ((p.price || 0) >= priceFilter[0] && (p.price || 0) <= priceFilter[1]))
    })

    self.postMessage({ type: 'results', results, count: results.length })
  }
}
