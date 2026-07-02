'use client'
import { useState, useEffect } from 'react'

type Props = {
  vendor: any
  showToast: (msg: string) => void
  // Report builders live in page.tsx (shared with the Sales tab). Passed in so
  // the Daily/Period reports can live here under Reports without duplicating the
  // HTML generators. Absent → the Daily Report sub-tab is hidden.
  reportTools?: {
    runDailyReport: (date: string) => void
    runWhatsAppDaily: (date: string) => void
    openPeriodReport: (from?: string, to?: string) => void
    dailyReportLoading: boolean
    periodReportLoading: boolean
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReorderProduct {
  id: string
  sku: string
  name: string
  quantity: number
  min_stock_level: number
  cost: number
  category: string
  sold_30d: number
  suggested_qty: number
}

interface GPSummary {
  revenue: number
  cogs: number
  gross_profit: number
  gp_percent: number
  sale_count: number
  avg_sale: number
  cash_revenue: number
  card_revenue: number
  bank_revenue: number
  cheque_revenue: number
  period_label: string
}

interface StockValue {
  total_products: number
  total_units: number
  total_cost_value: number
  total_retail_value: number
  potential_gp: number
  potential_gp_percent: number
  top_categories: Array<{ category: string; cost_value: number; units: number }>
}

type SubTab = 'daily' | 'reorder' | 'gp' | 'stock_value' | 'cashflow'
type GPPeriod = 'today' | 'week' | 'month'

function lkToday(): string { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }) }
function lkMonthStart(): string { return lkToday().slice(0, 8) + '01' }

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRs(n: number): string {
  return 'Rs. ' + Math.round(n).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TabReports({ vendor, showToast, reportTools }: Props) {
  const [activeTab, setActiveTab] = useState<SubTab>(reportTools ? 'daily' : 'reorder')

  // ── Daily / Period report state (only used when reportTools is provided) ────
  const [dailyDate, setDailyDate] = useState(lkToday())
  const [periodFrom, setPeriodFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [periodTo, setPeriodTo] = useState(lkToday())

  // ── Reorder state ─────────────────────────────────────────────────────────
  const [reorderProducts, setReorderProducts] = useState<ReorderProduct[]>([])
  const [loadingReorder, setLoadingReorder] = useState(false)
  const [reorderLoaded, setReorderLoaded] = useState(false)

  // ── GP state ──────────────────────────────────────────────────────────────
  const [gpPeriod, setGpPeriod] = useState<GPPeriod>('today')
  const [gpData, setGpData] = useState<GPSummary | null>(null)
  const [loadingGP, setLoadingGP] = useState(false)
  const [gpLoaded, setGpLoaded] = useState(false)

  // ── Stock Value state ─────────────────────────────────────────────────────
  const [stockValue, setStockValue] = useState<StockValue | null>(null)
  const [loadingStock, setLoadingStock] = useState(false)
  const [stockLoaded, setStockLoaded] = useState(false)

  // ── Cash Flow state ───────────────────────────────────────────────────────
  const [cfFrom, setCfFrom] = useState(lkMonthStart())
  const [cfTo, setCfTo] = useState(lkToday())
  const [cfData, setCfData] = useState<any | null>(null)
  const [loadingCF, setLoadingCF] = useState(false)
  const [cfLoaded, setCfLoaded] = useState(false)

  // ── Lazy fetch on sub-tab open ─────────────────────────────────────────────

  useEffect(() => {
    if (activeTab === 'reorder' && !reorderLoaded) {
      fetchReorder()
    }
    if (activeTab === 'gp' && !gpLoaded) {
      fetchGP(gpPeriod)
    }
    if (activeTab === 'stock_value' && !stockLoaded) {
      fetchStockValue()
    }
    if (activeTab === 'cashflow' && !cfLoaded) {
      fetchCashflow()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  async function fetchCashflow() {
    setLoadingCF(true)
    try {
      const res = await fetch(`/api/vendor/reports?type=cashflow&from=${cfFrom}&to=${cfTo}`)
      if (!res.ok) throw new Error('Failed to load cash flow')
      setCfData(await res.json())
      setCfLoaded(true)
    } catch (e: any) {
      showToast(e.message ?? 'Error loading cash flow')
    } finally {
      setLoadingCF(false)
    }
  }

  function exportCashflowCsv() {
    if (!cfData?.ledger) return
    const rows = [['Date', 'Type', 'Reference', 'Method', 'In (Rs.)', 'Out (Rs.)', 'Balance (Rs.)']]
    for (const e of cfData.ledger) rows.push([e.date, e.type, e.ref, e.method, e.in, e.out, e.balance])
    const csv = rows.map(r => r.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `cashflow-${cfFrom}-to-${cfTo}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  useEffect(() => {
    if (activeTab === 'gp') {
      fetchGP(gpPeriod)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpPeriod])

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  async function fetchReorder() {
    setLoadingReorder(true)
    try {
      const res = await fetch('/api/vendor/reports?type=reorder')
      if (!res.ok) throw new Error('Failed to load reorder data')
      const data = await res.json()
      setReorderProducts(data.products ?? [])
      setReorderLoaded(true)
    } catch (e: any) {
      showToast(e.message ?? 'Error loading reorder data')
    } finally {
      setLoadingReorder(false)
    }
  }

  async function fetchGP(period: GPPeriod) {
    setLoadingGP(true)
    try {
      const res = await fetch(`/api/vendor/reports?type=gp&period=${period}`)
      if (!res.ok) throw new Error('Failed to load GP data')
      const data = await res.json()
      setGpData(data)
      setGpLoaded(true)
    } catch (e: any) {
      showToast(e.message ?? 'Error loading GP report')
    } finally {
      setLoadingGP(false)
    }
  }

  async function fetchStockValue() {
    setLoadingStock(true)
    try {
      const res = await fetch('/api/vendor/reports?type=stock_value')
      if (!res.ok) throw new Error('Failed to load stock value data')
      const data = await res.json()
      setStockValue(data)
      setStockLoaded(true)
    } catch (e: any) {
      showToast(e.message ?? 'Error loading stock value')
    } finally {
      setLoadingStock(false)
    }
  }

  // ── Reorder derived values ─────────────────────────────────────────────────

  const criticalCount = reorderProducts.filter(
    p => p.quantity === 0 || p.quantity <= p.min_stock_level / 2
  ).length
  const normalCount = reorderProducts.length - criticalCount

  // ── GP colour helper ───────────────────────────────────────────────────────

  function gpPercentColor(pct: number): string {
    if (pct >= 40) return 'text-emerald-600'
    if (pct >= 20) return 'text-amber-500'
    return 'text-red-500'
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex gap-2 mb-6">
        {(
          [
            ...(reportTools ? [{ key: 'daily' as SubTab, label: '📅 Daily Report' }] : []),
            { key: 'reorder', label: 'Reorder Alerts' },
            { key: 'cashflow', label: 'Cash Flow' },
            { key: 'gp', label: 'GP Report' },
            { key: 'stock_value', label: 'Stock Value' },
          ] as { key: SubTab; label: string }[]
        ).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
              activeTab === key
                ? 'bg-orange-500 border-orange-500 text-white'
                : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Daily / Period Report ───────────────────────────────────────────── */}
      {activeTab === 'daily' && reportTools && (
        <div className="space-y-4 max-w-3xl">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-bold text-sm text-slate-800 mb-1">📅 Daily Report</h3>
            <p className="text-xs text-slate-400 mb-3">Full day (Asia/Colombo) — sales, payments received, cash breakdown & cash reconciliation.</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Date</label>
                <input type="date" value={dailyDate} onChange={e => setDailyDate(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
              </div>
              <button disabled={reportTools.dailyReportLoading} onClick={() => reportTools!.runDailyReport(dailyDate)} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Generate PDF</button>
              <button disabled={reportTools.dailyReportLoading} onClick={() => reportTools!.runWhatsAppDaily(dailyDate)} className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">💬 WhatsApp to Owner</button>
            </div>
            <div className="flex gap-2 mt-3">
              {[{ l: 'Today', d: lkToday() }, { l: 'Yesterday', d: new Date(Date.now() - 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }) }].map(p => (
                <button key={p.l} onClick={() => setDailyDate(p.d)} className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-100">{p.l}</button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h3 className="font-bold text-sm text-slate-800 mb-1">📆 Period Report</h3>
            <p className="text-xs text-slate-400 mb-3">Customer-wise sales breakdown with selectable PDF.</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label>
                <input type="date" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label>
                <input type="date" value={periodTo} onChange={e => setPeriodTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
              </div>
              <button disabled={reportTools.periodReportLoading} onClick={() => reportTools!.openPeriodReport(periodFrom, periodTo)} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">{reportTools.periodReportLoading ? '⏳ Loading…' : '📊 View Report'}</button>
            </div>
            <div className="flex gap-2 mt-3">
              {[{ l: 'Last 7 Days', f: 7 }, { l: 'Last 30 Days', f: 30 }, { l: 'Last 3 Months', f: 90 }].map(p => (
                <button key={p.l} onClick={() => { setPeriodFrom(new Date(Date.now() - p.f * 86400000).toISOString().slice(0, 10)); setPeriodTo(lkToday()) }} className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-100">{p.l}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Cash Flow ───────────────────────────────────────────────────────── */}
      {activeTab === 'cashflow' && (
        <div>
          <div className="flex items-end gap-3 flex-wrap mb-4">
            <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label><input type="date" value={cfFrom} onChange={e => setCfFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
            <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label><input type="date" value={cfTo} onChange={e => setCfTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
            <button onClick={fetchCashflow} disabled={loadingCF} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">{loadingCF ? 'Loading…' : 'View'}</button>
            {cfData?.ledger?.length > 0 && <button onClick={exportCashflowCsv} className="text-sm font-bold text-slate-600 border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50">⬇ CSV</button>}
          </div>
          <p className="text-xs text-slate-400 mb-4">Cash basis — actual money received & paid (not invoice totals). Credit sales count only when collected.</p>

          {loadingCF ? <div className="text-center py-12 text-slate-400">Loading…</div> : cfData && (<>
            <div className={'rounded-xl p-5 mb-4 ' + (cfData.net >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200')}>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Net Cash Movement</p>
              <p className={'text-3xl font-black ' + (cfData.net >= 0 ? 'text-green-700' : 'text-red-600')}>{formatRs(cfData.net)}</p>
              <p className="text-xs text-slate-500 mt-1">Cash drawer only: <span className="font-bold">{formatRs(cfData.cashDrawer.net)}</span> &nbsp;(in {formatRs(cfData.cashDrawer.in)} − out {formatRs(cfData.cashDrawer.out)})</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-green-600 mb-2">Money In — {formatRs(cfData.totalIn)}</p>
                {Object.entries(cfData.inflowByMethod).map(([m, v]: any) => (v as number) > 0 && <div key={m} className="flex justify-between text-sm py-0.5"><span className="capitalize text-slate-500">{m}</span><span className="font-semibold">{formatRs(v)}</span></div>)}
                {cfData.totalIn === 0 && <p className="text-sm text-slate-400">No collections in this period.</p>}
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-red-600 mb-2">Money Out — {formatRs(cfData.totalOut)}</p>
                <div className="flex justify-between text-sm py-0.5"><span className="text-slate-500">Expenses</span><span className="font-semibold">{formatRs(cfData.expensesOut)}</span></div>
                <div className="flex justify-between text-sm py-0.5"><span className="text-slate-500">Supplier payments</span><span className="font-semibold">{formatRs(cfData.supplierOut)}</span></div>
                <div className="flex justify-between text-sm py-0.5"><span className="text-slate-500">Refunds</span><span className="font-semibold">{formatRs(cfData.refundsOut)}</span></div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2 border-b border-slate-100 text-xs font-bold text-slate-500">Transaction Ledger ({cfData.ledger.length})</div>
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-left text-xs text-slate-500"><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2 text-right">In</th><th className="px-3 py-2 text-right">Out</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
                <tbody>{cfData.ledger.map((e: any, i: number) => (<tr key={i} className="border-t border-slate-100"><td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{new Date(e.date).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' })}</td><td className="px-3 py-1.5"><span className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + (e.in > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600')}>{e.type}</span></td><td className="px-3 py-1.5 truncate max-w-[220px]">{e.ref}</td><td className="px-3 py-1.5 text-right text-green-700">{e.in > 0 ? formatRs(e.in) : ''}</td><td className="px-3 py-1.5 text-right text-red-600">{e.out > 0 ? formatRs(e.out) : ''}</td><td className="px-3 py-1.5 text-right font-semibold">{formatRs(e.balance)}</td></tr>))}</tbody>
              </table></div>
              {cfData.ledger.length === 0 && <p className="text-center text-sm text-slate-400 py-8">No cash transactions in this period.</p>}
            </div>
          </>)}
        </div>
      )}

      {/* ── Reorder Alerts ──────────────────────────────────────────────────── */}
      {activeTab === 'reorder' && (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-2xl font-black text-slate-900">Reorder Alerts</h1>
            <button
              onClick={() => { setReorderLoaded(false); fetchReorder() }}
              disabled={loadingReorder}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <span className={loadingReorder ? 'animate-spin inline-block' : 'inline-block'}>🔄</span>
              <span className="text-xs font-semibold">Refresh</span>
            </button>
          </div>

          {loadingReorder ? (
            <Spinner />
          ) : reorderProducts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-14 text-center">
              <div className="text-4xl mb-3">✅</div>
              <p className="text-slate-700 font-bold text-base">All products are above minimum stock levels</p>
              <p className="text-slate-400 text-sm mt-1">No reorder action needed right now.</p>
            </div>
          ) : (
            <>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2 mb-5">
                <span className="inline-block text-sm font-bold px-3 py-1.5 rounded-full bg-red-100 text-red-700">
                  {reorderProducts.length} Products Below Min
                </span>
                {criticalCount > 0 && (
                  <span className="inline-block text-sm font-bold px-3 py-1.5 rounded-full bg-red-600 text-white">
                    {criticalCount} Critical
                  </span>
                )}
                {normalCount > 0 && (
                  <span className="inline-block text-sm font-bold px-3 py-1.5 rounded-full bg-amber-100 text-amber-700">
                    {normalCount} Low Stock
                  </span>
                )}
              </div>

              {/* Table */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Product</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">SKU</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">In Stock</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Min Level</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Deficit</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Sold (30d)</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Suggested Qty</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Cost/Unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reorderProducts.map(p => {
                        const isCritical = p.quantity === 0 || p.quantity <= p.min_stock_level / 2
                        const deficit = p.min_stock_level - p.quantity
                        return (
                          <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3">
                              <p className="font-bold text-slate-800 text-sm leading-tight">{p.name}</p>
                              <p className="text-xs text-slate-400 mt-0.5">{p.category}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                                {p.sku}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={`font-bold text-sm ${p.quantity === 0 ? 'text-red-600' : isCritical ? 'text-amber-600' : 'text-amber-500'}`}>
                                {p.quantity}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-slate-400 font-semibold">
                              {p.min_stock_level}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className="text-red-600 font-bold text-sm">−{deficit}</span>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-slate-600 font-semibold">
                              {p.sold_30d}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className="inline-block text-xs font-bold px-2.5 py-1 rounded-full bg-orange-100 text-orange-700">
                                {p.suggested_qty}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-slate-600 whitespace-nowrap">
                              {formatRs(p.cost)}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── GP Report ───────────────────────────────────────────────────────── */}
      {activeTab === 'gp' && (
        <div>
          <h1 className="text-2xl font-black text-slate-900 mb-5">GP Report</h1>

          {/* Period selector */}
          <div className="flex gap-2 mb-6">
            {(
              [
                { key: 'today', label: 'Today' },
                { key: 'week', label: 'This Week' },
                { key: 'month', label: 'This Month' },
              ] as { key: GPPeriod; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setGpPeriod(key)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors border ${
                  gpPeriod === key
                    ? 'bg-orange-500 border-orange-500 text-white'
                    : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loadingGP ? (
            <Spinner />
          ) : !gpData ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 font-semibold text-sm">No data available.</p>
            </div>
          ) : (
            <>
              {/* 4 summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <KpiCard
                  label="Revenue"
                  value={formatRs(gpData.revenue)}
                  valueClass="text-green-600"
                />
                <KpiCard
                  label="Est. COGS"
                  value={formatRs(gpData.cogs)}
                  valueClass="text-slate-600"
                  sub="Based on current product costs"
                />
                <KpiCard
                  label="Gross Profit"
                  value={formatRs(gpData.gross_profit)}
                  valueClass={gpData.gross_profit >= 0 ? 'text-emerald-600' : 'text-red-500'}
                />
                <KpiCard
                  label="GP %"
                  value={`${(gpData.gp_percent ?? 0).toFixed(1)}%`}
                  valueClass={gpPercentColor(gpData.gp_percent ?? 0)}
                />
              </div>

              {/* Sales breakdown — two columns */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                {/* Left: Sales overview */}
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">Sales Overview</p>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500 font-semibold">Period</span>
                      <span className="text-sm font-bold text-slate-800">{gpData.period_label}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500 font-semibold">Total Sales</span>
                      <span className="text-sm font-bold text-slate-800">{gpData.sale_count.toLocaleString('en-LK')}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-500 font-semibold">Avg. Sale Value</span>
                      <span className="text-sm font-bold text-slate-800">{formatRs(gpData.avg_sale)}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Revenue by payment method */}
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">Revenue by Payment Method</p>
                  <div className="space-y-2.5">
                    {gpData.cash_revenue > 0 && (
                      <PayMethodRow label="Cash" amount={gpData.cash_revenue} colorClass="bg-emerald-500" />
                    )}
                    {gpData.card_revenue > 0 && (
                      <PayMethodRow label="Card" amount={gpData.card_revenue} colorClass="bg-blue-500" />
                    )}
                    {gpData.bank_revenue > 0 && (
                      <PayMethodRow label="Bank Transfer" amount={gpData.bank_revenue} colorClass="bg-violet-500" />
                    )}
                    {gpData.cheque_revenue > 0 && (
                      <PayMethodRow label="Cheque" amount={gpData.cheque_revenue} colorClass="bg-slate-400" />
                    )}
                    {gpData.cash_revenue === 0 &&
                      gpData.card_revenue === 0 &&
                      gpData.bank_revenue === 0 &&
                      gpData.cheque_revenue === 0 && (
                        <p className="text-xs text-slate-400">No payment data for this period.</p>
                      )}
                  </div>
                </div>
              </div>

              {/* Disclaimer */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <p className="text-xs text-amber-700 font-semibold">
                  ⚠️ COGS calculated using current product cost prices, not historical cost at time of sale. GP figures are estimates.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Stock Value ──────────────────────────────────────────────────────── */}
      {activeTab === 'stock_value' && (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-2xl font-black text-slate-900">Stock Value</h1>
            <button
              onClick={() => { setStockLoaded(false); fetchStockValue() }}
              disabled={loadingStock}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-40"
              title="Refresh"
            >
              <span className={loadingStock ? 'animate-spin inline-block' : 'inline-block'}>🔄</span>
              <span className="text-xs font-semibold">Refresh</span>
            </button>
          </div>

          {loadingStock ? (
            <Spinner />
          ) : !stockValue ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 font-semibold text-sm">No stock data available.</p>
            </div>
          ) : (
            <>
              {/* 4 KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <KpiCard
                  label="Total Active Products"
                  value={stockValue.total_products.toLocaleString('en-LK')}
                  valueClass="text-slate-800"
                />
                <KpiCard
                  label="Total Stock Units"
                  value={stockValue.total_units.toLocaleString('en-LK')}
                  valueClass="text-slate-800"
                />
                <KpiCard
                  label="Cost Value"
                  value={formatRs(stockValue.total_cost_value)}
                  valueClass="text-violet-600"
                />
                <KpiCard
                  label="Retail Value"
                  value={formatRs(stockValue.total_retail_value)}
                  valueClass="text-blue-600"
                />
              </div>

              {/* Potential GP — full-width card */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 mb-4">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Potential Gross Profit</p>
                <p className="text-3xl font-black text-orange-500 mb-1">{formatRs(stockValue.potential_gp)}</p>
                <p className="text-sm font-bold text-orange-400 mb-2">
                  {(stockValue.potential_gp_percent ?? 0).toFixed(1)}% potential margin
                </p>
                <p className="text-xs text-slate-400">
                  Difference between retail value and cost value of current stock
                </p>
              </div>

              {/* Top Categories */}
              {stockValue.top_categories.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100">
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">Top Categories by Cost Value</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Category</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Units</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Cost Value</th>
                          <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide min-w-[140px]">% of Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockValue.top_categories.map(cat => {
                          const pct =
                            stockValue.total_cost_value > 0
                              ? (cat.cost_value / stockValue.total_cost_value) * 100
                              : 0
                          return (
                            <tr key={cat.category} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3 font-semibold text-slate-700">{cat.category}</td>
                              <td className="px-4 py-3 text-right text-slate-600">{cat.units.toLocaleString('en-LK')}</td>
                              <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">
                                {formatRs(cat.cost_value)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-orange-400 rounded-full"
                                      style={{ width: `${Math.min(pct, 100)}%` }}
                                    />
                                  </div>
                                  <span className="text-xs font-bold text-slate-500 w-10 text-right">
                                    {pct.toFixed(1)}%
                                  </span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string
  value: string
  valueClass: string
  sub?: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-2">{label}</p>
      <p className={`text-2xl font-black leading-tight ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1">{sub}</p>}
    </div>
  )
}

function PayMethodRow({
  label,
  amount,
  colorClass,
}: {
  label: string
  amount: number
  colorClass: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${colorClass}`} />
        <span className="text-sm text-slate-600 font-semibold">{label}</span>
      </div>
      <span className="text-sm font-bold text-slate-800 whitespace-nowrap">{formatRs(amount)}</span>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
    </div>
  )
}
