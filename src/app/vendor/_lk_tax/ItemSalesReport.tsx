'use client'
// ── WHEEL MART ONLY — item sales on screen (owner, 2026-09-28) ───────────────
//
// "Every item with qty and sales, on screen": wheel alignment, patches, N2,
// tyres, parts — one row each for a date range, searchable, sortable, CSV.
// Figures from /api/vendor/reports?type=item_sales (src/lib/itemSales.ts):
// returns left out, voided/draft bills are not sales.

import { useState, useCallback, useEffect, useMemo } from 'react'
import { colomboToday } from '@/lib/dates'

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()
type SortKey = 'billed' | 'qty' | 'bills' | 'name'

export default function ItemSalesReport({ showToast }: { showToast: (m: string) => void }) {
  const [from, setFrom] = useState(colomboToday().slice(0, 7) + '-01')
  const [to, setTo] = useState(colomboToday())
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'service' | 'stock'>('all')
  const [sort, setSort] = useState<SortKey>('billed')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/vendor/reports?type=item_sales&from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load item sales')
      setData(j)
    } catch (e: any) { showToast('⚠️ ' + e.message); setData(null) }
    setLoading(false)
  }, [from, to, showToast])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { run() }, [])

  const rows: any[] = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const list = (data?.rows || []).filter((r: any) =>
      (kind === 'all' || r.kind === kind) &&
      words.every(w => `${r.name} ${r.sku} ${r.category}`.toLowerCase().includes(w)))
    return [...list].sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : b[sort] - a[sort])
  }, [data, q, kind, sort])

  const t = rows.reduce((s, r) => ({ qty: s.qty + r.qty, billed: s.billed + r.billed, net: s.net + r.net }), { qty: 0, billed: 0, net: 0 })
  // Only a tax-invoice line has VAT in it; show the ex-VAT column when any does
  const showNet = rows.some(r => r.net !== r.billed)
  const filtered = !!q.trim() || kind !== 'all'

  function exportCsv() {
    const head = ['Item', 'Part no.', 'Type', 'Category', 'Qty', 'Bills', 'Sales (Rs.)', 'Sales ex-VAT (Rs.)']
    const out = [head, ...rows.map(r => [r.name, r.sku, r.kind === 'service' ? 'Service' : 'Stock', r.category, r.qty, r.bills, r.billed, r.net])]
    const csv = out.map(r => r.map((c: any) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = `item-sales-${from}-to-${to}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  const th = (key: SortKey, label: string, right = true) => (
    <th className={`px-3 py-2 ${right ? 'text-right' : ''}`}>
      <button onClick={() => setSort(key)} className={`font-bold ${sort === key ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
        {label}{sort === key ? (key === 'name' ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-bold text-sm text-slate-800 mb-1">🧾 Item sales</h3>
      <p className="text-[11px] text-slate-400 mb-3">Every item sold — services like wheel alignment, patches and N2, tyres and parts — with quantity and sales. Returned items are left out.</p>

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <button onClick={run} disabled={loading} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg">{loading ? 'Loading…' : 'View'}</button>
        {rows.length > 0 && <button onClick={exportCsv} className="text-sm font-bold text-slate-600 border border-slate-300 px-4 py-2 rounded-lg hover:bg-slate-50">⬇ CSV</button>}
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search item — e.g. patch, alignment, 185/70"
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
          {([['all', 'All'], ['service', 'Services'], ['stock', 'Stock items']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border ${kind === k ? 'bg-slate-800 border-slate-800 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'}`}>{l}</button>
          ))}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            { l: filtered ? 'Items shown' : 'Different items', v: String(rows.length) },
            { l: 'Quantity', v: t.qty.toLocaleString() },
            { l: 'Sales', v: rs(t.billed) },
          ].map(c => (
            <div key={c.l} className="rounded-xl border border-slate-200 px-4 py-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase">{c.l}</p>
              <p className="font-black text-slate-800 text-lg">{c.v}</p>
            </div>
          ))}
        </div>
      )}

      {data && rows.length === 0 && !loading && <p className="text-center text-sm text-slate-400 py-10">{filtered ? 'No items match.' : 'No sales in this period.'}</p>}

      {rows.length > 0 && (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="bg-slate-50 text-left text-xs">
            {th('name', 'Item', false)}{th('qty', 'Qty')}{th('bills', 'Bills')}{th('billed', 'Sales')}
            {showNet && <th className="px-3 py-2 text-right font-bold text-slate-500">Ex-VAT</th>}
          </tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.key} className="border-t border-slate-100">
              <td className="px-3 py-1.5">
                <div className="font-semibold text-slate-800">{r.name}</div>
                <div className="text-[11px] text-slate-400">
                  <span className={`font-bold ${r.kind === 'service' ? 'text-violet-600' : 'text-slate-500'}`}>{r.kind === 'service' ? 'Service' : 'Stock'}</span>
                  {r.sku && ` · ${r.sku}`}{r.kind === 'stock' && ` · ${r.category}`}
                </div>
              </td>
              <td className="px-3 py-1.5 text-right font-bold">{r.qty.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right text-slate-500">{r.bills}</td>
              <td className="px-3 py-1.5 text-right font-semibold">{rs(r.billed)}</td>
              {showNet && <td className="px-3 py-1.5 text-right text-slate-500">{r.net !== r.billed ? rs(r.net) : ''}</td>}
            </tr>))}
            <tr className="border-t-2 border-slate-800 font-black bg-slate-50">
              <td className="px-3 py-2">Total{filtered ? ' (shown)' : ''}</td>
              <td className="px-3 py-2 text-right">{t.qty.toLocaleString()}</td>
              <td className="px-3 py-2"></td>
              <td className="px-3 py-2 text-right">{rs(t.billed)}</td>
              {showNet && <td className="px-3 py-2 text-right">{rs(t.net)}</td>}
            </tr>
          </tbody>
        </table></div>
      )}
      {showNet && <p className="text-[11px] text-slate-400 mt-2">Sales = what customers paid. Ex-VAT takes the {data?.vatRate}% VAT out of tax-invoice lines — the figure the Profit Report uses.</p>}
    </div>
  )
}
