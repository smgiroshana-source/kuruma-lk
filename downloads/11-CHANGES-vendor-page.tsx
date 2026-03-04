// ============================================================
// CHANGES FOR: src/app/vendor/page.tsx
// ============================================================
// This file is too large (2000+ lines) to provide in full.
// Below are the EXACT search-and-replace blocks.
// Use Ctrl+F in your editor to find each "FIND THIS" block,
// then replace it with the "REPLACE WITH" block.
// ============================================================


// ═══════════════════════════════════════════════════════════
// CHANGE 1: Add new state variables
// ═══════════════════════════════════════════════════════════
// FIND THIS (near the top, after other useState declarations):
//   const [editingCustomer, setEditingCustomer] = useState<any>(null)
//   const [editCustomerLoading, setEditCustomerLoading] = useState(false)
//
// ADD THESE LINES RIGHT AFTER IT:

  // Feature 1,2: Bulk upload duplicate detection + progress
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, phase: '', detail: '' })
  const [bulkDuplicates, setBulkDuplicates] = useState<any[]>([])
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')

  // Feature 3: Multi-select delete
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())

  // Feature 5: Image delete in edit modal
  const [editProductImages, setEditProductImages] = useState<any[]>([])
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)

  // Feature 8: Vendor change request
  const [pendingChangeRequest, setPendingChangeRequest] = useState<any>(null)


// ═══════════════════════════════════════════════════════════
// CHANGE 2: Add Feature 8 effect — fetch pending change request
// ═══════════════════════════════════════════════════════════
// FIND THIS:
//   useEffect(() => {
//     if (tab === 'settings') {
//       fetchSettings()
//       fetchStaff()
//     }
//   }, [tab])
//
// REPLACE WITH:

  useEffect(() => {
    if (tab === 'settings') {
      fetchSettings()
      fetchStaff()
      // Feature 8: Check for pending change requests
      fetch('/api/vendor/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_change_request' })
      }).then(r => r.json()).then(j => {
        if (j.request) setPendingChangeRequest(j.request)
        else setPendingChangeRequest(null)
      }).catch(() => {})
    }
  }, [tab])


// ═══════════════════════════════════════════════════════════
// CHANGE 3: Add multi-select delete helpers (Feature 3)
// ═══════════════════════════════════════════════════════════
// ADD these functions right AFTER the existing productAction function:

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
      const r = await fetch('/api/vendor/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_delete', productIds: [...selectedProducts] })
      })
      const j = await r.json()
      if (j.success) { showToast(j.message); setSelectedProducts(new Set()); await fetchData() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
  }


// ═══════════════════════════════════════════════════════════
// CHANGE 4: Add image delete helper (Feature 5)
// ═══════════════════════════════════════════════════════════
// ADD this function right AFTER deleteSelectedProducts:

  async function deleteProductImage(imageId: string) {
    if (!confirm('Delete this image?')) return
    setDeletingImageId(imageId)
    try {
      const r = await fetch('/api/vendor/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', imageId })
      })
      const j = await r.json()
      if (j.success) {
        setEditProductImages(prev => prev.filter((img: any) => img.id !== imageId))
        showToast('Image deleted')
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setDeletingImageId(null)
  }


// ═══════════════════════════════════════════════════════════
// CHANGE 5: Replace handleBulkImport (Features 1 & 2)
// ═══════════════════════════════════════════════════════════
// FIND THIS (the entire handleBulkImport function):
//   async function handleBulkImport() { if (!bulkData.length) return; const noImg = bulkData.filter(r => !r.hasImage).length; if (noImg > 0 && !confirm(noImg + ' without images. Continue?')) return; setBulkLoading(true); try { const r = await fetch('/api/vendor/products' ...
//
// REPLACE THE ENTIRE handleBulkImport function with these TWO functions:

  async function handleBulkImport() {
    if (!bulkData.length) return
    const noImg = bulkData.filter(r => !r.hasImage).length
    if (noImg > 0 && !confirm(noImg + ' without images. Continue?')) return

    setBulkProgress({ current: 0, total: bulkData.length, phase: 'Checking for duplicates...', detail: '' })
    setBulkLoading(true)

    try {
      const skus = bulkData.map(r => r.partId).filter(Boolean)
      const checkRes = await fetch('/api/vendor/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bulk_check_skus', skus })
      })
      const checkJson = await checkRes.json()

      if (checkJson.duplicates && checkJson.duplicates.length > 0) {
        setBulkDuplicates(checkJson.duplicates)
        setShowDuplicateModal(true)
        setBulkLoading(false)
        setBulkProgress({ current: 0, total: 0, phase: '', detail: '' })
        return
      }

      await executeBulkImport('skip')
    } catch {
      showToast('Network error')
      setBulkLoading(false)
      setBulkProgress({ current: 0, total: 0, phase: '', detail: '' })
    }
  }

  async function executeBulkImport(mode: 'skip' | 'update') {
    setShowDuplicateModal(false)
    setBulkLoading(true)
    const totalSteps = bulkData.length + 1

    try {
      setBulkProgress({ current: 0, total: totalSteps, phase: 'Creating products...', detail: 'Sending product data to server' })

      const r = await fetch('/api/vendor/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_create',
          mode,
          products: bulkData.map(row => ({
            sku: row.partId, name: row.name, description: row.description,
            category: row.category, make: row.make, model: row.model,
            year: row.year, condition: row.condition, price: row.price,
            quantity: row.quantity, show_price: row.show_price
          }))
        })
      })
      const j = await r.json()

      if (!j.success) {
        showToast('Error: ' + j.error)
        setBulkLoading(false)
        setBulkProgress({ current: 0, total: 0, phase: '', detail: '' })
        return
      }

      setBulkProgress(prev => ({ ...prev, current: 1, phase: 'Uploading images...', detail: `${j.count} products created` }))

      // Upload images with progress
      let imageCount = 0
      const skuToId = new Map()
      if (j.products) j.products.forEach((p: any) => skuToId.set(p.sku, p.id))

      for (let i = 0; i < bulkData.length; i++) {
        const row = bulkData[i]
        if (!row?.imageFiles?.length) continue
        const productId = skuToId.get(row.partId)
        if (!productId) continue

        setBulkProgress(prev => ({
          ...prev,
          current: 1 + Math.round((imageCount / Math.max(bulkData.filter(r => r?.imageFiles?.length).length, 1)) * (totalSteps - 1)),
          phase: 'Uploading images...',
          detail: `${row.partId}: ${row.imageFiles.length} image${row.imageFiles.length > 1 ? 's' : ''}`
        }))

        await uploadImagesForProduct(productId, row.imageFiles)
        imageCount += row.imageFiles.length
      }

      setBulkProgress({ current: totalSteps, total: totalSteps, phase: 'Complete!', detail: '' })

      const summary = []
      if (j.insertedCount) summary.push(`${j.insertedCount} new`)
      if (j.updatedCount) summary.push(`${j.updatedCount} updated`)
      if (j.skippedCount) summary.push(`${j.skippedCount} skipped`)
      if (imageCount) summary.push(`${imageCount} images`)
      showToast(summary.join(', ') + ' — Import complete!')

      setBulkData([]); setBulkFile(''); setZipFile(''); setZipSummary(null); setBulkDuplicates([])
      await fetchData(); setTab('products')
    } catch { showToast('Import failed') }

    setBulkLoading(false)
    setTimeout(() => setBulkProgress({ current: 0, total: 0, phase: '', detail: '' }), 3000)
  }


// ═══════════════════════════════════════════════════════════
// CHANGE 6: Replace updateShopInfo for Feature 8
// ═══════════════════════════════════════════════════════════
// FIND THIS:
//   async function updateShopInfo(fields: any) {
//     try {
//       const res = await fetch('/api/vendor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_vendor', ...fields }) })
//       if (res.ok) { showToast('Shop info updated!'); fetchData() }
//     } catch { showToast('Error updating shop info') }
//   }
//
// REPLACE WITH:

  async function updateShopInfo(fields: any) {
    try {
      const res = await fetch('/api/vendor/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_vendor', ...fields })
      })
      const j = await res.json()
      if (j.success) {
        if (j.pendingApproval) {
          showToast(j.message)
          // Refresh pending change request
          fetch('/api/vendor/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get_change_request' })
          }).then(r => r.json()).then(jr => {
            if (jr.request) setPendingChangeRequest(jr.request)
          }).catch(() => {})
        } else {
          showToast('Shop info updated!')
        }
        fetchData()
      } else {
        showToast('Error: ' + (j.error || 'Failed'))
      }
    } catch { showToast('Error updating shop info') }
  }


// ═══════════════════════════════════════════════════════════
// CHANGE 7: Modify editingProduct to load images (Feature 5)
// ═══════════════════════════════════════════════════════════
// FIND every place where setEditingProduct is called to open the edit modal.
// It looks like: onClick={() => setEditingProduct({ ...product })}
// REPLACE WITH:
//   onClick={() => { setEditingProduct({ ...product }); setEditProductImages(product.images || []) }}


// ═══════════════════════════════════════════════════════════
// CHANGE 8: Add image management to edit product modal (Feature 5)
// ═══════════════════════════════════════════════════════════
// Inside the edit product modal, FIND the Save button area:
//   <div className="flex gap-2 mt-5"><button onClick={() => productAction('update', editingProduct.id, { sku: editingProduct.sku ...
//
// ADD THIS BLOCK *BEFORE* that div (before the Save button):

            {/* Feature 5: Existing Images with Delete */}
            {editProductImages.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2">Current Images ({editProductImages.length})</label>
                <div className="flex gap-2 flex-wrap">
                  {editProductImages.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)).map((img: any, i: number) => (
                    <div key={img.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                      <img src={img.url} alt={`Image ${i + 1}`} className="w-full h-full object-cover" />
                      <button onClick={() => deleteProductImage(img.id)} disabled={deletingImageId === img.id}
                        className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                        {deletingImageId === img.id
                          ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <span className="bg-red-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-lg">✕</span>}
                      </button>
                      {i === 0 && <span className="absolute bottom-0.5 left-0.5 bg-orange-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">PRIMARY</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Hover and click ✕ to delete</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Add More Images</label>
              <input type="file" accept="image/*" multiple onChange={async (e) => {
                const files = Array.from(e.target.files || [])
                if (files.length === 0 || !editingProduct) return
                showToast('Uploading...')
                await uploadImagesForProduct(editingProduct.id, files)
                await fetchData()
                const r = await fetch('/api/vendor/data'); if (r.ok) { const json = await r.json(); const updated = json.products.find((p: any) => p.id === editingProduct.id); if (updated) setEditProductImages(updated.images || []) }
                showToast('Images uploaded!')
              }} className="w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-50 file:text-orange-600 hover:file:bg-orange-100" />
            </div>


// ═══════════════════════════════════════════════════════════
// CHANGE 9: Add checkbox column to Products tab table (Feature 3)
// ═══════════════════════════════════════════════════════════
// In the Products tab, FIND the search input area and add the delete bar:
// FIND: <input type="text" placeholder="Search products..."
// WRAP IT with this:

            {/* Feature 3: Selection toolbar */}
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <input type="text" placeholder="Search products..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 w-56" />
                {selectedProducts.size > 0 && <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full">{selectedProducts.size} selected</span>}
              </div>
              {selectedProducts.size > 0 && (
                <button onClick={deleteSelectedProducts} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5">🗑️ Delete {selectedProducts.size} Item{selectedProducts.size > 1 ? 's' : ''}</button>
              )}
            </div>

// In the products table <thead>, ADD a checkbox column as the FIRST <th>:
//   <th className="px-3 py-2.5 w-10"><input type="checkbox" checked={selectedProducts.size > 0 && selectedProducts.size === filteredProducts.length} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 accent-orange-500" /></th>

// In each product row <tr>, ADD a checkbox as the FIRST <td>:
//   <td className="px-3 py-2.5"><input type="checkbox" checked={selectedProducts.has(product.id)} onChange={() => toggleProductSelect(product.id)} className="w-4 h-4 accent-orange-500" /></td>

// Also add to the <tr> className: ${selectedProducts.has(product.id) ? 'bg-orange-50' : ''}


// ═══════════════════════════════════════════════════════════
// CHANGE 10: Add progress bar in Bulk tab (Feature 2)
// ═══════════════════════════════════════════════════════════
// In the Bulk tab, FIND the "Import All" button area:
//   <button onClick={handleBulkImport} disabled={bulkLoading} className="bg-orange-500 ...
//
// ADD THIS BLOCK right AFTER the button row div closes:

            {/* Feature 2: Import Progress Bar */}
            {bulkLoading && bulkProgress.total > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4 mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700">{bulkProgress.phase}</span>
                  <span className="text-xs font-mono text-slate-400">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500 ease-out" style={{
                    width: `${Math.round((bulkProgress.current / bulkProgress.total) * 100)}%`,
                    background: bulkProgress.phase === 'Complete!' ? 'linear-gradient(90deg, #06D6A0, #10B981)' : 'linear-gradient(90deg, #FF6B35, #F59E0B)'
                  }} />
                </div>
                {bulkProgress.detail && <p className="text-xs text-slate-400 mt-1.5">{bulkProgress.detail}</p>}
              </div>
            )}


// ═══════════════════════════════════════════════════════════
// CHANGE 11: Add Duplicate Warning Modal (Feature 1)
// ═══════════════════════════════════════════════════════════
// ADD THIS right before the final closing </div> of the Bulk tab section:

            {/* Feature 1: Duplicate SKU Warning Modal */}
            {showDuplicateModal && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDuplicateModal(false)}>
                <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="bg-amber-50 border-b border-amber-200 px-5 py-4">
                    <h3 className="font-bold text-base text-amber-800 flex items-center gap-2">⚠️ {bulkDuplicates.length} Duplicate SKU{bulkDuplicates.length > 1 ? 's' : ''} Found</h3>
                    <p className="text-xs text-amber-600 mt-1">These Part IDs already exist in your shop. Choose how to handle them:</p>
                  </div>
                  <div className="px-5 py-3 max-h-48 overflow-y-auto border-b border-slate-100">
                    {bulkDuplicates.map((d: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                        <span className="font-mono text-xs font-bold text-slate-700">{d.sku}</span>
                        <span className="text-xs text-slate-400 truncate ml-3">{d.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-4 space-y-2">
                    <label className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition hover:bg-slate-50" style={{ borderColor: duplicateAction === 'skip' ? '#FF6B35' : '#E2E8F0' }} onClick={() => setDuplicateAction('skip')}>
                      <input type="radio" name="dupAction" checked={duplicateAction === 'skip'} onChange={() => setDuplicateAction('skip')} className="mt-0.5 accent-orange-500" />
                      <div><span className="font-bold text-sm text-slate-800">Skip Duplicates</span><p className="text-xs text-slate-400 mt-0.5">Only import new products. Existing ones stay unchanged.</p></div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition hover:bg-slate-50" style={{ borderColor: duplicateAction === 'update' ? '#FF6B35' : '#E2E8F0' }} onClick={() => setDuplicateAction('update')}>
                      <input type="radio" name="dupAction" checked={duplicateAction === 'update'} onChange={() => setDuplicateAction('update')} className="mt-0.5 accent-orange-500" />
                      <div><span className="font-bold text-sm text-slate-800">Update Existing</span><p className="text-xs text-slate-400 mt-0.5">Overwrite duplicate products with the new CSV data.</p></div>
                    </label>
                  </div>
                  <div className="px-5 py-3 bg-slate-50 flex gap-2 justify-end rounded-b-2xl">
                    <button onClick={() => { setShowDuplicateModal(false); setBulkLoading(false) }} className="text-sm text-slate-500 px-4 py-2 font-semibold">Cancel</button>
                    <button onClick={() => executeBulkImport(duplicateAction)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-5 py-2 rounded-lg">
                      {duplicateAction === 'skip' ? `Import ${bulkData.length - bulkDuplicates.length} New` : `Import & Update All ${bulkData.length}`}
                    </button>
                  </div>
                </div>
              </div>
            )}


// ═══════════════════════════════════════════════════════════
// CHANGE 12: Add pending changes banner in Settings tab (Feature 8)
// ═══════════════════════════════════════════════════════════
// In the Settings tab section, FIND:
//   <h3 className="font-bold text-sm mb-4">Shop Information</h3>
//
// ADD THIS BLOCK *BEFORE* that line:

            {/* Feature 8: Pending Changes Banner */}
            {pendingChangeRequest && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-2">
                  <span className="text-lg">⏳</span>
                  <div>
                    <h3 className="font-bold text-sm text-amber-800">Pending Changes Awaiting Admin Approval</h3>
                    <p className="text-xs text-amber-600 mt-1">You requested changes to: {Object.keys(pendingChangeRequest.requested_changes).join(', ')}</p>
                    <div className="mt-2 space-y-1">
                      {Object.entries(pendingChangeRequest.requested_changes).map(([key, value]) => (
                        <div key={key} className="text-xs flex items-center gap-2">
                          <span className="font-semibold text-slate-600 capitalize w-20">{key}:</span>
                          <span className="text-slate-400 line-through">{(pendingChangeRequest.current_values as any)[key]}</span>
                          <span className="text-orange-500">→</span>
                          <span className="font-semibold text-slate-800">{value as string}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-amber-500 mt-2">Submitted {new Date(pendingChangeRequest.requested_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            )}
