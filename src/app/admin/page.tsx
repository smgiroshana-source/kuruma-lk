'use client'

import { useState, useEffect } from 'react'

type AdminTab = 'overview' | 'vendors' | 'products' | 'keywords'

export default function AdminDashboard() {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [editingVendor, setEditingVendor] = useState<any>(null)
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [vendorFilter, setVendorFilter] = useState('all')
  const [productSearch, setProductSearch] = useState('')
  const [productVendorFilter, setProductVendorFilter] = useState('all')
  const [toast, setToast] = useState('')

  // Feature 3: Multi-select delete
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())

  // Feature 8: Vendor change requests
  const [changeRequests, setChangeRequests] = useState<any[]>([])
  const [changeLoading, setChangeLoading] = useState(false)

  // Keywords / Synonyms
  const [synonyms, setSynonyms] = useState<any[]>([])
  const [synonymsLoading, setSynonymsLoading] = useState(false)
  const [editingSynonym, setEditingSynonym] = useState<any>(null)
  const [newKeywords, setNewKeywords] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/data')
      if (res.status === 403) {
        window.location.href = '/login'
        return
      }
      if (res.ok) {
        const json = await res.json()
        setData(json)
      } else {
        setError('Failed to load admin data')
      }
    } catch (err) {
      setError('Network error - check your connection')
    }
    setLoading(false)
  }

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  async function handleSignOut() {
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.href = '/'
  }

  // Synonym functions
  async function fetchSynonyms() {
    setSynonymsLoading(true)
    try {
      const res = await fetch('/api/admin/synonyms')
      if (res.ok) { const json = await res.json(); setSynonyms(json.synonyms || []) }
    } catch {}
    setSynonymsLoading(false)
  }

  async function synonymAction(action: string, id?: string, keywords?: string[]) {
    setActionLoading(id || 'new')
    try {
      const res = await fetch('/api/admin/synonyms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id, keywords }),
      })
      if (res.ok) {
        showToast(action === 'delete' ? 'Synonym group deleted' : action === 'create' ? 'Synonym group created' : 'Synonym group updated')
        fetchSynonyms()
        setEditingSynonym(null)
        setNewKeywords('')
      } else {
        const err = await res.json()
        showToast(err.error || 'Failed')
      }
    } catch { showToast('Network error') }
    setActionLoading(null)
  }

  async function vendorAction(action: string, vendorId: string, updateData?: any) {
    setActionLoading(vendorId)
    try {
      const res = await fetch('/api/admin/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, vendorId, data: updateData }),
      })
      const json = await res.json()
      if (json.success) {
        showToast(json.message)
        await fetchData()
        setEditingVendor(null)
      } else {
        showToast('Error: ' + json.error)
      }
    } catch (err) {
      showToast('Network error')
    }
    setActionLoading(null)
  }

  async function productAction(action: string, productId: string, updateData?: any) {
    setActionLoading(productId)
    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, productId, data: updateData }),
      })
      const json = await res.json()
      if (json.success) {
        showToast(json.message)
        await fetchData()
        setEditingProduct(null)
      } else {
        showToast('Error: ' + json.error)
      }
    } catch (err) {
      showToast('Network error')
    }
    setActionLoading(null)
  }

  // Feature 3: Multi-select helpers
  function toggleProductSelect(productId: string) {
    setSelectedProducts(prev => {
      const next = new Set(prev)
      next.has(productId) ? next.delete(productId) : next.add(productId)
      return next
    })
  }

  function toggleSelectAll(productList: any[]) {
    setSelectedProducts(prev => {
      if (prev.size === productList.length) return new Set()
      return new Set(productList.map((p: any) => p.id))
    })
  }

  async function deleteSelectedProducts() {
    if (!selectedProducts.size) return
    if (!confirm(`Delete ${selectedProducts.size} product${selectedProducts.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    try {
      const r = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_delete', productIds: [...selectedProducts] })
      })
      const j = await r.json()
      if (j.success) { showToast(j.message); setSelectedProducts(new Set()); await fetchData() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
  }

  // Feature 8: Change request handlers
  async function fetchChangeRequests() {
    setChangeLoading(true)
    try {
      const r = await fetch('/api/admin/change-requests')
      if (r.ok) { const j = await r.json(); setChangeRequests(j.requests || []) }
    } catch {}
    setChangeLoading(false)
  }

  async function handleChangeRequest(requestId: string, action: 'approve' | 'reject', reason?: string) {
    try {
      const r = await fetch('/api/admin/change-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, requestId, reason })
      })
      const j = await r.json()
      if (j.success) { showToast(j.message); fetchChangeRequests(); fetchData() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
  }

  useEffect(() => { fetchChangeRequests() }, [tab])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Loading admin panel...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-500 font-bold mb-2">{error}</p>
          <a href="/login" className="text-orange-500 font-semibold">Go to Login</a>
        </div>
      </div>
    )
  }

  if (!data) return null

  const { stats, vendors, products } = data

  const filteredVendors = vendors.filter((v: any) => {
    if (vendorFilter === 'all') return true
    return v.status === vendorFilter
  })

  const filteredProducts = products.filter((p: any) => {
    const matchesSearch = !productSearch ||
      p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.sku || '').toLowerCase().includes(productSearch.toLowerCase()) ||
      (p.make || '').toLowerCase().includes(productSearch.toLowerCase())
    const matchesVendor = productVendorFilter === 'all' || p.vendor_id === productVendorFilter
    return matchesSearch && matchesVendor
  })

  const pendingVendors = vendors.filter((v: any) => v.status === 'pending')

  return (
    <div className="min-h-screen bg-slate-50">

      {toast && (
        <div className="fixed top-4 right-4 z-[100] bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold">
          {toast}
        </div>
      )}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-xl font-black text-orange-500">kuruma.lk</a>
            <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">SUPER ADMIN</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="/admin/analytics" className="text-sm text-slate-400 hover:text-slate-600">Analytics</a>
            <a href="/" className="text-sm text-slate-400 hover:text-slate-600">View Store</a>
            <button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-600 font-semibold">Log Out</button>
          </div>
        </div>
      </header>

      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 flex gap-1">
          {(['overview', 'vendors', 'products', 'keywords'] as AdminTab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); if (t === 'keywords' && synonyms.length === 0) fetchSynonyms() }}
              className={`px-5 py-3 text-sm font-bold border-b-2 transition capitalize ${tab === t ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
            >
              {t}
              {t === 'vendors' && pendingVendors.length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{pendingVendors.length}</span>
              )}
              {t === 'vendors' && changeRequests.length > 0 && (
                <span className="ml-1 bg-amber-500 text-white text-[9px] font-black w-4 h-4 rounded-full inline-flex items-center justify-center">{changeRequests.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-6">

        {tab === 'overview' && (
          <div>
            <h1 className="text-2xl font-black text-slate-900 mb-6">Platform Overview</h1>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-2xl font-black text-orange-500">{stats.totalProducts}</p>
                <p className="text-xs text-slate-400 mt-1">Total Products</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-2xl font-black text-emerald-500">{stats.activeProducts}</p>
                <p className="text-xs text-slate-400 mt-1">Active Products</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-2xl font-black text-purple-500">{stats.approvedVendors}</p>
                <p className="text-xs text-slate-400 mt-1">Active Vendors</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-2xl font-black text-amber-500">{stats.pendingVendors}</p>
                <p className="text-xs text-slate-400 mt-1">Pending Approval</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-2xl font-black text-blue-500">Rs. {stats.totalStockValue.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">Stock Value</p>
              </div>
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-2xl font-black text-green-600">Rs. {stats.totalSales.toLocaleString()}</p>
                <p className="text-xs text-slate-400 mt-1">Total Sales ({stats.totalSalesCount})</p>
              </div>
            </div>

            {pendingVendors.length > 0 && (
              <div className="bg-amber-50 border-2 border-amber-200 rounded-xl p-4 mb-6">
                <h3 className="font-bold text-amber-800 mb-2">{pendingVendors.length} Vendor{pendingVendors.length > 1 ? 's' : ''} Waiting for Approval</h3>
                {pendingVendors.map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between py-2 border-b border-amber-100 last:border-0">
                    <div>
                      <span className="font-semibold text-sm text-slate-900">{v.name}</span>
                      <span className="text-xs text-slate-500 ml-2">{v.location} &bull; {v.phone}</span>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => vendorAction('approve', v.id)} disabled={actionLoading === v.id} className="text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-lg disabled:opacity-50">Approve</button>
                      <button onClick={() => { if (confirm('Reject and delete this vendor?')) vendorAction('reject', v.id) }} disabled={actionLoading === v.id} className="text-xs font-bold text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 disabled:opacity-50">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-slate-900 mb-3">Latest Products</h3>
              <div className="space-y-2">
                {products.slice(0, 8).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <div>
                      <span className="font-semibold text-sm text-slate-900">{p.name}</span>
                      <span className="text-xs text-slate-400 ml-2">{p.sku}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-slate-500">{p.vendor?.name}</span>
                      <span className="font-bold text-sm text-orange-600">{p.price ? 'Rs. ' + p.price.toLocaleString() : 'Ask'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'vendors' && (
          <div>
            <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
              <h1 className="text-2xl font-black text-slate-900">All Vendors</h1>
              <div className="flex gap-2">
                {['all', 'approved', 'pending', 'suspended'].map((f) => (
                  <button key={f} onClick={() => setVendorFilter(f)} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition ${vendorFilter === f ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                    {f} ({vendors.filter((v: any) => f === 'all' ? true : v.status === f).length})
                  </button>
                ))}
              </div>
            </div>

            {/* Feature 8: Pending Change Requests */}
            {changeRequests.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
                <h3 className="font-bold text-sm text-amber-800 mb-3 flex items-center gap-2">
                  ⏳ Pending Vendor Change Requests ({changeRequests.length})
                </h3>
                <div className="space-y-3">
                  {changeRequests.map((req: any) => (
                    <div key={req.id} className="bg-white rounded-lg border border-slate-200 p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-bold text-sm text-slate-900">{req.vendor?.name}</p>
                          <p className="text-[10px] text-slate-400">Requested {new Date(req.requested_at).toLocaleString()}</p>
                        </div>
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {Object.entries(req.requested_changes).map(([key, newValue]) => (
                          <div key={key} className="flex items-center gap-2 text-xs">
                            <span className="font-semibold text-slate-600 capitalize min-w-[80px]">{key}:</span>
                            <span className="text-red-400 line-through bg-red-50 px-1.5 py-0.5 rounded">{req.current_values[key] || '(empty)'}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-green-700 font-semibold bg-green-50 px-1.5 py-0.5 rounded">{newValue as string}</span>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <button onClick={() => handleChangeRequest(req.id, 'approve')}
                          className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-1.5 rounded-lg transition">✓ Approve</button>
                        <button onClick={() => { const reason = prompt('Reason for rejection (optional):'); handleChangeRequest(req.id, 'reject', reason || undefined) }}
                          className="text-red-500 text-xs font-bold px-4 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition">✗ Reject</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {editingVendor && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setEditingVendor(null)}>
                <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Vendor</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Business Name</label>
                      <input value={editingVendor.name} onChange={e => setEditingVendor({ ...editingVendor, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label>
                      <input value={editingVendor.phone} onChange={e => setEditingVendor({ ...editingVendor, phone: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">WhatsApp</label>
                      <input value={editingVendor.whatsapp} onChange={e => setEditingVendor({ ...editingVendor, whatsapp: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Location</label>
                      <input value={editingVendor.location || ''} onChange={e => setEditingVendor({ ...editingVendor, location: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
                      <textarea value={editingVendor.description || ''} onChange={e => setEditingVendor({ ...editingVendor, description: e.target.value })} rows={3} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button onClick={() => vendorAction('update', editingVendor.id, { name: editingVendor.name, phone: editingVendor.phone, whatsapp: editingVendor.whatsapp, location: editingVendor.location, description: editingVendor.description })} disabled={actionLoading === editingVendor.id} className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingVendor(null)} className="text-slate-500 text-sm font-semibold px-4 py-2">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {filteredVendors.map((vendor: any) => {
                const vendorProducts = products.filter((p: any) => p.vendor_id === vendor.id)
                return (
                  <div key={vendor.id} className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 flex-1">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-purple-500 flex items-center justify-center text-white font-bold flex-shrink-0">{vendor.name.charAt(0)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900">{vendor.name}</h3>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${vendor.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : vendor.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{vendor.status.toUpperCase()}</span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{vendor.location} &bull; {vendor.phone} &bull; {vendorProducts.length} products</p>
                          {vendor.description && <p className="text-xs text-slate-400 mt-1 line-clamp-1">{vendor.description}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => setEditingVendor({ ...vendor })} className="text-[11px] font-semibold text-blue-600 px-2.5 py-1.5 rounded-lg border border-blue-200">Edit</button>
                        {vendor.status === 'pending' && <button onClick={() => vendorAction('approve', vendor.id)} disabled={actionLoading === vendor.id} className="text-[11px] font-semibold text-white bg-emerald-500 px-2.5 py-1.5 rounded-lg disabled:opacity-50">Approve</button>}
                        {vendor.status === 'approved' && <button onClick={() => vendorAction('suspend', vendor.id)} disabled={actionLoading === vendor.id} className="text-[11px] font-semibold text-amber-600 px-2.5 py-1.5 rounded-lg border border-amber-200 disabled:opacity-50">Suspend</button>}
                        {vendor.status === 'suspended' && <button onClick={() => vendorAction('reactivate', vendor.id)} disabled={actionLoading === vendor.id} className="text-[11px] font-semibold text-emerald-600 px-2.5 py-1.5 rounded-lg border border-emerald-200 disabled:opacity-50">Reactivate</button>}
                        <button onClick={() => { if (confirm(`Delete ${vendor.name}?`)) vendorAction('delete', vendor.id) }} disabled={actionLoading === vendor.id} className="text-[11px] font-semibold text-red-500 px-2.5 py-1.5 rounded-lg border border-red-200 disabled:opacity-50">Delete</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {tab === 'products' && (
          <div>
            <h1 className="text-2xl font-black text-slate-900 mb-4">All Products ({products.length})</h1>
            <div className="flex gap-3 mb-4 flex-wrap">
              <input type="text" placeholder="Search name, SKU, or make..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 w-64" />
              <select value={productVendorFilter} onChange={e => setProductVendorFilter(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
                <option value="all">All Vendors</option>
                {vendors.filter((v: any) => v.status === 'approved').map((v: any) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>

            {/* Feature 3: Selection toolbar */}
            {selectedProducts.size > 0 && (
              <div className="flex items-center justify-between mb-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5">
                <span className="text-sm font-bold text-orange-700">{selectedProducts.size} product{selectedProducts.size > 1 ? 's' : ''} selected</span>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedProducts(new Set())} className="text-xs text-slate-500 font-semibold px-3 py-1.5 rounded-lg border border-slate-200">Clear</button>
                  <button onClick={deleteSelectedProducts} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-1.5 rounded-lg">🗑️ Delete Selected</button>
                </div>
              </div>
            )}

            {editingProduct && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setEditingProduct(null)}>
                <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Edit Product</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 mb-1">Name</label>
                      <input value={editingProduct.name} onChange={e => setEditingProduct({ ...editingProduct, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Price (Rs.)</label>
                        <input type="number" value={editingProduct.price || ''} onChange={e => setEditingProduct({ ...editingProduct, price: e.target.value ? parseInt(e.target.value) : null })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity</label>
                        <input type="number" value={editingProduct.quantity} onChange={e => setEditingProduct({ ...editingProduct, quantity: parseInt(e.target.value) || 0 })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Make</label>
                        <input value={editingProduct.make || ''} onChange={e => setEditingProduct({ ...editingProduct, make: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Model</label>
                        <input value={editingProduct.model || ''} onChange={e => setEditingProduct({ ...editingProduct, model: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1">Condition</label>
                        <select value={editingProduct.condition} onChange={e => setEditingProduct({ ...editingProduct, condition: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400">
                          <option>Excellent</option>
                          <option>Good</option>
                          <option>Fair</option>
                          <option>Salvage</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-5">
                    <button onClick={() => productAction('update', editingProduct.id, { name: editingProduct.name, price: editingProduct.price, quantity: editingProduct.quantity, make: editingProduct.make, model: editingProduct.model, condition: editingProduct.condition })} disabled={actionLoading === editingProduct.id} className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">Save</button>
                    <button onClick={() => setEditingProduct(null)} className="text-slate-500 text-sm font-semibold px-4 py-2">Cancel</button>
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-left">
                      <th className="px-4 py-3 w-10"><input type="checkbox" checked={selectedProducts.size > 0 && selectedProducts.size === filteredProducts.length} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 accent-orange-500" /></th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">SKU</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Product</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Vendor</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Price</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Stock</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((product: any, i: number) => (
                      <tr key={product.id} className={`border-t border-slate-100 ${selectedProducts.has(product.id) ? 'bg-orange-50' : i % 2 === 1 ? 'bg-slate-50/50' : ''}`}>
                        <td className="px-4 py-2.5"><input type="checkbox" checked={selectedProducts.has(product.id)} onChange={() => toggleProductSelect(product.id)} className="w-4 h-4 accent-orange-500" /></td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{product.sku}</td>
                        <td className="px-4 py-2.5">
                          <div className="font-semibold text-slate-900">{product.name}</div>
                          {product.make && <div className="text-xs text-slate-400">{product.make} {product.model} {product.year}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">{product.vendor?.name}</td>
                        <td className="px-4 py-2.5 font-bold text-orange-600">{product.price ? 'Rs. ' + product.price.toLocaleString() : 'Ask'}</td>
                        <td className="px-4 py-2.5 text-xs">{product.quantity}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${product.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{product.is_active ? 'ACTIVE' : 'HIDDEN'}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex gap-1">
                            <button onClick={() => setEditingProduct({ ...product })} className="text-[11px] font-semibold text-blue-600 px-2 py-1 rounded border border-blue-200">Edit</button>
                            <button onClick={() => productAction('toggle', product.id)} disabled={actionLoading === product.id} className={`text-[11px] font-semibold px-2 py-1 rounded border disabled:opacity-50 ${product.is_active ? 'text-amber-600 border-amber-200' : 'text-emerald-600 border-emerald-200'}`}>{product.is_active ? 'Hide' : 'Show'}</button>
                            <button onClick={() => { if (confirm(`Delete "${product.name}"?`)) productAction('delete', product.id) }} disabled={actionLoading === product.id} className="text-[11px] font-semibold text-red-500 px-2 py-1 rounded border border-red-200 disabled:opacity-50">Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'keywords' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Search Keywords / Synonyms</h2>
                <p className="text-sm text-slate-500">Group similar words together so searching any word in a group finds products matching all words</p>
              </div>
            </div>

            {/* Add new synonym group */}
            <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
              <h3 className="text-sm font-bold text-slate-700 mb-2">Add New Keyword Group</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newKeywords}
                  onChange={e => setNewKeywords(e.target.value)}
                  placeholder="Enter keywords separated by commas (e.g., bumper, buffer, bumber)"
                  className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                />
                <button
                  onClick={() => {
                    const kws = newKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
                    if (kws.length < 2) { showToast('Need at least 2 keywords'); return }
                    synonymAction('create', undefined, kws)
                  }}
                  disabled={actionLoading === 'new'}
                  className="px-4 py-2 bg-orange-500 text-white text-sm font-bold rounded-lg hover:bg-orange-600 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </div>

            {synonymsLoading ? (
              <div className="text-center py-8 text-slate-400">Loading...</div>
            ) : synonyms.length === 0 ? (
              <div className="text-center py-8 text-slate-400">No keyword groups yet</div>
            ) : (
              <div className="space-y-2">
                {synonyms.map((syn: any) => (
                  <div key={syn.id} className="bg-white rounded-xl border border-slate-200 p-4">
                    {editingSynonym?.id === syn.id ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={editingSynonym.text}
                          onChange={e => setEditingSynonym({ ...editingSynonym, text: e.target.value })}
                          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500"
                        />
                        <button
                          onClick={() => {
                            const kws = editingSynonym.text.split(',').map((k: string) => k.trim().toLowerCase()).filter(Boolean)
                            if (kws.length < 2) { showToast('Need at least 2 keywords'); return }
                            synonymAction('update', syn.id, kws)
                          }}
                          disabled={actionLoading === syn.id}
                          className="px-3 py-2 bg-emerald-500 text-white text-sm font-bold rounded-lg hover:bg-emerald-600 disabled:opacity-50"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingSynonym(null)}
                          className="px-3 py-2 text-sm font-bold text-slate-500 rounded-lg border border-slate-200 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="flex flex-wrap gap-1.5">
                          {(syn.keywords || []).map((kw: string) => (
                            <span key={kw} className="inline-block bg-orange-50 text-orange-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-orange-200">
                              {kw}
                            </span>
                          ))}
                        </div>
                        <div className="flex gap-1 ml-3 shrink-0">
                          <button
                            onClick={() => setEditingSynonym({ id: syn.id, text: (syn.keywords || []).join(', ') })}
                            className="text-[11px] font-semibold text-blue-600 px-2 py-1 rounded border border-blue-200"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { if (confirm('Delete this keyword group?')) synonymAction('delete', syn.id) }}
                            disabled={actionLoading === syn.id}
                            className="text-[11px] font-semibold text-red-500 px-2 py-1 rounded border border-red-200 disabled:opacity-50"
                          >
                            Del
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </main>
    </div>
  )
}