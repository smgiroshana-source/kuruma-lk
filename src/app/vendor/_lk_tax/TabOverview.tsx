'use client'

type Props = {
  vendor: any
  stats: {
    totalProducts: number
    activeProducts: number
    totalStock: number
    stockValue: number
    totalSales: number
  }
  products: any[]
  vendorSettings: any
  onNavigate: (tab: string) => void
  showToast: (msg: string) => void
}

function formatRs(amount: number): string {
  return 'Rs.' + amount.toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

function getGreeting(): string {
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false })
  const h = parseInt(hour, 10)
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-LK', {
    timeZone: 'Asia/Colombo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export default function TabOverview({ vendor, stats, products, vendorSettings, onNavigate }: Props) {
  // Low stock: products where min_stock_level > 0 AND quantity <= min_stock_level
  const lowStockItems = products.filter(
    (p: any) =>
      typeof p.min_stock_level === 'number' &&
      p.min_stock_level > 0 &&
      p.quantity <= p.min_stock_level
  )

  const displayedLowStock = lowStockItems.slice(0, 5)
  const extraLowStock = lowStockItems.length - displayedLowStock.length

  function lowStockBadge(p: any) {
    if (p.quantity === 0) {
      return (
        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
          OUT
        </span>
      )
    }
    if (p.quantity <= Math.floor(p.min_stock_level / 2)) {
      return (
        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">
          Critical
        </span>
      )
    }
    return (
      <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
        Low
      </span>
    )
  }

  return (
    <div>
      {/* ── Greeting + date bar ───────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            {getGreeting()},{' '}
            <span className="text-orange-500">{vendor.name}</span>
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{getTodayLabel()}</p>
        </div>
        <span className="self-start sm:self-auto inline-block bg-orange-50 border border-orange-200 text-orange-600 text-xs font-black px-3 py-1 rounded-full tracking-wide">
          WHEEL MART
        </span>
      </div>

      {/* ── 5 KPI cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
        {/* Total Products */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1">
          <p className="text-2xl font-black text-orange-500">{stats.totalProducts.toLocaleString()}</p>
          <p className="text-xs font-semibold text-slate-400">Total Products</p>
          <div className="mt-auto pt-2">
            <span className="inline-block w-6 h-1 rounded-full bg-orange-400" />
          </div>
        </div>

        {/* Active Products */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1">
          <p className="text-2xl font-black text-emerald-500">{stats.activeProducts.toLocaleString()}</p>
          <p className="text-xs font-semibold text-slate-400">Active Products</p>
          <div className="mt-auto pt-2">
            <span className="inline-block w-6 h-1 rounded-full bg-emerald-400" />
          </div>
        </div>

        {/* Total Stock Units */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1">
          <p className="text-2xl font-black text-blue-500">{stats.totalStock.toLocaleString()}</p>
          <p className="text-xs font-semibold text-slate-400">Stock Units</p>
          <div className="mt-auto pt-2">
            <span className="inline-block w-6 h-1 rounded-full bg-blue-400" />
          </div>
        </div>

        {/* Stock Value */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1">
          <p className="text-xl font-black text-violet-500 leading-tight">{formatRs(stats.stockValue)}</p>
          <p className="text-xs font-semibold text-slate-400">Stock Value</p>
          <div className="mt-auto pt-2">
            <span className="inline-block w-6 h-1 rounded-full bg-violet-400" />
          </div>
        </div>

        {/* Total Sales */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col gap-1 col-span-2 sm:col-span-1">
          <p className="text-xl font-black text-green-600 leading-tight">{formatRs(stats.totalSales)}</p>
          <p className="text-xs font-semibold text-slate-400">Total Sales</p>
          <div className="mt-auto pt-2">
            <span className="inline-block w-6 h-1 rounded-full bg-green-500" />
          </div>
        </div>
      </div>

      {/* ── Low Stock Alerts (conditional) ──────────────────────────────────── */}
      {lowStockItems.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-amber-300 p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <span>⚠️</span>
              <span>Low Stock Alert</span>
              <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full">
                {lowStockItems.length}
              </span>
            </h3>
            <button
              onClick={() => onNavigate('products')}
              className="text-xs font-semibold text-orange-500 hover:text-orange-600 transition-colors"
            >
              View all →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100">
                  <th className="pb-2 pr-4 text-xs font-bold text-slate-400">Product</th>
                  <th className="pb-2 pr-4 text-xs font-bold text-slate-400">SKU</th>
                  <th className="pb-2 pr-4 text-xs font-bold text-slate-400 text-right">Stock</th>
                  <th className="pb-2 pr-4 text-xs font-bold text-slate-400 text-right">Min</th>
                  <th className="pb-2 text-xs font-bold text-slate-400">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayedLowStock.map((p: any) => (
                  <tr key={p.id} className="border-t border-slate-50">
                    <td className="py-2 pr-4 font-semibold text-slate-800 text-xs max-w-[160px] truncate">
                      {p.name}
                    </td>
                    <td className="py-2 pr-4">
                      <span className="font-mono text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                        {p.sku}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right font-bold text-xs text-red-600">
                      {p.quantity}
                    </td>
                    <td className="py-2 pr-4 text-right text-xs text-slate-400">
                      {p.min_stock_level}
                    </td>
                    <td className="py-2">{lowStockBadge(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {extraLowStock > 0 && (
            <button
              onClick={() => onNavigate('products')}
              className="mt-3 text-xs font-semibold text-slate-400 hover:text-orange-500 transition-colors"
            >
              + {extraLowStock} more item{extraLowStock !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}

      {/* ── Quick Actions 2×2 grid ───────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-slate-900 mb-4 text-sm">Quick Actions</h3>
        <div className="grid grid-cols-2 gap-3">
          {/* Open POS */}
          <button
            onClick={() => onNavigate('pos')}
            className="flex items-center gap-3 px-4 py-4 rounded-xl bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-bold text-sm transition-colors shadow-sm"
          >
            <span className="text-xl leading-none">🛒</span>
            <span>Open POS</span>
          </button>

          {/* Receive Stock */}
          <button
            onClick={() => onNavigate('stocktake')}
            className="flex items-center gap-3 px-4 py-4 rounded-xl bg-slate-800 hover:bg-slate-900 active:bg-slate-950 text-white font-bold text-sm transition-colors shadow-sm"
          >
            <span className="text-xl leading-none">📥</span>
            <span>Receive Stock</span>
          </button>

          {/* Record Payment */}
          <button
            onClick={() => onNavigate('sales')}
            className="flex items-center gap-3 px-4 py-4 rounded-xl bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white font-bold text-sm transition-colors shadow-sm"
          >
            <span className="text-xl leading-none">💰</span>
            <span>Record Payment</span>
          </button>

          {/* Add Product */}
          <button
            onClick={() => onNavigate('add')}
            className="flex items-center gap-3 px-4 py-4 rounded-xl bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white font-bold text-sm transition-colors shadow-sm"
          >
            <span className="text-xl leading-none">➕</span>
            <span>Add Product</span>
          </button>
        </div>
      </div>
    </div>
  )
}
