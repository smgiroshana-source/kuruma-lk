'use client'
// ── SAKURA ONLY — What sells · what to order · what to clear ─────────────────
// Owner, 2026-11-13. Every part grouped by vehicle × part type (src/lib/demand.ts)
// against the last 180 days of sales, today's shelf and the storefront's
// searches. Three lists for the Japan order, each downloadable to Excel. Runs
// only when asked (one server call), so it costs nothing on a normal visit.

import { useMemo, useState } from 'react'
import { downloadXlsx } from '@/lib/xlsx'
import type { DemandReport as Report, DemandGroup } from '@/lib/demand'

type View = 'order' | 'dont' | 'clear' | 'all'

const rs = (n: number) => 'Rs.' + Math.round(n || 0).toLocaleString()
const cover = (g: DemandGroup) => g.coverMonths === null ? (g.inStock > 0 ? 'no sales' : '—') : g.coverMonths >= 99 ? '99+ mo' : `${g.coverMonths} mo`
const shortDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short' }) : '—'

export default function DemandReport({ showToast }: { showToast: (m: string) => void }) {
  const [data, setData] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<View>('order')
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(100)

  async function run() {
    setLoading(true)
    try {
      const r = await fetch('/api/vendor/reports?type=demand')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not build the report')
      setData(j); setShown(100)
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setLoading(false)
  }

  const byKey = useMemo(() => new Map((data?.groups || []).map(g => [g.key, g])), [data])
  const match = (s: string) => !q.trim() || s.toLowerCase().includes(q.trim().toLowerCase())
  const groupsFor = (v: View): DemandGroup[] => {
    if (!data) return []
    const keys = v === 'order' ? data.orderMore : v === 'dont' ? data.dontOrder : null
    const list = keys ? keys.map(k => byKey.get(k)!).filter(Boolean) : data.groups
    return list.filter(g => match(`${g.vehicle} ${g.type} ${g.codes.join(' ')}`))
  }
  const groups = useMemo(() => groupsFor(view), [data, view, q])          // eslint-disable-line react-hooks/exhaustive-deps
  const clearItems = useMemo(() => (data?.clearOut.items || []).filter(i => match(`${i.vehicle} ${i.type} ${i.name} ${i.sku}`)), [data, q]) // eslint-disable-line react-hooks/exhaustive-deps

  function exportExcel() {
    if (!data) return
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
    if (view === 'clear') {
      downloadXlsx({
        name: 'Clear out',
        title: ['Sakura — Clear out', `On the shelf ${data.rules.slowDays}+ days, nothing of the same type sold in ${data.rules.windowDays} days · ${day}`],
        header: ['Part ID', 'Part', 'Vehicle', 'Part type', 'Days on shelf', 'Qty'],
        rows: clearItems.map(i => [i.sku, i.name, i.vehicle, i.type, i.days, i.quantity]),
        widths: [10, 50, 24, 26, 12, 6],
      }, `Sakura clear out ${day}.xlsx`)
      return
    }
    const label = view === 'order' ? 'Order more' : view === 'dont' ? "Don't order" : 'All parts'
    downloadXlsx({
      name: label,
      title: [`Sakura — ${label}`, `Sales ${data.rules.windowDays} days, searches ${data.rules.recentDays} days · ${day}`],
      header: ['Vehicle', 'Part type', 'Model codes', `Sold ${data.rules.recentDays}d`, `Sold ${data.rules.windowDays}d`, 'Sales Rs.', 'In stock', 'Months of stock', 'Median days to sell', 'Searched', 'Searched, not found', 'Last sold', 'Example'],
      rows: groups.map(g => [g.vehicle, g.type, g.codes.join(' / '), g.soldRecent, g.soldWindow, g.revenue, g.inStock,
        g.coverMonths === null ? '' : g.coverMonths, g.medianDays ?? '', g.searches, g.notFound, g.lastSold ? g.lastSold.slice(0, 10) : '', g.examples[0] || '']),
      widths: [22, 26, 18, 9, 9, 12, 9, 10, 10, 9, 10, 11, 44],
    }, `Sakura ${label.toLowerCase()} ${day}.xlsx`)
  }

  const tabs: { v: View; l: string; n: number; tone: string }[] = data ? [
    { v: 'order', l: '🟢 Order more', n: data.orderMore.length, tone: 'emerald' },
    { v: 'dont', l: "🔴 Don't order", n: data.dontOrder.length, tone: 'red' },
    { v: 'clear', l: '🟠 Clear out', n: data.clearOut.count, tone: 'amber' },
    { v: 'all', l: 'All parts', n: data.groups.length, tone: 'slate' },
  ] : []

  const HELP: Record<View, string> = data ? {
    order: `Sold at least twice in ${data.rules.windowDays} days with under ${data.rules.orderCoverMonths} months of stock left — or none on the shelf and searched for ${3}+ times without a result. Most wanted first.`,
    dont: `3 or more on the shelf and either nothing sold in ${data.rules.windowDays} days or ${data.rules.dontOrderCoverMonths}+ months of stock at the current pace.`,
    clear: `Items on the shelf ${data.rules.slowDays}+ days whose part type (same vehicle) hasn't sold in ${data.rules.windowDays} days — candidates for a price, a push or a WhatsApp offer. Oldest first.`,
    all: 'Every vehicle × part type with sales, stock or searches. Highest sales first.',
  } : { order: '', dont: '', clear: '', all: '' }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-sm text-slate-800">🧭 What sells · what to order · what to clear</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Parts grouped by vehicle and part type, from the last 180 days of sales, today&apos;s stock and what customers searched for on the website.
          </p>
        </div>
        <div className="flex gap-2">
          {data && <button onClick={exportExcel} className="text-xs font-bold px-3 py-2.5 rounded-lg border-2 border-slate-200 text-slate-600 hover:bg-slate-50">⬇ Excel</button>}
          <button onClick={run} disabled={loading} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">
            {loading ? 'Working it out…' : data ? '↻ Refresh' : '🔍 Build the report'}
          </button>
        </div>
      </div>

      {data && (
        <>
          <p className="text-[11px] text-slate-500 mt-3">
            {data.summary.unitsSold.toLocaleString()} items sold ({rs(data.summary.revenue)}) in {data.rules.windowDays} days · {data.summary.inStockItems.toLocaleString()} items in stock ·
            {' '}{data.summary.searchesMatched.toLocaleString()} of {data.summary.searchesRead.toLocaleString()} website searches matched to a part
          </p>

          <div className="flex gap-1.5 mt-3 flex-wrap">
            {tabs.map(t => (
              <button key={t.v} onClick={() => { setView(t.v); setShown(100) }}
                className={`text-xs font-bold px-3 py-2 rounded-lg border-2 transition ${view === t.v ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {t.l} <span className="opacity-70">{t.n.toLocaleString()}</span>
              </button>
            ))}
            <input value={q} onChange={e => { setQ(e.target.value); setShown(100) }} placeholder="Filter: aqua, headlamp, MH55S…"
              className="ml-auto min-w-0 w-56 px-3 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-orange-400" />
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{HELP[view]}</p>

          {view === 'clear' ? (
            <div className="mt-2 border border-slate-200 rounded-lg overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-[10px] uppercase text-slate-500">
                  <th className="px-2 py-2">Part ID</th><th className="px-2 py-2">Part</th><th className="px-2 py-2">Part type</th><th className="px-2 py-2 text-right">Days on shelf</th><th className="px-2 py-2 text-right">Qty</th>
                </tr></thead>
                <tbody>
                  {clearItems.slice(0, shown).map(i => (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5 font-mono">{i.sku}</td>
                      <td className="px-2 py-1.5">{i.name}</td>
                      <td className="px-2 py-1.5 text-slate-500">{i.type}</td>
                      <td className="px-2 py-1.5 text-right font-bold text-amber-700">{i.days}</td>
                      <td className="px-2 py-1.5 text-right">{i.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.clearOut.count > data.clearOut.items.length && (
                <p className="text-[11px] text-slate-400 p-2">Showing the oldest {data.clearOut.items.length} of {data.clearOut.count.toLocaleString()}.</p>
              )}
            </div>
          ) : (
            <div className="mt-2 border border-slate-200 rounded-lg overflow-x-auto max-h-[560px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0"><tr className="text-left text-[10px] uppercase text-slate-500">
                  <th className="px-2 py-2">Vehicle · part</th>
                  <th className="px-2 py-2 text-right">Sold 90d</th>
                  <th className="px-2 py-2 text-right">Sold 180d</th>
                  <th className="px-2 py-2 text-right">Sales</th>
                  <th className="px-2 py-2 text-right">In stock</th>
                  <th className="px-2 py-2 text-right">Stock lasts</th>
                  <th className="px-2 py-2 text-right" title="Median days from listing to sale">Sells in</th>
                  <th className="px-2 py-2 text-right" title="Website searches in 90 days (found nothing)">Searched</th>
                  <th className="px-2 py-2 text-right">Last sold</th>
                </tr></thead>
                <tbody>
                  {groups.slice(0, shown).map(g => (
                    <tr key={g.key} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5">
                        <p className="font-bold text-slate-800">{g.vehicle} · {g.type}</p>
                        <p className="text-[10px] text-slate-400">{[g.codes.join(' / '), g.examples[0]].filter(Boolean).join(' — ')}</p>
                      </td>
                      <td className="px-2 py-1.5 text-right font-bold">{g.soldRecent || '—'}</td>
                      <td className="px-2 py-1.5 text-right">{g.soldWindow || '—'}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{g.revenue ? rs(g.revenue) : '—'}</td>
                      <td className={`px-2 py-1.5 text-right font-bold ${g.inStock === 0 ? 'text-red-600' : ''}`}>{g.inStock}</td>
                      <td className={`px-2 py-1.5 text-right whitespace-nowrap ${g.coverMonths !== null && g.coverMonths < 2 ? 'text-red-600 font-bold' : g.coverMonths === null || g.coverMonths >= 12 ? 'text-slate-400' : ''}`}>{cover(g)}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{g.medianDays === null ? '—' : `${g.medianDays}d`}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">{g.searches ? <>{g.searches}{g.notFound ? <span className="text-red-600"> ({g.notFound})</span> : ''}</> : '—'}</td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap text-slate-500">{shortDate(g.lastSold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(view === 'clear' ? clearItems.length : groups.length) > shown && (
            <button onClick={() => setShown(s => s + 200)} className="mt-2 text-xs font-bold text-slate-500 hover:text-orange-600">
              Show more — {((view === 'clear' ? clearItems.length : groups.length) - shown).toLocaleString()} left
            </button>
          )}
          <p className="text-[10px] text-slate-400 mt-3">
            Part type is read from the part name; a vehicle with no model on record shows &ldquo;(model not recorded)&rdquo; unless the model is in the name.
            &ldquo;Searched&rdquo; counts website searches for that vehicle + part, or for a part ID — red = the search found nothing.
          </p>
        </>
      )}
    </div>
  )
}
