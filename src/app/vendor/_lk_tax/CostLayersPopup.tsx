'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Cost layers popup — WHEEL MART
//
// products.cost is one number, but the shelf can hold more than one cost at
// once — 2 units left from an earlier purchase at Rs.5,000, 4 just received
// at Rs.6,000. The Products list shows "Rs.5,000–6,000" whenever that's true
// (see hasCostRange in page.tsx); tapping it opens this, the full breakdown,
// oldest first — the exact order a real sale draws from (owner, 2026-09-22).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'

type Layer = { unit_cost: number; quantity_remaining: number; received_at: string }

type Props = {
  product: { id: string; name: string; sku?: string; cost_min?: number; cost_max?: number }
  onClose: () => void
}

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

export default function CostLayersPopup({ product, onClose }: Props) {
  const [layers, setLayers] = useState<Layer[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/vendor/products', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cost_layers', productId: product.id }),
    }).then(r => r.json()).then(j => {
      if (cancelled) return
      if (j.success) setLayers(j.layers)
      else setError(j.error || 'Could not load')
    }).catch(() => { if (!cancelled) setError('Network error') })
    return () => { cancelled = true }
  }, [product.id])

  const totalUnits = (layers || []).reduce((s, l) => s + l.quantity_remaining, 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-[75] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-black text-slate-900 text-base">What's actually on the shelf</h3>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{product.name}{product.sku ? ` · ${product.sku}` : ''}</p>

        {layers === null && !error && <p className="text-sm text-slate-400 py-6 text-center">Loading…</p>}
        {error && <p className="text-sm text-red-500 py-6 text-center">⚠️ {error}</p>}

        {layers && layers.length > 0 && (
          <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
            <div className="grid grid-cols-3 bg-slate-50 border-b border-slate-100 px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
              <span>Received</span><span className="text-right">Units left</span><span className="text-right">Cost each</span>
            </div>
            {layers.map((l, i) => (
              <div key={i} className={'grid grid-cols-3 px-3 py-2.5 text-sm ' + (i === 0 ? 'bg-orange-50/60' : '') + (i > 0 ? ' border-t border-slate-100' : '')}>
                <span className="text-slate-600">{new Date(l.received_at).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })}{i === 0 && <span className="block text-[10px] font-bold text-orange-600">sells next</span>}</span>
                <span className="text-right font-semibold text-slate-700">{l.quantity_remaining}</span>
                <span className="text-right font-black text-slate-900">{rs(l.unit_cost)}</span>
              </div>
            ))}
          </div>
        )}

        {layers && layers.length === 0 && (
          <p className="text-sm text-slate-400 py-6 text-center">No stock on hand — nothing to cost right now.</p>
        )}

        <p className="text-[11px] text-slate-400 mt-3">
          {totalUnits} unit{totalUnits !== 1 ? 's' : ''} on hand across {(layers || []).length} purchase{(layers || []).length !== 1 ? 's' : ''}, oldest first — the same order a sale draws from.
          The list shows <strong>{rs(product.cost_min)}</strong>, the cost of the unit that sells next. As those sell and each layer runs out, that figure moves up toward <strong>{rs(product.cost_max)}</strong>.
        </p>

        <button onClick={onClose} className="w-full mt-4 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">Close</button>
      </div>
    </div>
  )
}
