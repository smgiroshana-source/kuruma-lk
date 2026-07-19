'use client'
import { useState, useEffect } from 'react'
import StockTransfer from '../_shared/StockTransfer'
import DamageCapture from '../_shared/DamageCapture'
import { colomboToday } from '@/lib/dates'

function locLabel(p: any) { return [p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ') }
function confirmedAgo(dateStr: string | null): { label: string; cls: string } | null {
  if (!dateStr) return null
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days === 0) return { label: 'Confirmed today', cls: 'text-emerald-700 bg-emerald-50' }
  if (days <= 7)  return { label: `${days}d ago`, cls: 'text-emerald-600 bg-emerald-50' }
  if (days <= 30) return { label: `${days}d ago`, cls: 'text-amber-700 bg-amber-50' }
  return { label: `${days}d ago`, cls: 'text-red-600 bg-red-50' }
}

interface TabStockStandardProps {
  vendor: any
  products: any[]
  vendorSettings: any
  showToast: (msg: string) => void
  onDataChanged: () => void
}

export default function TabStockStandard({ vendor, products, vendorSettings, showToast, onDataChanged }: TabStockStandardProps) {
  const [stockView, setStockView] = useState<'browse' | 'assign' | 'transfer'>('browse')
  const [stockFilter, setStockFilter] = useState({ store: '', floor: '', sub1: '', sub2: '' })
  const [stocktakeSearch, setStocktakeSearch] = useState('')
  const [stockQtyEdits, setStockQtyEdits] = useState<Record<string, number>>({})
  const [stockConfirmSet, setStockConfirmSet] = useState<Set<string>>(new Set())
  const [stocktakeSaving, setStocktakeSaving] = useState(false)
  // Auto-saved confirmations (no qty change): flushed ~1.5s after the last tap
  // so a counter on a phone never loses work by forgetting the Save button.
  const [savedConfirms, setSavedConfirms] = useState<Set<string>>(new Set())
  const [autoSaveState, setAutoSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  // Damage capture sheet target (product found damaged during the count)
  const [damageProduct, setDamageProduct] = useState<any>(null)

  useEffect(() => {
    const ids = [...stockConfirmSet].filter(id => !(id in stockQtyEdits))
    if (!ids.length) return
    const t = setTimeout(() => flushConfirms(ids), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockConfirmSet, stockQtyEdits])

  async function flushConfirms(ids: string[]) {
    setAutoSaveState('saving')
    const now = new Date().toISOString()
    const results = await Promise.all(ids.map(async id => {
      try {
        const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'update', productId: id, data: { last_stock_confirmed_at: now } }) })
        const j = await r.json()
        return j.success ? id : null
      } catch { return null }
    }))
    const ok = new Set(results.filter(Boolean) as string[])
    if (ok.size > 0) {
      setSavedConfirms(prev => new Set([...prev, ...ok]))
      setStockConfirmSet(prev => new Set([...prev].filter(id => !ok.has(id))))
    }
    setAutoSaveState(ok.size === ids.length ? 'saved' : 'idle')
    if (ok.size < ids.length) showToast('⚠ Some confirmations failed to save — kept for the Save button')
  }
  const [assignLoc, setAssignLoc] = useState({ store: '', floor: '', sub1: '', sub2: '' })
  const [assignSearch, setAssignSearch] = useState('')
  const [assignLoading, setAssignLoading] = useState<string | null>(null)
  const [stocktakeCostPrompt, setStocktakeCostPrompt] = useState<Array<{id:string,name:string,delta:number,oldQty:number,newQty:number,cost:string}> | null>(null)
  const [stocktakeCostSaving, setStocktakeCostSaving] = useState(false)

  const allProducts = products

  async function saveAllStockChanges(skipCostPrompt = false) {
    const now = new Date().toISOString()
    const qtyEntries = Object.entries(stockQtyEdits)
    const confirmOnly = [...stockConfirmSet].filter(id => !(id in stockQtyEdits))
    if (!qtyEntries.length && !confirmOnly.length) return

    // Check for upward qty adjustments — prompt for cost if not already prompted
    if (!skipCostPrompt) {
      const increases = qtyEntries
        .map(([id, newQty]) => {
          const product = allProducts.find((p: any) => p.id === id)
          const oldQty  = product?.quantity ?? 0
          const delta   = newQty - oldQty
          return delta > 0 ? { id, name: product?.name || id, delta, oldQty, newQty, cost: '' } : null
        })
        .filter(Boolean) as Array<{id:string,name:string,delta:number,oldQty:number,newQty:number,cost:string}>
      if (increases.length > 0) {
        setStocktakeCostPrompt(increases)
        return
      }
    }

    setStocktakeSaving(true)
    try {
      const responses = await Promise.all([
        ...qtyEntries.map(([id, qty]) =>
          fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', productId: id, data: { quantity: qty, last_stock_confirmed_at: now } }) })),
        ...confirmOnly.map(id =>
          fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', productId: id, data: { last_stock_confirmed_at: now } }) }))
      ])
      const failedCount = responses.filter(r => !r.ok).length
      if (failedCount > 0) {
        // Keep the pending edits so the count isn't silently lost — user can retry
        showToast(`⚠️ ${failedCount} update${failedCount !== 1 ? 's' : ''} failed — please retry`)
        await onDataChanged()
      } else {
        const total = qtyEntries.length + confirmOnly.length
        showToast(`${total} product${total !== 1 ? 's' : ''} saved & confirmed`)
        setStockQtyEdits({})
        setStockConfirmSet(new Set())
        await onDataChanged()
      }
    } catch { showToast('Error saving') }
    setStocktakeSaving(false)
  }

  async function saveStocktakeWithCost() {
    if (!stocktakeCostPrompt) return
    setStocktakeCostSaving(true)
    const today = colomboToday()
    try {
      // Seed cost layers for items where cost was provided. Track failures and
      // clear seeded costs so a retry doesn't double-insert FIFO layers.
      const results = await Promise.all(stocktakeCostPrompt.map(async item => {
        const cost = parseInt(item.cost) || 0
        if (cost <= 0) return { id: item.id, ok: true }
        try {
          const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'seed_cost_layer', productId: item.id, unitCost: cost, quantity: item.delta, receivedAt: today }) })
          return { id: item.id, ok: r.ok }
        } catch { return { id: item.id, ok: false } }
      }))
      const failed = results.filter(r => !r.ok)
      if (failed.length > 0) {
        const failedIds = new Set(failed.map(f => f.id))
        // Blank out the costs that DID succeed so pressing Save again won't re-seed them
        setStocktakeCostPrompt(prev => prev ? prev.map(it => failedIds.has(it.id) ? it : { ...it, cost: '' }) : prev)
        showToast(`⚠️ ${failed.length} cost layer${failed.length !== 1 ? 's' : ''} failed to save — fix and retry`)
        setStocktakeCostSaving(false)
        return
      }
      setStocktakeCostPrompt(null)
      await saveAllStockChanges(true) // proceed without re-prompting
    } catch { showToast('Error seeding cost layers') }
    setStocktakeCostSaving(false)
  }

  // ── derive unique values for dropdowns ──
  const uniq = (arr: string[]) => [...new Set(arr.filter(Boolean))].sort()
  const allStores  = uniq(allProducts.map((p: any) => p.loc_store))
  const allFloors  = uniq(allProducts.filter((p: any) => !stockFilter.store || p.loc_store === stockFilter.store).map((p: any) => p.loc_floor))
  const allSub1s   = uniq(allProducts.filter((p: any) => (!stockFilter.store || p.loc_store === stockFilter.store) && (!stockFilter.floor || p.loc_floor === stockFilter.floor)).map((p: any) => p.loc_sub1))
  const allSub2s   = uniq(allProducts.filter((p: any) => (!stockFilter.store || p.loc_store === stockFilter.store) && (!stockFilter.floor || p.loc_floor === stockFilter.floor) && (!stockFilter.sub1 || p.loc_sub1 === stockFilter.sub1)).map((p: any) => p.loc_sub2))

  // ── filter products by active filters + search ──
  const searchLower = stocktakeSearch.toLowerCase()
  const browseProducts = allProducts.filter((p: any) => {
    if (stockFilter.store && p.loc_store !== stockFilter.store) return false
    if (stockFilter.floor && p.loc_floor !== stockFilter.floor) return false
    if (stockFilter.sub1  && p.loc_sub1  !== stockFilter.sub1)  return false
    if (stockFilter.sub2  && p.loc_sub2  !== stockFilter.sub2)  return false
    if (searchLower) return p.name?.toLowerCase().includes(searchLower) || (p.sku || '').toLowerCase().includes(searchLower)
    return true
  })

  const anyFilter = stockFilter.store || stockFilter.floor || stockFilter.sub1 || stockFilter.sub2 || stocktakeSearch
  const pendingCount = Object.keys(stockQtyEdits).length + stockConfirmSet.size

  // ── quick assign: search results ──
  const assignSearchLower = assignSearch.toLowerCase()
  const assignResults = assignSearch.length > 1
    ? allProducts.filter((p: any) =>
        p.name?.toLowerCase().includes(assignSearchLower) ||
        (p.sku || '').toLowerCase().includes(assignSearchLower))
      .slice(0, 20)
    : []
  const anyAssignLoc = assignLoc.store || assignLoc.floor || assignLoc.sub1 || assignLoc.sub2

  const dropdownCls = "px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white w-full"

  return (
    <div>
      {/* ── Mode toggle ── */}
      <div className="flex items-center gap-2 mb-5">
        <button onClick={() => setStockView('browse')}
          className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition ${stockView === 'browse' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}>
          📦 Browse & Count
        </button>
        <button onClick={() => setStockView('assign')}
          className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition ${stockView === 'assign' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-500 border-slate-200'}`}>
          📍 Quick Assign
        </button>
        <button onClick={() => setStockView('transfer')}
          className={`px-4 py-2 rounded-xl text-sm font-bold border-2 transition ${stockView === 'transfer' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-500 border-slate-200'}`}>
          🔀 Transfer Stock
        </button>
        {pendingCount > 0 && stockView === 'browse' && (
          <button onClick={() => saveAllStockChanges()} disabled={stocktakeSaving}
            className="ml-auto bg-orange-500 active:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50 shrink-0">
            {stocktakeSaving ? 'Saving...' : `Save ${pendingCount} Change${pendingCount !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* BROWSE & COUNT MODE                       */}
      {/* ══════════════════════════════════════════ */}
      {stockView === 'browse' && (
        <div>
          {/* 4-level filter row */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase">Filter by Location</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Store</label>
                <select value={stockFilter.store} onChange={e => setStockFilter(f => ({...f, store: e.target.value, floor: '', sub1: '', sub2: ''}))} className={dropdownCls}>
                  <option value="">All Stores</option>
                  {allStores.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Floor</label>
                <select value={stockFilter.floor} onChange={e => setStockFilter(f => ({...f, floor: e.target.value, sub1: '', sub2: ''}))} className={dropdownCls}>
                  <option value="">All Floors</option>
                  {allFloors.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Sub Location 1</label>
                <select value={stockFilter.sub1} onChange={e => setStockFilter(f => ({...f, sub1: e.target.value, sub2: ''}))} className={dropdownCls}>
                  <option value="">All</option>
                  {allSub1s.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Sub Location 2</label>
                <select value={stockFilter.sub2} onChange={e => setStockFilter(f => ({...f, sub2: e.target.value}))} className={dropdownCls}>
                  <option value="">All</option>
                  {allSub2s.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {/* Search within filter */}
            <div className="relative">
              <input type="search" placeholder="Search by name or SKU…" value={stocktakeSearch}
                onChange={e => setStocktakeSearch(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg border-2 border-slate-200 outline-none focus:border-orange-400 bg-white" />
              {stocktakeSearch && <button onClick={() => setStocktakeSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">×</button>}
            </div>
            {anyFilter && (
              <button onClick={() => { setStockFilter({ store: '', floor: '', sub1: '', sub2: '' }); setStocktakeSearch('') }}
                className="text-xs font-bold text-orange-500 hover:text-orange-700">✕ Clear all filters</button>
            )}
          </div>

          {/* Results header */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-400 uppercase">{browseProducts.length} product{browseProducts.length !== 1 ? 's' : ''}{anyFilter ? ' matching' : ''}</p>
            {autoSaveState === 'saving' && <p className="text-xs font-bold text-amber-500">Saving…</p>}
            {autoSaveState === 'saved' && stockConfirmSet.size === 0 && <p className="text-xs font-bold text-emerald-500">✓ Confirmations saved</p>}
          </div>

          {/* Product list */}
          {browseProducts.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-slate-500 font-semibold">No products match these filters</p>
              <button onClick={() => { setStockFilter({ store: '', floor: '', sub1: '', sub2: '' }); setStocktakeSearch('') }} className="mt-3 text-sm text-orange-500 font-bold">Clear filters</button>
            </div>
          ) : (
            <div className="space-y-2 pb-24 sm:pb-4">
              {browseProducts.map((p: any) => {
                const curQty = stockQtyEdits[p.id] ?? p.quantity
                const changed = stockQtyEdits[p.id] !== undefined
                const autoSaved = savedConfirms.has(p.id)
                const confirmed = stockConfirmSet.has(p.id) || autoSaved
                const loc = locLabel(p)
                const ago = autoSaved ? { label: 'Confirmed today', cls: 'text-emerald-700 bg-emerald-50' } : confirmedAgo(p.last_stock_confirmed_at)
                return (
                  <div key={p.id} className={`bg-white rounded-xl border p-4 ${changed ? 'border-orange-300 bg-orange-50' : confirmed ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    {/* Top row: info + confirmed badge */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 shrink-0">{p.sku}</span>
                          {p.condition && <span className="text-[10px] font-semibold text-slate-400">{p.condition}</span>}
                        </div>
                        <p className="font-bold text-slate-900 leading-tight">{p.name}</p>
                        {(p.make || p.model) && <p className="text-xs text-slate-400 mt-0.5">{p.make} {p.model}</p>}
                        {loc && !anyFilter && <p className="text-[10px] font-semibold text-amber-700 mt-0.5">📍 {loc}</p>}
                        {changed && <p className="text-[10px] font-bold text-orange-600 mt-0.5">Was {p.quantity} → now {curQty}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {ago
                          ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ago.cls}`}>✓ {ago.label}</span>
                          : <span className="text-[10px] font-semibold text-slate-300 px-2 py-0.5 rounded-full bg-slate-50">Never confirmed</span>}
                        {!changed && (
                          <button
                            onClick={() => { if (autoSaved) return; setStockConfirmSet(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n }) }}
                            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition active:scale-95 ${confirmed ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-400 hover:text-emerald-600'}`}>
                            {autoSaved ? '✓ Saved' : confirmed ? '✓ Confirmed' : 'Confirm'}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Bottom row: qty controls + damage */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => setStockQtyEdits(prev => ({...prev, [p.id]: Math.max(0, (prev[p.id] ?? p.quantity) - 1)}))}
                        className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold text-2xl flex items-center justify-center active:bg-slate-200 select-none">−</button>
                      <input type="number" min="0" value={curQty}
                        onChange={e => setStockQtyEdits(prev => ({...prev, [p.id]: Math.max(0, parseInt(e.target.value) || 0)}))}
                        className="w-20 h-10 text-center font-bold text-lg border-2 rounded-xl outline-none focus:border-orange-400 border-slate-200 bg-white" />
                      <button onClick={() => setStockQtyEdits(prev => ({...prev, [p.id]: (prev[p.id] ?? p.quantity) + 1}))}
                        className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold text-2xl flex items-center justify-center active:bg-slate-200 select-none">+</button>
                      <button onClick={() => setDamageProduct(p)}
                        className="ml-auto h-10 px-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-700 font-bold text-xs active:bg-amber-100">
                        ⚠ Damage
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Sticky save bar — mobile */}
          {pendingCount > 0 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-orange-200 p-4 z-50 sm:hidden">
              <button onClick={() => saveAllStockChanges()} disabled={stocktakeSaving}
                className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl disabled:opacity-50 text-base">
                {stocktakeSaving ? 'Saving...' : `✓ Save ${pendingCount} Change${pendingCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* QUICK ASSIGN MODE                         */}
      {/* ══════════════════════════════════════════ */}
      {stockView === 'assign' && (
        <div>
          {/* Set current location — locked until changed */}
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 mb-5">
            <p className="text-xs font-bold text-amber-800 uppercase mb-3">📍 I'm standing at this location</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Store</label>
                <input value={assignLoc.store} onChange={e => setAssignLoc(l => ({...l, store: e.target.value}))}
                  list="assign-stores" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Main Store" />
                <datalist id="assign-stores">{allStores.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Floor</label>
                <input value={assignLoc.floor} onChange={e => setAssignLoc(l => ({...l, floor: e.target.value}))}
                  list="assign-floors" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Ground" />
                <datalist id="assign-floors">{allFloors.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Sub Location 1</label>
                <input value={assignLoc.sub1} onChange={e => setAssignLoc(l => ({...l, sub1: e.target.value}))}
                  list="assign-sub1s" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Rack A" />
                <datalist id="assign-sub1s">{allSub1s.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Sub Location 2</label>
                <input value={assignLoc.sub2} onChange={e => setAssignLoc(l => ({...l, sub2: e.target.value}))}
                  list="assign-sub2s" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Bin 5" />
                <datalist id="assign-sub2s">{allSub2s.map(s => <option key={s} value={s} />)}</datalist>
              </div>
            </div>
            {anyAssignLoc
              ? <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 text-sm font-bold text-amber-900">📍 {[assignLoc.store, assignLoc.floor, assignLoc.sub1, assignLoc.sub2].filter(Boolean).join(' › ')}</div>
              : <p className="text-xs text-amber-600">Fill at least one field above to start assigning</p>
            }
          </div>

          {/* Product search */}
          <div className="relative mb-3">
            <input type="search" placeholder="Search product by name or SKU to assign…" value={assignSearch}
              onChange={e => setAssignSearch(e.target.value)}
              className="w-full px-4 py-3 text-base rounded-xl border-2 border-slate-200 outline-none focus:border-orange-400 bg-white" />
            {assignSearch && <button onClick={() => setAssignSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">×</button>}
          </div>

          {assignSearch.length < 2 && (
            <p className="text-xs text-slate-400 text-center py-6">Type at least 2 characters to search products</p>
          )}

          {/* ── At this location ── always visible when a location is set */}
          {anyAssignLoc && (() => {
            const atLoc = allProducts.filter((p: any) =>
              (!assignLoc.store || p.loc_store === assignLoc.store) &&
              (!assignLoc.floor || p.loc_floor === assignLoc.floor) &&
              (!assignLoc.sub1  || p.loc_sub1  === assignLoc.sub1) &&
              (!assignLoc.sub2  || p.loc_sub2  === assignLoc.sub2))
            if (!atLoc.length) return (
              <div className="mb-4 text-center py-4 border-2 border-dashed border-slate-200 rounded-xl">
                <p className="text-sm text-slate-400">No products assigned here yet</p>
              </div>
            )
            return (
              <div className="mb-5">
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">At this location — {atLoc.length} part{atLoc.length !== 1 ? 's' : ''}</p>
                <div className="space-y-1.5">
                  {atLoc.map((p: any) => {
                    const ago = confirmedAgo(p.last_stock_confirmed_at)
                    const isClearing = assignLoading === ('clear-' + p.id)
                    return (
                      <div key={p.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.sku}</span>
                          <p className="font-semibold text-slate-900 text-sm leading-tight mt-0.5">{p.name}</p>
                          {(p.make || p.model) && <p className="text-xs text-slate-400">{p.make} {p.model}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-slate-700 text-sm">qty: {p.quantity}</p>
                          {ago
                            ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ago.cls}`}>✓ {ago.label}</span>
                            : <span className="text-[10px] text-slate-300">not confirmed</span>}
                        </div>
                        <button
                          disabled={isClearing}
                          onClick={async () => {
                            setAssignLoading('clear-' + p.id)
                            try {
                              const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ action: 'update', productId: p.id, data: { loc_store: null, loc_floor: null, loc_sub1: null, loc_sub2: null } }) })
                              if (r.ok) { await onDataChanged(); showToast('Location cleared') }
                              else showToast('⚠️ Failed to clear location')
                            } catch { showToast('Network error') }
                            finally { setAssignLoading(null) }
                          }}
                          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 active:bg-red-100 border border-slate-200 text-lg font-bold disabled:opacity-40 transition">
                          {isClearing ? '…' : '✕'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {assignResults.length > 0 && (
            <div className="space-y-2">
              {assignResults.map((p: any) => {
                const currentLoc = locLabel(p)
                const isSaving = assignLoading === p.id
                const alreadyHere = anyAssignLoc &&
                  (!assignLoc.store || p.loc_store === assignLoc.store) &&
                  (!assignLoc.floor || p.loc_floor === assignLoc.floor) &&
                  (!assignLoc.sub1  || p.loc_sub1  === assignLoc.sub1) &&
                  (!assignLoc.sub2  || p.loc_sub2  === assignLoc.sub2)
                return (
                  <div key={p.id} className={`bg-white rounded-xl border p-4 flex items-center gap-3 ${alreadyHere ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.sku}</span>
                      <p className="font-bold text-slate-900 leading-tight mt-0.5">{p.name}</p>
                      {(p.make || p.model) && <p className="text-xs text-slate-400">{p.make} {p.model}</p>}
                      {currentLoc
                        ? <p className="text-[10px] font-semibold text-amber-700 mt-0.5">📍 {currentLoc}</p>
                        : <p className="text-[10px] text-slate-300 mt-0.5">No location set</p>}
                    </div>
                    {alreadyHere ? (
                      <span className="text-emerald-600 font-bold text-sm shrink-0">✓ Here</span>
                    ) : (
                      <button
                        disabled={!anyAssignLoc || isSaving}
                        onClick={async () => {
                          if (!anyAssignLoc) return
                          setAssignLoading(p.id)
                          try {
                            const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'update', productId: p.id, data: { loc_store: assignLoc.store || null, loc_floor: assignLoc.floor || null, loc_sub1: assignLoc.sub1 || null, loc_sub2: assignLoc.sub2 || null } }) })
                            if (r.ok) { await onDataChanged(); showToast(`📍 ${p.sku} assigned`) }
                            else showToast('⚠️ Failed to assign location')
                          } catch { showToast('Network error') }
                          finally { setAssignLoading(null) }
                        }}
                        className="bg-amber-500 active:bg-amber-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl disabled:opacity-40 shrink-0">
                        {isSaving ? '…' : 'Assign'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── STOCKTAKE COST PROMPT MODAL ── */}
      {stocktakeCostPrompt && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="bg-amber-50 px-5 py-4 border-b border-amber-100">
              <h3 className="font-bold text-base text-amber-800">📦 Stock Added — Track Cost?</h3>
              <p className="text-xs text-amber-600 mt-1">You increased stock for {stocktakeCostPrompt.length} product{stocktakeCostPrompt.length !== 1 ? 's' : ''}. Enter the purchase cost to keep FIFO and Gross Profit accurate.</p>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
              {stocktakeCostPrompt.map((item, i) => (
                <div key={item.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-800 truncate">{item.name}</p>
                    <p className="text-[11px] text-slate-400">{item.oldQty} → {item.newQty} <span className="text-green-600 font-bold">(+{item.delta})</span></p>
                  </div>
                  <div className="shrink-0">
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">Cost/unit (Rs.)</label>
                    <input type="number" min="0" placeholder="optional"
                      value={item.cost}
                      onChange={e => setStocktakeCostPrompt(prev => prev!.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))}
                      className="w-28 px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm text-right outline-none focus:border-orange-400" />
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 pb-5 space-y-2">
              <button onClick={saveStocktakeWithCost} disabled={stocktakeCostSaving}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-xl">
                {stocktakeCostSaving ? '⏳ Saving…' : '✅ Save with Cost Tracking'}
              </button>
              <button onClick={() => { setStocktakeCostPrompt(null); saveAllStockChanges(true) }} disabled={stocktakeCostSaving}
                className="w-full text-sm text-slate-400 font-semibold py-2 hover:text-slate-600 disabled:opacity-40">
                Save without cost tracking (GP won't be accurate for these units)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSFER STOCK ── */}
      {stockView === 'transfer' && (
        <StockTransfer vendor={vendor} products={products} showToast={showToast} onDataChanged={onDataChanged} />
      )}

      {/* ── Damage capture sheet (from stock count) ── */}
      {damageProduct && (
        <DamageCapture
          product={damageProduct}
          showToast={showToast}
          onClose={() => setDamageProduct(null)}
          onSaved={() => onDataChanged()}
        />
      )}
    </div>
  )
}
