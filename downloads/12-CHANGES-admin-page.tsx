// ============================================================
// CHANGES FOR: src/app/admin/page.tsx
// Features: 3 (multi-select delete), 8 (vendor change approvals)
// ============================================================


// ═══════════════════════════════════════════════════════════
// CHANGE 1: Add new state variables (near other useState)
// ═══════════════════════════════════════════════════════════

  // Feature 3: Multi-select delete
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())

  // Feature 8: Vendor change requests
  const [changeRequests, setChangeRequests] = useState<any[]>([])
  const [changeLoading, setChangeLoading] = useState(false)


// ═══════════════════════════════════════════════════════════
// CHANGE 2: Add helper functions
// ═══════════════════════════════════════════════════════════

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


// ═══════════════════════════════════════════════════════════
// CHANGE 3: Add useEffect to fetch change requests
// ═══════════════════════════════════════════════════════════
// ADD alongside your existing useEffects:

  useEffect(() => { fetchChangeRequests() }, [tab])


// ═══════════════════════════════════════════════════════════
// CHANGE 4: Add change request badge to Vendors tab button
// ═══════════════════════════════════════════════════════════
// FIND the Vendors tab button. It currently looks like:
//   <button key={t} onClick={() => setTab(t)} className={`...`}>
//     {t === 'vendors' ? 'Vendors' : ...}
//
// For the vendors tab text, change it to show a badge:
//   Vendors {changeRequests.length > 0 && <span className="ml-1 bg-amber-500 text-white text-[9px] font-black w-4 h-4 rounded-full inline-flex items-center justify-center">{changeRequests.length}</span>}


// ═══════════════════════════════════════════════════════════
// CHANGE 5: Add change requests section in Vendors tab (Feature 8)
// ═══════════════════════════════════════════════════════════
// In the Vendors tab, ADD this block at the TOP of the tab content
// (before the existing vendor list):

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


// ═══════════════════════════════════════════════════════════
// CHANGE 6: Add multi-select to Products tab table (Feature 3)
// ═══════════════════════════════════════════════════════════
// In the Products tab, ADD a selection toolbar before the table:

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

// In the product table <thead>, ADD a checkbox as FIRST column:
//   <th className="px-4 py-3 w-10"><input type="checkbox" checked={selectedProducts.size > 0 && selectedProducts.size === filteredProducts.length} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 accent-orange-500" /></th>

// In each product <tr>, ADD a checkbox as FIRST cell:
//   <td className="px-4 py-2.5"><input type="checkbox" checked={selectedProducts.has(product.id)} onChange={() => toggleProductSelect(product.id)} className="w-4 h-4 accent-orange-500" /></td>

// Also add to each <tr> className: ${selectedProducts.has(product.id) ? 'bg-orange-50' : ''}
