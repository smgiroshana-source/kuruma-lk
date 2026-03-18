'use client'

import { useState, useEffect } from 'react'

interface AnalyticsData {
  topQueries: { query: string; count: number; avg_results: number }[]
  topCategories: { category: string; count: number }[]
  topMakes: { make_filter: string; count: number }[]
  dailyVolume: { date: string; count: number }[]
  zeroResults: { query: string; count: number }[]
  totalSearches: number
  days: number
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)

  useEffect(() => {
    fetchData()
  }, [days])

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/analytics?days=${days}`)
      if (res.status === 403) { window.location.href = '/login'; return }
      if (res.ok) setData(await res.json())
    } catch {
      // Network error
    }
    setLoading(false)
  }

  async function handleSignOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-slate-400 text-lg font-semibold">Loading analytics...</div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-red-500 text-lg font-semibold">Failed to load analytics data</div>
      </div>
    )
  }

  const avgPerDay = data.days > 0 ? Math.round(data.totalSearches / data.days) : 0
  const zeroResultTotal = data.zeroResults.reduce((sum, r) => sum + r.count, 0)
  const zeroRate = data.totalSearches > 0 ? Math.round((zeroResultTotal / data.totalSearches) * 100) : 0
  const maxDaily = Math.max(...data.dailyVolume.map(d => d.count), 1)
  const maxQueryCount = Math.max(...data.topQueries.map(q => q.count), 1)
  const maxCategoryCount = Math.max(...data.topCategories.map(c => c.count), 1)
  const maxMakeCount = Math.max(...data.topMakes.map(m => m.count), 1)

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xl font-black text-orange-500">kuruma.lk</a>
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">SUPER ADMIN</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/admin" className="text-sm text-slate-400 hover:text-slate-600">Dashboard</a>
            <a href="/" className="text-sm text-slate-400 hover:text-slate-600">View Store</a>
            <button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-600 font-semibold">Log Out</button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Title + Period Selector */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-black text-slate-900">Search Analytics</h1>
          <div className="flex gap-1 bg-white rounded-lg border border-slate-200 p-1">
            {[7, 30, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-sm font-semibold rounded-md transition ${days === d ? 'bg-orange-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <SummaryCard label="Total Searches" value={data.totalSearches.toLocaleString()} />
          <SummaryCard label="Avg / Day" value={avgPerDay.toLocaleString()} />
          <SummaryCard label="Unique Terms" value={data.topQueries.length.toString()} />
          <SummaryCard label="Zero-Result Rate" value={`${zeroRate}%`} accent={zeroRate > 30} />
        </div>

        {/* Main Content */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Left Column */}
          <div className="space-y-6">
            {/* Top Search Queries */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Top Search Queries</h2>
              {data.topQueries.length === 0 ? (
                <p className="text-slate-400 text-sm">No search data yet</p>
              ) : (
                <div className="space-y-2">
                  {data.topQueries.map((q, i) => (
                    <div key={q.query} className="flex items-center gap-3">
                      <span className="text-xs text-slate-400 w-5 text-right font-mono">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-sm font-semibold text-slate-800 truncate">{q.query}</span>
                          {q.avg_results === 0 && (
                            <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">0 results</span>
                          )}
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-orange-400 rounded-full" style={{ width: `${(q.count / maxQueryCount) * 100}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-slate-500 font-mono whitespace-nowrap">{q.count}x</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Zero-Result Searches */}
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
              <h2 className="text-lg font-bold text-amber-900 mb-1">Zero-Result Searches</h2>
              <p className="text-xs text-amber-600 mb-4">Users searched for these but found nothing — potential demand signals</p>
              {data.zeroResults.length === 0 ? (
                <p className="text-amber-500 text-sm">No zero-result searches</p>
              ) : (
                <div className="space-y-1.5">
                  {data.zeroResults.map(q => (
                    <div key={q.query} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-amber-900">{q.query}</span>
                      <span className="text-xs text-amber-600 font-mono">{q.count}x</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Search Volume */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Search Volume</h2>
              {data.dailyVolume.length === 0 ? (
                <p className="text-slate-400 text-sm">No data yet</p>
              ) : (
                <div className="space-y-1">
                  {data.dailyVolume.slice(-14).map(d => (
                    <div key={d.date} className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-mono w-16 shrink-0">
                        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                        <div className="h-full bg-orange-400 rounded" style={{ width: `${(d.count / maxDaily) * 100}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-500 font-mono w-6 text-right">{d.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Popular Categories */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Popular Categories</h2>
              {data.topCategories.length === 0 ? (
                <p className="text-slate-400 text-sm">No category filter usage yet</p>
              ) : (
                <div className="space-y-2">
                  {data.topCategories.map(c => (
                    <div key={c.category} className="flex items-center gap-2">
                      <span className="text-sm text-slate-700 w-40 truncate shrink-0">{c.category}</span>
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 rounded-full" style={{ width: `${(c.count / maxCategoryCount) * 100}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 font-mono w-6 text-right">{c.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Popular Makes */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h2 className="text-lg font-bold text-slate-900 mb-4">Popular Makes</h2>
              {data.topMakes.length === 0 ? (
                <p className="text-slate-400 text-sm">No make filter usage yet</p>
              ) : (
                <div className="space-y-2">
                  {data.topMakes.map(m => (
                    <div key={m.make_filter} className="flex items-center gap-2">
                      <span className="text-sm text-slate-700 w-32 truncate shrink-0">{m.make_filter}</span>
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${(m.count / maxMakeCount) * 100}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 font-mono w-6 text-right">{m.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${accent ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
      <div className="text-xs text-slate-500 font-semibold mb-1">{label}</div>
      <div className={`text-2xl font-black ${accent ? 'text-amber-600' : 'text-slate-900'}`}>{value}</div>
    </div>
  )
}
