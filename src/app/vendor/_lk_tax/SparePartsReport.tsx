'use client'
// ── WHEEL MART ONLY — spare parts sales report (owner, 2026-09-27) ───────────
//
// Every part sold from stock except tyres, tubes & flaps and consumables —
// body parts, lighting, hybrid batteries, suspension… — item by item, with a
// summary by product category and the workshop's own purchases totalled
// apart. Figures come from /api/vendor/reports?type=spare_parts, which follows
// the Profit Report's rules: net of VAT on tax invoices, returns left out,
// and a part with no cost left out of profit rather than counted at cost 0.

import { useState, useCallback, useEffect } from 'react'
import { colomboToday } from '@/lib/dates'
import { sparePartsPdfHtml } from './sparePartsPdf'

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

export default function SparePartsReport({ showToast }: { showToast: (m: string) => void }) {
  const [from, setFrom] = useState(colomboToday().slice(0, 7) + '-01')
  const [to, setTo] = useState(colomboToday())
  const [cat, setCat] = useState('all')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/vendor/reports?type=spare_parts&from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to build the report')
      setData(j)
      if (cat !== 'all' && !(j.byCategory || []).some((c: any) => c.category === cat)) setCat('all')
    } catch (e: any) { showToast('⚠️ ' + e.message); setData(null) }
    setLoading(false)
  }, [from, to, cat, showToast])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [])

  // Everything below follows the category filter, totals included
  const rows: any[] = (data?.rows || []).filter((r: any) => cat === 'all' || r.category === cat)
  const sum = (list: any[]) => {
    const t = { units: 0, revenue: 0, costedRevenue: 0, cost: 0, profit: 0, noCostRevenue: 0 }
    for (const r of list) {
      t.units += r.qty; t.revenue += r.revenue
      if (r.cost != null) { t.costedRevenue += r.revenue; t.cost += r.cost; t.profit += r.profit } else t.noCostRevenue += r.revenue
    }
    return t
  }
  const t = sum(rows)
  const ws = sum(rows.filter(r => r.workshop))
  const margin = t.costedRevenue > 0 ? Math.round((t.profit / t.costedRevenue) * 100) : null
  const cats: any[] = data?.byCategory || []
  const catLabel = cat === 'all' ? 'All spare parts' : cat

  function exportCsv() {
    const head = ['Date', 'Receipt / invoice', 'Category', 'Part no.', 'Item', 'Vehicle', 'Vehicle no.', 'Customer', 'Workshop', 'Qty', 'Price', 'Sales (net)', 'Cost', 'Profit']
    const out = [head, ...rows.map(r => [r.date, r.invoice, r.category, r.sku, r.item, r.vehicle, r.vehicleNo, r.customer, r.workshop ? 'yes' : '', r.qty, r.price, r.revenue, r.cost ?? '', r.profit ?? ''])]
    const csv = out.map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url
    a.download = `spare-parts-${cat === 'all' ? 'all' : cat.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}-to-${to}.csv`
    a.click(); URL.revokeObjectURL(url)
  }

  function printPdf() {
    if (!data) return
    const w = window.open('', '_blank', 'width=900,height=1000')
    if (w) { w.document.write(sparePartsPdfHtml(data, cat)); w.document.close() }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-bold text-sm text-slate-800 mb-1">🔩 Spare parts sales</h3>
      <p className="text-[11px] text-slate-400 mb-3">
        Everything sold from stock except tyres, tubes &amp; flaps and consumables — body parts, lighting, hybrid parts and the rest. Parts with no cost show sales only, never an invented profit.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <button onClick={run} disabled={loading} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">{loading ? 'Loading…' : 'View'}</button>
        {rows.length > 0 && <>
          <button onClick={printPdf} className="text-sm font-bold text-slate-600 border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50">📄 PDF</button>
          <button onClick={exportCsv} className="text-sm font-bold text-slate-600 border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50">⬇ CSV</button>
        </>}
      </div>

      {cats.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {[{ category: 'all', units: data.totals.units }, ...cats].map((c: any) => (
            <button key={c.category} onClick={() => setCat(c.category)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${cat === c.category ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'}`}>
              {c.category === 'all' ? 'All' : c.category} <span className="opacity-60">{c.units}</span>
            </button>
          ))}
        </div>
      )}

      {data && rows.length === 0 && !loading && <p className="text-center text-sm text-slate-400 py-10">No spare parts sold in this period.</p>}

      {rows.length > 0 && (<>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div className="rounded-xl border-2 border-slate-800 px-4 py-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Total sales</p>
            <p className="font-black text-slate-900 text-lg">{rs(t.revenue)}</p>
            <p className="text-[11px] text-slate-400">{t.units} unit{t.units !== 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3">
            <p className="text-[10px] font-bold text-sky-700 uppercase">Macforce Auto Engineering</p>
            <p className="font-black text-slate-900 text-lg">{rs(ws.revenue)}</p>
            <p className="text-[11px] text-slate-500">{ws.units} unit{ws.units !== 1 ? 's' : ''} · workshop</p>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Other customers</p>
            <p className="font-black text-slate-900 text-lg">{rs(t.revenue - ws.revenue)}</p>
            <p className="text-[11px] text-slate-400">{t.units - ws.units} unit{t.units - ws.units !== 1 ? 's' : ''}</p>
          </div>
          <div className="rounded-xl border border-slate-200 px-4 py-3">
            <p className="text-[10px] font-bold text-slate-500 uppercase">Profit (parts with a cost)</p>
            <p className="font-black text-emerald-700 text-lg">{t.costedRevenue > 0 ? rs(t.profit) : '—'}{margin != null && <span className="text-xs font-bold text-slate-400"> {margin}%</span>}</p>
            <p className="text-[11px] text-slate-400">{t.noCostRevenue > 0 ? `${rs(t.noCostRevenue)} sold with no cost` : 'every part has a cost'}</p>
          </div>
        </div>

        {cat === 'all' && cats.length > 1 && (
          <div className="overflow-x-auto mb-4"><table className="w-full text-sm">
            <thead><tr className="bg-slate-50 text-left text-xs text-slate-500">
              <th className="px-3 py-2">Category</th><th className="px-3 py-2 text-right">Units</th><th className="px-3 py-2 text-right">Sales</th>
              <th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th><th className="px-3 py-2 text-right">No-cost sales</th>
            </tr></thead>
            <tbody>{cats.map((c: any) => (
              <tr key={c.category} className="border-t border-slate-100">
                <td className="px-3 py-1.5 font-semibold">{c.category}</td>
                <td className="px-3 py-1.5 text-right">{c.units}</td>
                <td className="px-3 py-1.5 text-right">{rs(c.revenue)}</td>
                <td className="px-3 py-1.5 text-right">{c.cost > 0 ? rs(c.cost) : '—'}</td>
                <td className="px-3 py-1.5 text-right text-emerald-700">{c.costedRevenue > 0 ? rs(c.profit) + (c.marginPct != null ? ` (${c.marginPct}%)` : '') : '—'}</td>
                <td className="px-3 py-1.5 text-right text-amber-700">{c.noCostRevenue > 0 ? rs(c.noCostRevenue) : '—'}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}

        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-xs text-slate-500">
            <th className="px-3 py-2">Date</th><th className="px-3 py-2">Receipt / invoice</th><th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Customer</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Sales</th>
            <th className="px-3 py-2 text-right">Cost</th><th className="px-3 py-2 text-right">Profit</th>
          </tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100 align-top">
              <td className="px-3 py-1.5 whitespace-nowrap text-slate-500">{r.date.slice(5)}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{r.invoice}</td>
              <td className="px-3 py-1.5">
                <div className="font-semibold text-slate-800">{r.item}</div>
                <div className="text-[11px] text-slate-400">{[r.sku, r.category].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="px-3 py-1.5">{r.customer}{r.workshop && <span className="ml-1 text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">workshop</span>}</td>
              <td className="px-3 py-1.5 text-right">{r.qty}</td>
              <td className="px-3 py-1.5 text-right font-semibold">{rs(r.revenue)}</td>
              <td className="px-3 py-1.5 text-right">{r.cost != null ? rs(r.cost) : '—'}</td>
              <td className={`px-3 py-1.5 text-right ${r.cost == null ? 'text-amber-600 text-xs' : r.profit >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{r.cost != null ? rs(r.profit) : 'no cost'}</td>
            </tr>))}
          </tbody>
        </table></div>
      </>)}
    </div>
  )
}
