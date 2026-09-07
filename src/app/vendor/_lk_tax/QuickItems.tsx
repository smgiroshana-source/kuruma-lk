'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Money-in quick items — WHEEL MART
//
// Which parts are one-tap chips in "Money in — no invoice" is a till setting,
// not a catalogue fact, so it lives on its own page instead of as a button on
// every one of 449 product rows (owner, 2026-09-07). The page also edits the
// price in place, because a chip with no price opens with a blank amount and
// the missing prices were the other half of the problem.
//
// Data: products.show_in_money_in. Everything here goes through the ordinary
// products 'update' action — nothing new on the server.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useMemo, useState } from 'react'

type Props = {
  vendor: any
  showToast: (msg: string) => void
  onBack: () => void
}

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

export default function QuickItems({ vendor, showToast, onBack }: Props) {
  const [products, setProducts] = useState<any[] | null>(null)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  // price drafts keyed by product id — typed, saved on blur or Enter
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  async function load() {
    try {
      const r = await fetch('/api/vendor/data')
      const j = await r.json()
      setProducts(j.products || [])
    } catch { setProducts([]); showToast('Could not load products') }
  }
  useEffect(() => { load() }, [])

  const chips = useMemo(() => (products || [])
    .filter(p => p.show_in_money_in)
    .sort((a, b) => (a.product_type === b.product_type ? String(a.name).localeCompare(String(b.name)) : a.product_type === 'consumable' ? -1 : 1)), [products])

  const q = search.trim().toLowerCase()
  const hits = useMemo(() => q.length < 2 ? [] : (products || [])
    .filter(p => !p.show_in_money_in && p.is_active !== false && ((p.name || '').toLowerCase().includes(q) || (p.sku || '').toLowerCase().includes(q)))
    .slice(0, 8), [products, q])

  async function update(p: any, data: any, done: string) {
    setBusy(p.id)
    try {
      const r = await fetch('/api/vendor/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', productId: p.id, data }),
      })
      const j = await r.json()
      if (!j.success) throw new Error(j.error || 'Failed')
      // Patch locally so the page answers at once; the next load reconciles.
      setProducts(prev => (prev || []).map(x => x.id === p.id ? { ...x, ...data } : x))
      showToast(done)
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusy(null)
  }

  function savePrice(p: any) {
    const raw = drafts[p.id]
    if (raw === undefined) return
    const v = raw.trim() === '' ? null : Math.max(0, Math.round(Number(raw)))
    if (raw.trim() !== '' && !Number.isFinite(v as number)) { showToast('Price must be a number'); return }
    if ((v ?? null) === (p.price ?? null)) { setDrafts(d => { const n = { ...d }; delete n[p.id]; return n }); return }
    update(p, { price: v }, v == null ? `${p.name}: price cleared — chip will ask for the amount` : `${p.name}: ${rs(v)}`)
    setDrafts(d => { const n = { ...d }; delete n[p.id]; return n })
  }

  const noPrice = chips.filter(p => !(Number(p.price) > 0)).length

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={onBack} className="text-sm font-bold text-slate-500 hover:text-slate-800">← Products</button>
        <h1 className="text-2xl font-black text-slate-900 flex-1">💵 Money-in quick items</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4 max-w-2xl">
        These parts show as one-tap chips in <strong>Money in — no invoice</strong> (Cash &amp; Expenses). Tapping a chip adds the part with its price and takes the piece off stock.
        Labour chips (air fill, tyre change, wheel change, tube fitting) are fixed and need no stock.
      </p>

      {/* Add a part */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 relative">
        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wide block mb-1">Add a part as a chip</label>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or SKU — e.g. flap, cable tie, valve"
          className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-emerald-400" />
        {q.length >= 2 && (
          <div className="absolute left-4 right-4 top-full -mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 overflow-hidden">
            {hits.length === 0 && <p className="px-3 py-2.5 text-xs text-slate-400">No product matches, or it is already a chip.</p>}
            {hits.map(p => (
              <button key={p.id} disabled={busy === p.id}
                onClick={() => { update(p, { show_in_money_in: true }, `${p.name} added as a chip`); setSearch('') }}
                className="w-full text-left px-3 py-2 border-b border-slate-100 hover:bg-emerald-50 flex items-center gap-3 disabled:opacity-50">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-800 truncate">{p.name}</span>
                  <span className="block text-[10px] font-mono text-slate-400">{p.sku}{p.product_type === 'consumable' ? ' · loose count' : ''}</span>
                </span>
                <span className="text-xs text-slate-500 shrink-0">{p.quantity ?? 0} in stock</span>
                <span className="text-xs font-black text-orange-600 shrink-0 w-20 text-right">{Number(p.price) > 0 ? rs(p.price) : 'Ask'}</span>
                <span className="text-[11px] font-bold text-emerald-700 shrink-0">+ Add</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Current chips */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
          <h3 className="font-bold text-sm text-slate-800">Chips · {chips.length}</h3>
          {noPrice > 0 && (
            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              {noPrice} without a price — staff type the amount each time. Set it here.
            </span>
          )}
        </div>
        {products === null ? (
          <p className="p-6 text-sm text-slate-400 text-center">Loading…</p>
        ) : chips.length === 0 ? (
          <p className="p-6 text-sm text-slate-400 text-center">No chips yet. Search above to add one.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                  <th className="px-4 py-2.5 text-left">Part</th>
                  <th className="px-4 py-2.5 text-left">SKU</th>
                  <th className="px-4 py-2.5 text-right">Stock</th>
                  <th className="px-4 py-2.5 text-right">Price on the chip</th>
                  <th className="px-4 py-2.5 text-right">Cost</th>
                  <th className="px-4 py-2.5 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {chips.map(p => {
                  const draft = drafts[p.id]
                  const shown = draft !== undefined ? draft : (Number(p.price) > 0 ? String(Math.round(Number(p.price))) : '')
                  return (
                    <tr key={p.id} className="border-b border-slate-100">
                      <td className="px-4 py-2.5">
                        <div className="font-semibold text-slate-800">{p.name}</div>
                        {p.product_type === 'consumable' && <div className="text-[10px] text-amber-700 font-bold">loose count — sells even at 0</div>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{p.sku}</td>
                      <td className={`px-4 py-2.5 text-right font-semibold ${(p.quantity ?? 0) <= 0 && p.product_type !== 'consumable' ? 'text-red-500' : 'text-slate-700'}`}>{p.quantity ?? 0}</td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <span className="text-xs text-slate-400">Rs.</span>
                          <input type="number" min={0} inputMode="numeric" value={shown} placeholder="Ask"
                            disabled={busy === p.id}
                            onChange={e => setDrafts(d => ({ ...d, [p.id]: e.target.value }))}
                            onBlur={() => savePrice(p)}
                            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDrafts(d => { const n = { ...d }; delete n[p.id]; return n }) }}
                            className={`w-24 px-2 py-1.5 rounded-lg border-2 text-right text-sm font-mono font-bold outline-none focus:border-emerald-400 ${shown === '' ? 'border-orange-300 bg-orange-50' : 'border-slate-200'}`} />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-slate-400">{Number(p.cost) > 0 ? rs(p.cost) : '—'}</td>
                      <td className="px-4 py-2.5 text-right">
                        <button disabled={busy === p.id}
                          onClick={() => update(p, { show_in_money_in: false }, `${p.name} removed from Money-in`)}
                          className="text-[11px] font-bold text-red-500 px-2.5 py-1 rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-50">
                          Remove
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-[11px] text-slate-400 mt-3">Prices here are the product&apos;s selling price — the same one the POS and the store use. Removing a chip does not touch the product.</p>
    </div>
  )
}
