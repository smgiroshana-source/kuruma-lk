'use client'
import { useState, useEffect, useRef } from 'react'

// ── Types ────────────────────────────────────────────────────────────────────

interface Vendor {
  id: string
  name: string
}

interface Product {
  id: string
  name: string
  sku?: string
  quantity: number
  [key: string]: unknown
}

interface TransferItem {
  fromProductId: string
  fromProductName: string
  fromProductSku: string
  fromProductQty: number
  quantity: number
  transferCost: number | ''
  transferPrice: number | ''
  notes: string
}

interface PreviewRow {
  fromProductId: string
  fromProductName: string
  fromProductSku: string
  fromProductQty: number
  quantity: number
  transferCost: number | null
  transferPrice: number | null
  notes: string
  destProduct: { id: string; name: string; quantity: number } | null
  willCreate: boolean
  error: string | null
}

interface HistoryRow {
  id: string
  from_product_name: string
  from_product_sku: string
  to_vendor_name: string
  to_product_name: string
  quantity: number
  transfer_cost: number | null
  transfer_price: number | null
  notes: string | null
  transferred_at: string
  status?: 'pending' | 'accepted' | 'rejected'
  reject_reason?: string | null
}

interface IncomingItem {
  id: string
  name: string
  sku: string
  quantity: number
  transferCost: number | null
  transferPrice: number | null
  notes: string | null
}

interface IncomingBatch {
  key: string
  batchId: string | null
  status: 'pending' | 'accepted' | 'rejected'
  fromVendor: string
  sentAt: string
  settledAt: string | null
  rejectReason: string | null
  items: IncomingItem[]
  totalUnits: number
}

interface CsvParsedRow {
  sku: string
  quantity: number
  transferCost: number | ''
  transferPrice: number | ''
  notes: string
  matched: boolean
  fromProductId: string | null
  fromProductName: string
  fromProductQty: number
}

export interface StockTransferProps {
  vendor: unknown           // current logged-in vendor (source)
  products: Product[]
  showToast: (msg: string) => void
  onDataChanged: () => void
}

// ── CSV parser ───────────────────────────────────────────────────────────────

function parseTransferCsv(text: string): Array<{
  sku: string
  quantity: number
  transferCost: number | ''
  transferPrice: number | ''
  notes: string
}> {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  // Detect delimiter: prefer comma, fall back to semicolon
  const headerLine = lines[0]
  const delimiter = headerLine.includes(';') && !headerLine.includes(',') ? ';' : ','

  const headers = headerLine.split(delimiter).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))

  return lines.slice(1)
    .filter(l => l.trim())
    .map(line => {
      const values: string[] = []
      let cur = '', inQ = false
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ }
        else if (ch === delimiter && !inQ) { values.push(cur.trim()); cur = '' }
        else { cur += ch }
      }
      values.push(cur.trim())

      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = (values[i] || '').replace(/^"|"$/g, '').trim() })

      const sku = row['sku']?.trim() ?? ''
      if (!sku) return null

      const rawQty = parseInt(row['quantity'] ?? '0', 10)
      const quantity = rawQty > 0 ? rawQty : 0
      if (!quantity) return null

      const rawCost  = parseInt(row['transfer_cost'] ?? '', 10)
      const rawPrice = parseInt(row['transfer_price'] ?? '', 10)

      return {
        sku,
        quantity,
        transferCost:  Number.isFinite(rawCost)  && rawCost  >= 0 ? rawCost  : '' as const,
        transferPrice: Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : '' as const,
        notes: row['notes']?.trim() ?? '',
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)
}

// ── Spinner ──────────────────────────────────────────────────────────────────

function Spinner({ sm }: { sm?: boolean }) {
  return (
    <svg
      className={`animate-spin ${sm ? 'h-4 w-4' : 'h-5 w-5'} text-indigo-500`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  )
}

// ── Preview table (shared) ───────────────────────────────────────────────────

function PreviewTable({ rows }: { rows: PreviewRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-indigo-50 text-indigo-800 text-xs uppercase tracking-wide">
            <th className="px-3 py-2 text-left">Product</th>
            <th className="px-3 py-2 text-left">SKU</th>
            <th className="px-2 py-2 text-right">Qty</th>
            <th className="px-2 py-2 text-right">Transfer Cost</th>
            <th className="px-2 py-2 text-right">Transfer Price</th>
            <th className="px-3 py-2 text-left">Destination</th>
            <th className="px-3 py-2 text-left">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.fromProductId + i} className={`border-t border-slate-100 ${row.error ? 'bg-red-50' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
              <td className="px-3 py-2 font-medium text-slate-800">{row.fromProductName}</td>
              <td className="px-3 py-2 text-slate-500 font-mono text-xs">{row.fromProductSku || '—'}</td>
              <td className="px-2 py-2 text-right text-slate-700">{row.quantity}</td>
              <td className="px-2 py-2 text-right text-slate-700">
                {row.transferCost != null ? `Rs. ${row.transferCost.toLocaleString()}` : '—'}
              </td>
              <td className="px-2 py-2 text-right text-slate-700">
                {row.transferPrice != null ? `Rs. ${row.transferPrice.toLocaleString()}` : '—'}
              </td>
              <td className="px-3 py-2 text-slate-600 text-xs">
                {row.destProduct ? row.destProduct.name : (row.willCreate ? 'Not stocked there yet' : '—')}
              </td>
              <td className="px-3 py-2">
                {row.error ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                    ❌ {row.error}
                  </span>
                ) : row.willCreate ? (
                  <span title="The destination shop has no product with this SKU, so the transfer creates one there — same SKU, name and photos, stocked with the quantity you send."
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                    ★ Adds it to their catalogue
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                    ✓ Tops up their existing stock
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function StockTransfer({ vendor, products, showToast, onDataChanged }: StockTransferProps) {
  // Mode
  const [mode, setMode] = useState<'manual' | 'csv'>('manual')

  // Vendors
  const [otherVendors, setOtherVendors] = useState<Vendor[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)
  const [toVendorId, setToVendorId] = useState('')

  // Manual mode
  const [productSearch, setProductSearch] = useState('')
  const [transferItems, setTransferItems] = useState<TransferItem[]>([])

  // Preview / execute
  const [previewRows, setPreviewRows] = useState<PreviewRow[] | null>(null)
  const [destVendorName, setDestVendorName] = useState('')
  const [previewing, setPreviewing] = useState(false)
  const [executing, setExecuting] = useState(false)

  // CSV mode
  const [csvParsed, setCsvParsed] = useState<CsvParsedRow[] | null>(null)
  const [csvFileName, setCsvFileName] = useState('')
  const csvInputRef = useRef<HTMLInputElement>(null)

  // Incoming — shipments other shops have sent to us
  const [incoming, setIncoming] = useState<IncomingBatch[]>([])
  const [incomingRecent, setIncomingRecent] = useState<IncomingBatch[]>([])
  const [answering, setAnswering] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<IncomingBatch | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  // History
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // ── Load vendors on mount ──────────────────────────────────────────────────

  useEffect(() => {
    fetchOtherVendors()
    fetchIncoming()
  }, [])

  async function fetchIncoming() {
    try {
      const r = await fetch('/api/vendor/stock-transfer?action=incoming')
      if (r.ok) {
        const j = await r.json()
        setIncoming(j.pending || [])
        setIncomingRecent(j.recent || [])
      }
    } catch {}
  }

  // Nothing lands in this shop's stock until someone here says so.
  async function answerShipment(batch: IncomingBatch, accept: boolean, reason?: string) {
    setAnswering(batch.key)
    try {
      const r = await fetch('/api/vendor/stock-transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: accept ? 'accept' : 'reject', batchId: batch.batchId, reason }),
      })
      const j = await r.json()
      if (j.success) {
        showToast((accept ? '\u2705 ' : '\u21a9 ') + j.message)
        if (j.errors?.length) j.errors.forEach((e: string) => showToast('\u26a0\ufe0f ' + e))
        setRejecting(null); setRejectReason('')
        fetchIncoming(); onDataChanged()
      } else showToast('\u26a0\ufe0f ' + (j.error || 'Could not complete'))
    } catch { showToast('Network error') }
    setAnswering(null)
  }

  async function fetchOtherVendors() {
    setVendorsLoading(true)
    try {
      const r = await fetch('/api/vendor/stock-transfer?action=list_vendors')
      if (r.ok) {
        const j = await r.json()
        setOtherVendors(j.vendors || [])
        if (j.vendors?.length === 1) setToVendorId(j.vendors[0].id)
      }
    } catch {}
    setVendorsLoading(false)
  }

  async function fetchHistory() {
    setHistoryLoading(true)
    try {
      const r = await fetch('/api/vendor/stock-transfer?action=history')
      if (r.ok) {
        const j = await r.json()
        setHistory(j.transfers || [])
      }
    } catch {}
    setHistoryLoading(false)
  }

  function handleHistoryToggle() {
    const next = !historyOpen
    setHistoryOpen(next)
    if (next && history.length === 0) fetchHistory()
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function productAlreadyAdded(productId: string) {
    return transferItems.some(i => i.fromProductId === productId)
  }

  function addProductToTransfer(product: Product) {
    if (productAlreadyAdded(product.id)) return
    setTransferItems(prev => [...prev, {
      fromProductId: product.id,
      fromProductName: product.name,
      fromProductSku: product.sku ?? '',
      fromProductQty: product.quantity,
      quantity: 1,
      transferCost: '',
      transferPrice: '',
      notes: '',
    }])
    setProductSearch('')
  }

  function removeTransferItem(productId: string) {
    setTransferItems(prev => prev.filter(i => i.fromProductId !== productId))
    setPreviewRows(null)
  }

  function updateTransferItem<K extends keyof TransferItem>(productId: string, field: K, value: TransferItem[K]) {
    setTransferItems(prev => prev.map(i => i.fromProductId === productId ? { ...i, [field]: value } : i))
    setPreviewRows(null)
  }

  function itemsFromTransferList(): Array<{ fromProductId: string; quantity: number; transferCost: number | null; transferPrice: number | null; notes: string }> {
    return transferItems.map(i => ({
      fromProductId: i.fromProductId,
      quantity: i.quantity,
      transferCost:  i.transferCost  === '' ? null : i.transferCost,
      transferPrice: i.transferPrice === '' ? null : i.transferPrice,
      notes: i.notes,
    }))
  }

  function itemsFromCsv(): Array<{ fromProductId: string; quantity: number; transferCost: number | null; transferPrice: number | null; notes: string }> {
    if (!csvParsed) return []
    return csvParsed
      .filter(r => r.matched && r.fromProductId)
      .map(r => ({
        fromProductId: r.fromProductId!,
        quantity: r.quantity,
        transferCost:  r.transferCost  === '' ? null : r.transferCost,
        transferPrice: r.transferPrice === '' ? null : r.transferPrice,
        notes: r.notes,
      }))
  }

  function currentItems() {
    return mode === 'manual' ? itemsFromTransferList() : itemsFromCsv()
  }

  function canPreview() {
    if (!toVendorId) return false
    const items = currentItems()
    if (items.length === 0) return false
    if (mode === 'manual') {
      return transferItems.every(i => i.quantity >= 1 && i.quantity <= i.fromProductQty)
    }
    return items.length > 0
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  async function runPreview() {
    if (!canPreview()) { showToast('Select a destination and add at least one item'); return }
    setPreviewing(true)
    setPreviewRows(null)
    try {
      const r = await fetch('/api/vendor/stock-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview', toVendorId, items: currentItems() }),
      })
      const j = await r.json()
      if (r.ok && j.success) {
        setPreviewRows(j.previews ?? [])
        setDestVendorName(j.destVendorName ?? '')
      } else {
        showToast('⚠️ ' + (j.error ?? 'Preview failed'))
      }
    } catch { showToast('Network error') }
    setPreviewing(false)
  }

  // ── Execute ────────────────────────────────────────────────────────────────

  async function runExecute() {
    if (!previewRows || previewRows.some(r => r.error)) { showToast('Fix errors before confirming'); return }
    if (!confirm(`Transfer ${previewRows.length} item(s) to ${destVendorName}?`)) return
    setExecuting(true)
    try {
      const r = await fetch('/api/vendor/stock-transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', toVendorId, items: currentItems() }),
      })
      const j = await r.json()
      if (r.ok && j.success) {
        if (j.errors && j.errors.length > 0) {
          // Partial success — make the failures visible instead of a success-only toast
          showToast(`⚠️ ${j.transferred} transferred, ${j.errors.length} failed: ${j.errors.join('; ')}`)
        } else {
          showToast(`✅ ${j.transferred} item(s) transferred to ${destVendorName}`)
        }
        resetForm()
        onDataChanged()
        // Refresh history if open
        if (historyOpen) fetchHistory()
      } else {
        showToast('⚠️ ' + (j.error ?? 'Transfer failed'))
      }
    } catch { showToast('Network error') }
    setExecuting(false)
  }

  function resetForm() {
    setTransferItems([])
    setCsvParsed(null)
    setCsvFileName('')
    setPreviewRows(null)
    setDestVendorName('')
    setProductSearch('')
    if (csvInputRef.current) csvInputRef.current.value = ''
  }

  // ── Filtered products for manual search ────────────────────────────────────

  const filteredProducts = productSearch.trim().length >= 1
    ? products.filter(p => {
        const q = productSearch.toLowerCase()
        return (
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q)
        )
      }).slice(0, 20)
    : []

  // ── CSV mode ───────────────────────────────────────────────────────────────

  function downloadCsvTemplate() {
    const csv = [
      'sku,quantity,transfer_cost,transfer_price,notes',
      'NGK-BKR5E,5,1200,2500,Sending to branch',
      'TOY-AIR-001,2,,8500,',
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'stock-transfer-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  function handleCsvUpload(file: File) {
    setCsvFileName(file.name)
    setPreviewRows(null)
    const reader = new FileReader()
    reader.onload = e => {
      const text = e.target?.result as string
      const rows = parseTransferCsv(text)
      const parsed: CsvParsedRow[] = rows.map(row => {
        const match = products.find(p => (p.sku ?? '').toLowerCase() === row.sku.toLowerCase())
        return {
          sku: row.sku,
          quantity: row.quantity,
          transferCost: row.transferCost,
          transferPrice: row.transferPrice,
          notes: row.notes,
          matched: !!match,
          fromProductId: match ? match.id : null,
          fromProductName: match ? match.name : '',
          fromProductQty: match ? match.quantity : 0,
        }
      })
      setCsvParsed(parsed)
    }
    reader.readAsText(file)
  }

  function updateCsvRow<K extends keyof CsvParsedRow>(idx: number, field: K, value: CsvParsedRow[K]) {
    setCsvParsed(prev => {
      if (!prev) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], [field]: value }
      return next
    })
    setPreviewRows(null)
  }

  // ── Preview has errors? ────────────────────────────────────────────────────

  const previewHasErrors = previewRows != null && previewRows.some(r => r.error)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Incoming shipments ──────────────────────────────────────────────
          Stock sent by another shop is IN TRANSIT until someone here answers:
          it has left their shelf and is on nobody's until accepted. Accept is
          the big green target; Reject is deliberately small and quiet, because
          accepting is the normal answer and rejecting sends goods back across
          town. */}
      {incoming.length > 0 && (
        <div className="bg-white rounded-xl border-2 border-emerald-300 shadow-sm overflow-hidden">
          <div className="bg-emerald-50 px-5 py-3 border-b border-emerald-200">
            <h2 className="font-bold text-emerald-900">
              📦 {incoming.length} shipment{incoming.length !== 1 ? 's' : ''} waiting for you
            </h2>
            <p className="text-xs text-emerald-700 mt-0.5">
              Nothing is added to your stock until you accept.
            </p>
          </div>
          {incoming.map(b => (
            <div key={b.key} className="px-5 py-4 border-b border-slate-100 last:border-b-0">
              <div className="flex items-baseline justify-between gap-2 flex-wrap mb-2">
                <p className="font-bold text-slate-800 text-sm">
                  From {b.fromVendor}
                  <span className="font-normal text-slate-400"> · {b.items.length} product{b.items.length !== 1 ? 's' : ''} · {b.totalUnits} unit{b.totalUnits !== 1 ? 's' : ''}</span>
                </p>
                <p className="text-[11px] text-slate-400">{new Date(b.sentAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}</p>
              </div>

              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 mb-3">
                {b.items.map(it => (
                  <div key={it.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="flex-1 text-slate-700">
                      {it.name}
                      {it.sku && <span className="text-slate-400 font-mono text-xs"> · {it.sku}</span>}
                      {it.notes && <span className="block text-[11px] text-slate-400 italic">{it.notes}</span>}
                    </span>
                    <span className="font-bold text-slate-800">×{it.quantity}</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => answerShipment(b, true)}
                  disabled={answering === b.key}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-black py-3.5 rounded-xl text-base"
                >
                  {answering === b.key ? 'Working…' : `✓ Accept — add ${b.totalUnits} unit${b.totalUnits !== 1 ? 's' : ''} to stock`}
                </button>
                <button
                  onClick={() => { setRejecting(b); setRejectReason('') }}
                  disabled={answering === b.key}
                  className="text-xs font-semibold text-slate-400 hover:text-red-600 underline underline-offset-2 px-2 py-3"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject needs a reason — the sending shop gets the stock back and has
          to know why it came back. */}
      {rejecting && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setRejecting(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">Reject this shipment?</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">
              All {rejecting.totalUnits} unit{rejecting.totalUnits !== 1 ? 's' : ''} go back to {rejecting.fromVendor}&apos;s stock.
              Nothing is added here.
            </p>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Why? (they will see this)</label>
            <input
              type="text" value={rejectReason} autoFocus
              onChange={e => setRejectReason(e.target.value)}
              placeholder="e.g. wrong tyre size, damaged in transit"
              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-red-400"
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRejecting(null)}
                className="flex-1 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">
                Keep waiting
              </button>
              <button
                onClick={() => answerShipment(rejecting, false, rejectReason)}
                disabled={!rejectReason.trim() || answering === rejecting.key}
                className="px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm font-bold"
              >
                {answering === rejecting.key ? 'Working…' : 'Send it back'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header card */}
      <div className="bg-white rounded-xl border border-indigo-100 p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold text-indigo-800">Inter-Vendor Stock Transfer</h2>
            <p className="text-sm text-slate-500 mt-0.5">Move stock to another vendor's inventory</p>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-lg border border-indigo-200 overflow-hidden text-sm font-semibold">
            <button
              onClick={() => { setMode('manual'); setPreviewRows(null) }}
              className={`px-4 py-2 transition-colors ${mode === 'manual' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
            >
              Manual
            </button>
            <button
              onClick={() => { setMode('csv'); setPreviewRows(null) }}
              className={`px-4 py-2 transition-colors ${mode === 'csv' ? 'bg-indigo-600 text-white' : 'bg-white text-indigo-600 hover:bg-indigo-50'}`}
            >
              CSV Upload
            </button>
          </div>
        </div>

        {/* Destination vendor */}
        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
            Transfer To
          </label>
          {vendorsLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Spinner sm /> Loading vendors…</div>
          ) : otherVendors.length === 0 ? (
            <p className="text-sm text-slate-400">No other vendors found.</p>
          ) : (
            <select
              value={toVendorId}
              onChange={e => { setToVendorId(e.target.value); setPreviewRows(null) }}
              className="w-full sm:w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">— Select destination vendor —</option>
              {otherVendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* ── MANUAL MODE ─────────────────────────────────────────────────── */}
        {mode === 'manual' && (
          <div className="space-y-4">
            {/* Product search */}
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5">
                Search &amp; Add Products
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                  placeholder="Type product name or SKU…"
                  className="w-full sm:w-96 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                {filteredProducts.length > 0 && (
                  <div className="absolute z-20 left-0 top-full mt-1 w-full sm:w-96 bg-white rounded-xl border border-slate-200 shadow-lg max-h-60 overflow-y-auto">
                    {filteredProducts.map(p => {
                      const alreadyAdded = productAlreadyAdded(p.id)
                      return (
                        <button
                          key={p.id}
                          onClick={() => addProductToTransfer(p)}
                          disabled={alreadyAdded || p.quantity === 0}
                          className={`w-full text-left flex items-center justify-between px-3 py-2.5 text-sm border-b border-slate-100 last:border-0 transition-colors
                            ${alreadyAdded ? 'bg-slate-50 text-slate-400 cursor-default' : p.quantity === 0 ? 'bg-slate-50 text-slate-400 cursor-default' : 'hover:bg-indigo-50 text-slate-700 cursor-pointer'}`}
                        >
                          <div>
                            <span className="font-medium">{p.name}</span>
                            {p.sku && <span className="ml-2 text-xs text-slate-400 font-mono">{p.sku}</span>}
                          </div>
                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${p.quantity === 0 ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-700'}`}>
                              {p.quantity === 0 ? 'Out of stock' : `Qty: ${p.quantity}`}
                            </span>
                            {alreadyAdded && <span className="text-xs text-indigo-400">Added</span>}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
              {productSearch.trim().length >= 1 && filteredProducts.length === 0 && (
                <p className="mt-1 text-xs text-slate-400">No products match "{productSearch}"</p>
              )}
            </div>

            {/* Transfer item list */}
            {transferItems.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Transfer List ({transferItems.length})</p>
                {transferItems.map(item => (
                  <div
                    key={item.fromProductId}
                    className="bg-slate-50 rounded-xl border border-slate-200 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    {/* Product info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-sm truncate">{item.fromProductName}</p>
                      <p className="text-xs text-slate-400 font-mono">{item.fromProductSku || '—'}</p>
                    </div>

                    {/* Fields */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Quantity */}
                      <div className="flex flex-col items-start gap-0.5">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Qty</label>
                        <input
                          type="number"
                          min={1}
                          max={item.fromProductQty}
                          value={item.quantity}
                          onChange={e => {
                            const v = Math.max(1, Math.min(item.fromProductQty, parseInt(e.target.value) || 1))
                            updateTransferItem(item.fromProductId, 'quantity', v)
                          }}
                          className={`w-16 rounded-lg border px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-400
                            ${item.quantity > item.fromProductQty ? 'border-red-400 bg-red-50' : 'border-slate-300'}`}
                        />
                        <span className="text-[10px] text-slate-400">max {item.fromProductQty}</span>
                      </div>

                      {/* Transfer Cost */}
                      <div className="flex flex-col items-start gap-0.5">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Cost Rs.</label>
                        <input
                          type="number"
                          min={0}
                          value={item.transferCost === '' ? '' : item.transferCost}
                          onChange={e => {
                            const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
                            updateTransferItem(item.fromProductId, 'transferCost', v as number | '')
                          }}
                          placeholder="Optional"
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>

                      {/* Transfer Price */}
                      <div className="flex flex-col items-start gap-0.5">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Price Rs.</label>
                        <input
                          type="number"
                          min={0}
                          value={item.transferPrice === '' ? '' : item.transferPrice}
                          onChange={e => {
                            const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
                            updateTransferItem(item.fromProductId, 'transferPrice', v as number | '')
                          }}
                          placeholder="Optional"
                          className="w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>

                      {/* Notes */}
                      <div className="flex flex-col items-start gap-0.5">
                        <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Notes</label>
                        <input
                          type="text"
                          value={item.notes}
                          onChange={e => updateTransferItem(item.fromProductId, 'notes', e.target.value)}
                          placeholder="Optional"
                          className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                        />
                      </div>

                      {/* Remove */}
                      <button
                        onClick={() => removeTransferItem(item.fromProductId)}
                        className="mt-3 sm:mt-0 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {transferItems.length === 0 && (
              <p className="text-sm text-slate-400 italic">Search for products above to add them to the transfer.</p>
            )}
          </div>
        )}

        {/* ── CSV MODE ────────────────────────────────────────────────────── */}
        {mode === 'csv' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={downloadCsvTemplate}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-indigo-300 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 text-sm font-semibold transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
                Download Template
              </button>

              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 text-sm font-semibold transition-colors cursor-pointer">
                <svg className="w-4 h-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                </svg>
                {csvFileName ? csvFileName : 'Upload CSV'}
                <input
                  ref={csvInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvUpload(f) }}
                />
              </label>

              {csvParsed && (
                <button
                  onClick={() => { setCsvParsed(null); setCsvFileName(''); setPreviewRows(null); if (csvInputRef.current) csvInputRef.current.value = '' }}
                  className="text-sm text-slate-400 hover:text-red-500 underline"
                >
                  Clear
                </button>
              )}
            </div>

            {/* CSV parsed preview table */}
            {csvParsed && csvParsed.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                  Parsed: {csvParsed.length} rows — {csvParsed.filter(r => r.matched).length} matched, {csvParsed.filter(r => !r.matched).length} unmatched
                </p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-indigo-50 text-indigo-800 text-xs uppercase tracking-wide">
                        <th className="px-3 py-2 text-left">SKU</th>
                        <th className="px-3 py-2 text-left">Name</th>
                        <th className="px-2 py-2 text-right">Qty</th>
                        <th className="px-2 py-2 text-right">Transfer Cost</th>
                        <th className="px-2 py-2 text-right">Transfer Price</th>
                        <th className="px-3 py-2 text-left">Notes</th>
                        <th className="px-3 py-2 text-left">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvParsed.map((row, i) => (
                        <tr key={i} className={`border-t border-slate-100 ${!row.matched ? 'bg-amber-50/60' : i % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.sku}</td>
                          <td className="px-3 py-2 text-slate-700">{row.fromProductName || <span className="text-slate-400 italic">Not found</span>}</td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min={1}
                              max={row.fromProductQty || undefined}
                              value={row.quantity}
                              disabled={!row.matched}
                              onChange={e => {
                                const v = Math.max(1, parseInt(e.target.value) || 1)
                                updateCsvRow(i, 'quantity', v)
                              }}
                              className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min={0}
                              value={row.transferCost === '' ? '' : row.transferCost}
                              disabled={!row.matched}
                              onChange={e => {
                                const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
                                updateCsvRow(i, 'transferCost', v as number | '')
                              }}
                              placeholder="—"
                              className="w-24 rounded border border-slate-300 px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <input
                              type="number"
                              min={0}
                              value={row.transferPrice === '' ? '' : row.transferPrice}
                              disabled={!row.matched}
                              onChange={e => {
                                const v = e.target.value === '' ? '' : Math.max(0, parseInt(e.target.value) || 0)
                                updateCsvRow(i, 'transferPrice', v as number | '')
                              }}
                              placeholder="—"
                              className="w-24 rounded border border-slate-300 px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.notes}
                              disabled={!row.matched}
                              onChange={e => updateCsvRow(i, 'notes', e.target.value)}
                              placeholder="—"
                              className="w-32 rounded border border-slate-300 px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-100 disabled:text-slate-400"
                            />
                          </td>
                          <td className="px-3 py-2">
                            {row.matched ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                ✓ Matched
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                                ⚠ SKU not found
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {csvParsed.some(r => !r.matched) && (
                  <p className="mt-2 text-xs text-amber-600">
                    Unmatched rows will be skipped. Only matched rows ({csvParsed.filter(r => r.matched).length}) will be transferred.
                  </p>
                )}
              </div>
            )}

            {csvParsed && csvParsed.length === 0 && (
              <p className="text-sm text-slate-400 italic">No valid rows found in the CSV file.</p>
            )}
          </div>
        )}

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            onClick={runPreview}
            disabled={!canPreview() || previewing || executing}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {previewing ? <><Spinner sm /> Previewing…</> : 'Preview Transfer'}
          </button>

          {(transferItems.length > 0 || (csvParsed && csvParsed.length > 0)) && (
            <button
              onClick={resetForm}
              disabled={previewing || executing}
              className="px-4 py-2.5 border border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold rounded-xl text-sm transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* ── Preview card ──────────────────────────────────────────────────── */}
      {previewRows && (
        <div className="bg-white rounded-xl border border-indigo-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-indigo-800">Transfer Preview</h3>
              <p className="text-sm text-slate-500">
                {previewRows.length} item(s) → <span className="font-semibold text-slate-700">{destVendorName}</span>
              </p>
              {/* The status column is the one thing operators ask about, and a
                  tooltip is no use on the shop's touchscreen. */}
              <p className="text-[11px] text-slate-400 mt-0.5">
                Matched by SKU: if {destVendorName} already stocks it, the quantity is added to what they have —
                otherwise the product is created in their catalogue with the same SKU, name and photos.
              </p>
            </div>
            {previewHasErrors && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
                Fix errors to continue
              </span>
            )}
          </div>

          <PreviewTable rows={previewRows} />

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              onClick={runExecute}
              disabled={previewHasErrors || executing || previewing}
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold rounded-xl text-sm transition-colors"
            >
              {executing ? <><Spinner sm /> Transferring…</> : `Confirm & Transfer to ${destVendorName}`}
            </button>
            <button
              onClick={() => setPreviewRows(null)}
              disabled={executing}
              className="px-4 py-2.5 border border-slate-300 text-slate-600 hover:bg-slate-50 font-semibold rounded-xl text-sm transition-colors"
            >
              Back to Edit
            </button>
          </div>
        </div>
      )}

      {/* ── Transfer history ──────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200">
        <button
          onClick={handleHistoryToggle}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 rounded-xl transition-colors"
        >
          <span className="font-semibold text-slate-700 text-sm">Transfer History (outgoing)</span>
          <svg
            className={`w-5 h-5 text-slate-400 transition-transform ${historyOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {historyOpen && (
          <div className="border-t border-slate-100 p-5">
            {historyLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
                <Spinner sm /> Loading history…
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-slate-400 italic py-2">No transfers recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                      <th className="pb-2 text-left font-semibold">Date</th>
                      <th className="pb-2 text-left font-semibold">Product</th>
                      <th className="pb-2 text-left font-semibold">SKU</th>
                      <th className="pb-2 text-right font-semibold">Qty</th>
                      <th className="pb-2 text-left font-semibold">To</th>
                      <th className="pb-2 text-left font-semibold">Status</th>
                      <th className="pb-2 text-right font-semibold">Transfer Price</th>
                      <th className="pb-2 text-left font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(row => (
                      <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                        <td className="py-2 pr-3 text-slate-500 whitespace-nowrap">
                          {new Date(row.transferred_at).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: '2-digit' })}
                        </td>
                        <td className="py-2 pr-3 text-slate-800 font-medium max-w-[200px] truncate" title={row.from_product_name}>
                          {row.from_product_name}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs text-slate-400">{row.from_product_sku || '—'}</td>
                        <td className="py-2 pr-3 text-right text-slate-700">{row.quantity}</td>
                        <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{row.to_vendor_name}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {row.status === 'rejected' ? (
                            <span className="text-xs font-bold text-red-600" title={row.reject_reason || ''}>
                              ↩ Sent back{row.reject_reason ? ` — ${row.reject_reason}` : ''}
                            </span>
                          ) : row.status === 'pending' ? (
                            <span className="text-xs font-bold text-amber-600">⏳ Awaiting their acceptance</span>
                          ) : (
                            <span className="text-xs font-bold text-emerald-600">✓ Accepted</span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-700">
                          {row.transfer_price != null ? `Rs. ${row.transfer_price.toLocaleString()}` : '—'}
                        </td>
                        <td className="py-2 text-slate-500 text-xs max-w-[160px] truncate" title={row.notes ?? ''}>
                          {row.notes || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  )
}
