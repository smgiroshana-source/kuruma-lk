'use client'
import { useState, useEffect, useRef } from 'react'

type Props = {
  vendor: any
  showToast: (msg: string) => void
}

type WriteoffRecord = {
  id: string
  vendor_id: string
  writeoff_no: string
  writeoff_date: string
  reason: WriteoffReason
  notes: string | null
  total_cost: number
  status: 'draft' | 'posted'
  items_count: number
  created_at: string
}

type Product = {
  id: string
  sku: string
  name: string
  quantity: number
  cost: number
}

type WriteoffItem = {
  product_id: string
  product_sku: string
  product_name: string
  quantity: number
  unit_cost: number
}

type WriteoffReason = 'damaged' | 'expired' | 'lost' | 'theft' | 'other'
type StatusFilter = 'all' | 'draft' | 'posted'

const REASON_LABELS: Record<WriteoffReason, string> = {
  damaged: 'Damaged',
  expired: 'Expired',
  lost: 'Lost',
  theft: 'Theft',
  other: 'Other',
}

function formatRs(amount: number): string {
  return 'Rs. ' + Math.round(amount).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function statusBadge(status: 'draft' | 'posted') {
  const styles: Record<string, string> = {
    draft: 'bg-amber-100 text-amber-700',
    posted: 'bg-emerald-100 text-emerald-700',
  }
  return (
    <span
      className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full capitalize ${
        styles[status] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {status}
    </span>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
    </div>
  )
}

export default function TabWriteoffs({ vendor, showToast }: Props) {
  // ── view state ──────────────────────────────────────────────────────────────
  const [view, setView] = useState<'list' | 'new'>('list')

  // ── list state ──────────────────────────────────────────────────────────────
  const [writeoffs, setWriteoffs] = useState<WriteoffRecord[]>([])
  const [loadingWriteoffs, setLoadingWriteoffs] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // ── shared data ─────────────────────────────────────────────────────────────
  const [products, setProducts] = useState<Product[]>([])
  const [loadingData, setLoadingData] = useState(false)

  // ── new write-off form state ────────────────────────────────────────────────
  const [writeoffDate, setWriteoffDate] = useState(todayStr())
  const [reason, setReason] = useState<WriteoffReason | ''>('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<WriteoffItem[]>([])
  const [saving, setSaving] = useState(false)

  // ── product search ──────────────────────────────────────────────────────────
  const [productSearch, setProductSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)

  // ── effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchWriteoffs()
  }, [statusFilter])

  useEffect(() => {
    fetchProducts()
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // ── fetch helpers ────────────────────────────────────────────────────────────
  async function fetchWriteoffs() {
    setLoadingWriteoffs(true)
    try {
      const params = new URLSearchParams({ vendor_id: vendor.id })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/vendor/writeoffs?${params}`)
      if (!res.ok) throw new Error('Failed to load write-offs')
      const data = await res.json()
      setWriteoffs(data.writeoffs ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading write-offs')
    } finally {
      setLoadingWriteoffs(false)
    }
  }

  async function fetchProducts() {
    setLoadingData(true)
    try {
      const res = await fetch(`/api/vendor/products?vendor_id=${vendor.id}`)
      if (!res.ok) throw new Error('Failed to load products')
      const data = await res.json()
      setProducts(data.products ?? data ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading products')
    } finally {
      setLoadingData(false)
    }
  }

  // ── actions ──────────────────────────────────────────────────────────────────
  async function handlePost(wo: WriteoffRecord) {
    if (!confirm(`Post write-off ${wo.writeoff_no}? This will reduce stock and cannot be undone.`)) return
    try {
      const res = await fetch('/api/vendor/writeoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'post', vendor_id: vendor.id, writeoffId: wo.id }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed to post write-off') }
      showToast(`Write-off ${wo.writeoff_no} posted`)
      await fetchWriteoffs()
    } catch (e: any) {
      showToast(e.message)
    }
  }

  async function handleDelete(wo: WriteoffRecord) {
    if (!confirm(`Delete write-off ${wo.writeoff_no}? This cannot be undone.`)) return
    try {
      const res = await fetch('/api/vendor/writeoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', vendor_id: vendor.id, writeoffId: wo.id }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed to delete write-off') }
      showToast(`Write-off ${wo.writeoff_no} deleted`)
      await fetchWriteoffs()
    } catch (e: any) {
      showToast(e.message)
    }
  }

  async function handleSave(postImmediately: boolean) {
    if (!reason) { showToast('Please select a reason'); return }
    if (items.length === 0) { showToast('Add at least one item'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/vendor/writeoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          vendor_id: vendor.id,
          writeoff_date: writeoffDate,
          reason,
          notes: notes.trim() || null,
          items: items.map(it => ({
            product_id: it.product_id,
            product_sku: it.product_sku,
            product_name: it.product_name,
            quantity: it.quantity,
            unit_cost: it.unit_cost,
          })),
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed to create write-off') }
      const created = await res.json()

      if (postImmediately) {
        const postRes = await fetch('/api/vendor/writeoffs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'post', vendor_id: vendor.id, writeoffId: created.writeoff.id }),
        })
        if (!postRes.ok) { const d = await postRes.json(); throw new Error(d.error ?? 'Created but failed to post') }
        showToast(`Write-off ${created.writeoff.writeoff_no} posted`)
      } else {
        showToast(`Write-off ${created.writeoff.writeoff_no} saved as draft`)
      }

      resetForm()
      setView('list')
      await fetchWriteoffs()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── form helpers ─────────────────────────────────────────────────────────────
  function resetForm() {
    setWriteoffDate(todayStr())
    setReason('')
    setNotes('')
    setItems([])
    setProductSearch('')
    setShowDropdown(false)
  }

  function addProduct(product: Product) {
    setItems(prev => {
      const existing = prev.findIndex(it => it.product_id === product.id)
      if (existing >= 0) {
        const updated = [...prev]
        const newQty = Math.min(updated[existing].quantity + 1, product.quantity)
        updated[existing] = { ...updated[existing], quantity: newQty }
        return updated
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_sku: product.sku,
          product_name: product.name,
          quantity: 1,
          unit_cost: Math.round(product.cost),
        },
      ]
    })
    setProductSearch('')
    setShowDropdown(false)
  }

  function updateItemQty(idx: number, qty: number, maxQty: number) {
    setItems(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], quantity: Math.max(1, Math.min(qty, maxQty)) }
      return updated
    })
  }

  function updateItemCost(idx: number, cost: number) {
    setItems(prev => {
      const updated = [...prev]
      updated[idx] = { ...updated[idx], unit_cost: Math.round(Math.max(0, cost)) }
      return updated
    })
  }

  function removeItem(idx: number) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }

  // ── derived ──────────────────────────────────────────────────────────────────
  const filteredProducts = productSearch.trim().length > 0
    ? products.filter(p => {
        const q = productSearch.toLowerCase()
        return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
      }).slice(0, 10)
    : []

  const grandTotal = items.reduce((sum, it) => sum + it.quantity * it.unit_cost, 0)

  const productStockMap: Record<string, number> = {}
  for (const p of products) productStockMap[p.id] = p.quantity

  // ─────────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'new') {
    return (
      <NewWriteoffView
        loadingData={loadingData}
        writeoffDate={writeoffDate}
        onDateChange={setWriteoffDate}
        reason={reason}
        onReasonChange={(v) => setReason(v as WriteoffReason | '')}
        notes={notes}
        onNotesChange={setNotes}
        items={items}
        productSearch={productSearch}
        onProductSearchChange={(v) => { setProductSearch(v); setShowDropdown(v.trim().length > 0) }}
        filteredProducts={filteredProducts}
        showDropdown={showDropdown}
        searchRef={searchRef}
        onAddProduct={addProduct}
        onUpdateItemQty={updateItemQty}
        onUpdateItemCost={updateItemCost}
        onRemoveItem={removeItem}
        productStockMap={productStockMap}
        grandTotal={grandTotal}
        saving={saving}
        onSaveDraft={() => handleSave(false)}
        onPostNow={() => handleSave(true)}
        onBack={() => { resetForm(); setView('list') }}
      />
    )
  }

  return (
    <WriteoffListView
      writeoffs={writeoffs}
      loading={loadingWriteoffs}
      statusFilter={statusFilter}
      onStatusFilter={setStatusFilter}
      onNew={() => setView('new')}
      onPost={handlePost}
      onDelete={handleDelete}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 1: Write-offs List
// ─────────────────────────────────────────────────────────────────────────────
function WriteoffListView({
  writeoffs,
  loading,
  statusFilter,
  onStatusFilter,
  onNew,
  onPost,
  onDelete,
}: {
  writeoffs: WriteoffRecord[]
  loading: boolean
  statusFilter: StatusFilter
  onStatusFilter: (f: StatusFilter) => void
  onNew: () => void
  onPost: (w: WriteoffRecord) => void
  onDelete: (w: WriteoffRecord) => void
}) {
  const filters: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Drafts', value: 'draft' },
    { label: 'Posted', value: 'posted' },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-black text-slate-900">Stock Write-offs</h1>
        <button
          onClick={onNew}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
        >
          <span className="text-base leading-none">+</span>
          New Write-off
        </button>
      </div>

      {/* Status filter toggle */}
      <div className="flex gap-1 mb-5 bg-slate-100 rounded-xl p-1 w-fit">
        {filters.map(f => (
          <button
            key={f.value}
            onClick={() => onStatusFilter(f.value)}
            className={`px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              statusFilter === f.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <Spinner />
      ) : writeoffs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400 font-semibold text-sm">No write-offs found.</p>
          <p className="text-slate-300 text-xs mt-1">Create a new write-off to remove damaged, lost, or expired stock.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Write-off No.</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Reason</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Items</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Total Cost</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {writeoffs.map(wo => (
                  <tr key={wo.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-slate-700">{wo.writeoff_no}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{wo.writeoff_date}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-500 capitalize">{REASON_LABELS[wo.reason] ?? wo.reason}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-xs font-semibold text-slate-600">{wo.items_count}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-slate-800">{formatRs(wo.total_cost)}</span>
                    </td>
                    <td className="px-4 py-3 text-center">{statusBadge(wo.status)}</td>
                    <td className="px-4 py-3 text-right">
                      {wo.status === 'draft' && (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => onPost(wo)}
                            className="px-2.5 py-1 rounded-lg border border-emerald-300 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 transition-colors"
                          >
                            Post
                          </button>
                          <button
                            onClick={() => onDelete(wo)}
                            className="px-2.5 py-1 rounded-lg border border-red-200 text-[11px] font-bold text-red-500 hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                      {wo.status === 'posted' && (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW 2: New Write-off Form
// ─────────────────────────────────────────────────────────────────────────────
function NewWriteoffView({
  loadingData,
  writeoffDate,
  onDateChange,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  items,
  productSearch,
  onProductSearchChange,
  filteredProducts,
  showDropdown,
  searchRef,
  onAddProduct,
  onUpdateItemQty,
  onUpdateItemCost,
  onRemoveItem,
  productStockMap,
  grandTotal,
  saving,
  onSaveDraft,
  onPostNow,
  onBack,
}: {
  loadingData: boolean
  writeoffDate: string
  onDateChange: (d: string) => void
  reason: WriteoffReason | ''
  onReasonChange: (v: string) => void
  notes: string
  onNotesChange: (v: string) => void
  items: WriteoffItem[]
  productSearch: string
  onProductSearchChange: (v: string) => void
  filteredProducts: Product[]
  showDropdown: boolean
  searchRef: React.RefObject<HTMLDivElement | null>
  onAddProduct: (p: Product) => void
  onUpdateItemQty: (idx: number, qty: number, maxQty: number) => void
  onUpdateItemCost: (idx: number, cost: number) => void
  onRemoveItem: (idx: number) => void
  productStockMap: Record<string, number>
  grandTotal: number
  saving: boolean
  onSaveDraft: () => void
  onPostNow: () => void
  onBack: () => void
}) {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          <span className="text-base">←</span> Write-offs
        </button>
        <h1 className="text-2xl font-black text-slate-900">New Write-off</h1>
      </div>

      {loadingData ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          {/* Card 1: Details */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-wide mb-4">Write-off Details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Write-off Date */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Write-off Date</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={writeoffDate}
                  onChange={e => onDateChange(e.target.value)}
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">
                  Reason <span className="text-red-500">*</span>
                </label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                  value={reason}
                  onChange={e => onReasonChange(e.target.value)}
                >
                  <option value="">Select reason…</option>
                  <option value="damaged">Damaged</option>
                  <option value="expired">Expired</option>
                  <option value="lost">Lost</option>
                  <option value="theft">Theft</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {/* Notes */}
              <div className="sm:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Notes (optional)</label>
                <textarea
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  placeholder="Any additional details…"
                  value={notes}
                  onChange={e => onNotesChange(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Card 2: Items */}
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <h2 className="text-sm font-black text-slate-700 uppercase tracking-wide mb-4">Items to Write Off</h2>

            {/* Product search */}
            <div className="mb-4" ref={searchRef}>
              <label className="block text-xs font-bold text-slate-500 mb-1">Search Product</label>
              <div className="relative">
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Type product name or SKU to add…"
                  value={productSearch}
                  onChange={e => onProductSearchChange(e.target.value)}
                  autoComplete="off"
                />
                {showDropdown && filteredProducts.length > 0 && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
                    {filteredProducts.map(p => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={e => { e.preventDefault(); onAddProduct(p) }}
                        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-orange-50 transition-colors text-left border-b border-slate-100 last:border-0"
                      >
                        <div>
                          <span className="block text-sm font-semibold text-slate-800">{p.name}</span>
                          <span className="text-xs text-slate-400 font-mono">{p.sku}</span>
                        </div>
                        <div className="text-right ml-4">
                          <span className="block text-xs font-bold text-slate-500">{formatRs(p.cost)}</span>
                          <span className={`text-[11px] font-semibold ${p.quantity > 0 ? 'text-emerald-600' : 'text-red-400'}`}>
                            {p.quantity} in stock
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
                {showDropdown && productSearch.trim().length > 0 && filteredProducts.length === 0 && (
                  <div className="absolute z-20 left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg px-4 py-3">
                    <p className="text-sm text-slate-400">No matching products found.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Items table */}
            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                <p className="text-slate-400 text-sm font-semibold">No items added yet.</p>
                <p className="text-slate-300 text-xs mt-1">Search for a product above to add it.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm mb-3">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Product</th>
                      <th className="px-4 py-2.5 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">SKU</th>
                      <th className="px-4 py-2.5 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Unit Cost</th>
                      <th className="px-4 py-2.5 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Total</th>
                      <th className="px-4 py-2.5 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => {
                      const maxQty = productStockMap[item.product_id] ?? 9999
                      const lineTotal = item.quantity * item.unit_cost
                      return (
                        <tr key={item.product_id} className="border-t border-slate-100">
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-slate-800 text-sm">{item.product_name}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="font-mono text-xs text-slate-500">{item.product_sku}</span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <input
                              type="number"
                              min={1}
                              max={maxQty}
                              value={item.quantity}
                              onChange={e => onUpdateItemQty(idx, Math.round(Number(e.target.value)), maxQty)}
                              className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-400"
                            />
                            {maxQty < 9999 && (
                              <p className="text-[10px] text-slate-400 mt-0.5">max {maxQty}</p>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <input
                              type="number"
                              min={0}
                              value={item.unit_cost}
                              onChange={e => onUpdateItemCost(idx, Number(e.target.value))}
                              className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-orange-400"
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="font-bold text-slate-800">{formatRs(lineTotal)}</span>
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <button
                              onClick={() => onRemoveItem(idx)}
                              className="text-red-400 hover:text-red-600 transition-colors text-lg leading-none font-bold"
                              aria-label="Remove item"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {/* Grand total */}
                <div className="flex justify-end pt-3 border-t border-slate-200">
                  <div className="flex items-center gap-4">
                    <span className="text-sm font-bold text-slate-500 uppercase tracking-wide">Total Write-off Cost</span>
                    <span className="text-xl font-black text-slate-900">{formatRs(grandTotal)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Save buttons */}
          <div className="flex items-center justify-end gap-3 pb-4">
            <button
              onClick={onBack}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSaveDraft}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              onClick={onPostNow}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Post Write-off'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
