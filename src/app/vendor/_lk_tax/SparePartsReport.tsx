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
import { escapeHtml } from '@/lib/escapeHtml'

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
    const catRows = (cat === 'all' ? cats : cats.filter(c => c.category === cat)).map(c => `<tr>
        <td>${escapeHtml(c.category)}</td><td class="num">${c.units}</td><td class="num">${rs(c.revenue)}</td>
        <td class="num">${c.cost > 0 ? rs(c.cost) : '—'}</td>
        <td class="num">${c.costedRevenue > 0 ? rs(c.profit) + (c.marginPct != null ? ` <span class="sm">(${c.marginPct}%)</span>` : '') : '—'}</td>
        <td class="num">${c.noCostRevenue > 0 ? rs(c.noCostRevenue) : '—'}</td></tr>`).join('')
    const lineRows = rows.map(r => `<tr>
        <td>${escapeHtml(r.date)}</td><td class="mono">${escapeHtml(String(r.invoice))}</td><td class="sm">${escapeHtml(r.category)}</td>
        <td class="mono">${escapeHtml(r.sku)}</td><td>${escapeHtml(r.item)}${r.vehicleNo ? `<div class="sm">${escapeHtml(r.vehicleNo)}</div>` : ''}</td>
        <td>${escapeHtml(r.customer)}${r.workshop ? ' <span class="tag">workshop</span>' : ''}</td>
        <td class="num">${r.qty}</td><td class="num">${rs(r.revenue)}</td>
        <td class="num">${r.cost != null ? rs(r.cost) : '—'}</td>
        <td class="num" style="color:${r.cost == null ? '#b45309' : r.profit >= 0 ? '#15803d' : '#dc2626'}">${r.cost != null ? rs(r.profit) : 'no cost'}</td></tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Spare parts sales ${escapeHtml(from)} to ${escapeHtml(to)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:22px;color:#111}
        h1{font-size:17px;margin:0} .sub{font-size:11px;color:#666}
        h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#555;margin:20px 0 6px;border-bottom:1.5px solid #ddd;padding-bottom:4px}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th,td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left;vertical-align:top}
        th{background:#f4f4f4;font-size:10px;text-transform:uppercase;letter-spacing:.4px}
        .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
        .mono{font-family:ui-monospace,Menlo,monospace;font-size:10px} .sm{font-size:9.5px;color:#777}
        .tot td{font-weight:700;background:#fafafa}
        .tag{font-size:9px;background:#e0f2fe;color:#075985;padding:1px 4px;border-radius:3px}
        .note{font-size:10.5px;color:#555;line-height:1.5;margin:6px 0 10px}
        .foot{margin-top:18px;font-size:9.5px;color:#999;border-top:1px solid #eee;padding-top:8px}
        @media print{@page{size:A4 landscape;margin:10mm}}
      </style></head><body>
      <h1>Spare parts sales — ${escapeHtml(catLabel)}</h1>
      <div class="sub">${escapeHtml(from)} to ${escapeHtml(to)} · ${t.units} unit${t.units !== 1 ? 's' : ''} · ${rs(t.revenue)}</div>
      <h3>By category</h3>
      <table><thead><tr><th>Category</th><th class="num">Units</th><th class="num">Sales</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">Sales with no cost</th></tr></thead>
        <tbody>${catRows}
          <tr class="tot"><td>Total</td><td class="num">${t.units}</td><td class="num">${rs(t.revenue)}</td><td class="num">${t.cost > 0 ? rs(t.cost) : '—'}</td>
          <td class="num">${t.costedRevenue > 0 ? rs(t.profit) + (margin != null ? ` <span class="sm">(${margin}%)</span>` : '') : '—'}</td><td class="num">${t.noCostRevenue > 0 ? rs(t.noCostRevenue) : '—'}</td></tr>
        </tbody></table>
      ${ws.units > 0 ? `<p class="note">Of which to the shop's own workshop (Macforce Auto Engineering): <strong>${ws.units} unit${ws.units !== 1 ? 's' : ''}, ${rs(ws.revenue)}</strong>. Outside customers: ${t.units - ws.units} unit${t.units - ws.units !== 1 ? 's' : ''}, ${rs(t.revenue - ws.revenue)}.</p>` : ''}
      <p class="note">Excludes tyres, tubes &amp; flaps and consumables. Sales are net of ${data.vatRate}% VAT on tax invoices. Returned quantities are left out.
        Parts with no cost recorded (most body parts are not cost-tracked) are shown without a profit and are not in the profit figure.</p>
      <h3>Item by item</h3>
      <table><thead><tr><th>Date</th><th>Receipt / invoice</th><th>Category</th><th>Part no.</th><th>Item</th><th>Customer</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead>
        <tbody>${lineRows}</tbody></table>
      <div class="foot">Generated ${escapeHtml(new Date().toLocaleString('en-LK'))} · Internal management report, not a tax document.</div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}</script>
      </body></html>`
    const w = window.open('', '_blank', 'width=1100,height=800')
    if (w) { w.document.write(html); w.document.close() }
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
          {[
            { l: 'Units sold', v: String(t.units) },
            { l: 'Sales', v: rs(t.revenue) },
            { l: 'Profit (parts with a cost)', v: t.costedRevenue > 0 ? rs(t.profit) + (margin != null ? ` · ${margin}%` : '') : '—' },
            { l: 'Sales with no cost', v: t.noCostRevenue > 0 ? rs(t.noCostRevenue) : '—' },
          ].map(c => (
            <div key={c.l} className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">{c.l}</p>
              <p className="font-black text-slate-800">{c.v}</p>
            </div>
          ))}
        </div>
        {ws.units > 0 && (
          <p className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-4">
            Workshop (Macforce Auto Engineering): <strong>{ws.units} unit{ws.units !== 1 ? 's' : ''}, {rs(ws.revenue)}</strong> · outside customers: {t.units - ws.units} unit{t.units - ws.units !== 1 ? 's' : ''}, {rs(t.revenue - ws.revenue)}
          </p>
        )}

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
