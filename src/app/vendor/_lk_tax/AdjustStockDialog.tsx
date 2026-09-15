'use client'
// ─────────────────────────────────────────────────────────────────────────────
// Adjust stock — WHEEL MART
//
// The Edit product form used to carry a bare Qty box that wrote straight onto
// the product: no movement row, no reason, no name, nothing on the daily
// report. The owner changed a tyre from 3 to 1 that way on 2026-09-15 and
// asked how a theft would ever be noticed. It would not have been.
//
// This dialog is the only way to change an existing product's count outside
// the stock count screen. It goes through the audited adjust_stock action:
// a reason on every decrease, big decreases refused unless the caller is a
// manager or owner (or sent to Write-offs), a movement row every time, and
// the daily report lists it under Stock Adjustments with who did it.
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react'

// Mirrors DROP_REASONS in /api/vendor/products. Damaged / lost / theft are
// deliberately absent: those belong in Write-offs so the loss reaches profit.
const DROP_REASONS: { v: string; l: string }[] = [
  { v: 'miscounted',       l: 'Miscounted before' },
  { v: 'found_elsewhere',  l: 'Found in another place' },
  { v: 'used_in_shop',     l: 'Used in the shop, not billed' },
  { v: 'data_entry_error', l: 'Typed in wrong earlier' },
]
const RISE_REASONS: { v: string; l: string }[] = [
  { v: 'stocktake',        l: 'Recount — more on the shelf than recorded' },
  { v: 'found_elsewhere',  l: 'Found in another place' },
  { v: 'data_entry_error', l: 'Typed in wrong earlier' },
]

type Props = {
  product: { id: string; name: string; sku?: string; quantity: number; cost?: number | null }
  staffRole?: string | null
  showToast: (msg: string) => void
  onClose: () => void
  onAdjusted: (newQuantity: number) => void
  onGoToWriteoffs?: () => void
}

export default function AdjustStockDialog({ product, staffRole, showToast, onClose, onAdjusted, onGoToWriteoffs }: Props) {
  const current = Number(product.quantity) || 0
  const [qty, setQty] = useState<string>(String(current))
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [tooBig, setTooBig] = useState<string | null>(null)

  const target = Math.round(Number(qty))
  const valid = Number.isFinite(target) && qty.trim() !== ''
  const delta = valid ? target - current : 0
  const reasons = delta < 0 ? DROP_REASONS : RISE_REASONS
  const mayWriteDown = staffRole === 'owner' || staffRole === 'manager'

  async function save() {
    if (!valid) { showToast('Enter the count'); return }
    if (delta === 0) { onClose(); return }
    if (!reason) { showToast('Pick a reason — every count change is recorded'); return }
    setBusy(true); setTooBig(null)
    try {
      const r = await fetch('/api/vendor/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'adjust_stock', productId: product.id, newQuantity: target, reason, note: note.trim() || undefined,
          // Found stock carries the product's net cost into a FIFO layer so a
          // later sale has a real cost, not zero.
          unitCost: delta > 0 && Number(product.cost) > 0 ? Math.round(Number(product.cost)) : undefined,
        }),
      })
      const j = await r.json()
      if (!j.success) {
        if (j.error === 'DROP_TOO_BIG') { setTooBig(j.detail?.message || 'Too big for a count correction.'); return }
        throw new Error(j.error || 'Failed')
      }
      showToast(`${product.name}: ${current} → ${target} (${delta > 0 ? '+' : ''}${delta}) recorded`)
      onAdjusted(target)
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="font-black text-slate-900 text-base">Adjust stock</h3>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{product.name}{product.sku ? ` · ${product.sku}` : ''}</p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">On record</label>
            <div className="px-3 py-2.5 rounded-lg bg-slate-50 border-2 border-slate-100 text-sm font-black text-slate-700">{current}</div>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Actual count</label>
            <input type="number" inputMode="numeric" autoFocus value={qty} onChange={e => { setQty(e.target.value); setReason(''); setTooBig(null) }}
              className="w-full px-3 py-2.5 rounded-lg border-2 border-orange-300 text-sm font-black outline-none focus:border-orange-500" />
          </div>
        </div>

        {valid && delta !== 0 && (
          <div className={'mt-3 rounded-lg px-3 py-2 text-xs font-bold ' + (delta < 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-emerald-50 text-emerald-800 border border-emerald-200')}>
            {delta < 0 ? `${Math.abs(delta)} fewer than recorded` : `${delta} more than recorded`}
            {delta < 0 && Number(product.cost) > 0 && <span className="font-normal"> · Rs.{(Math.abs(delta) * Math.round(Number(product.cost))).toLocaleString()} of stock</span>}
          </div>
        )}

        {valid && delta !== 0 && (
          <div className="mt-3">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Why</label>
            <div className="grid grid-cols-1 gap-1.5">
              {reasons.map(r => (
                <button key={r.v} type="button" onClick={() => setReason(r.v)}
                  className={'text-left px-3 py-2 rounded-lg border-2 text-xs font-bold transition ' + (reason === r.v ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>
                  {r.l}
                </button>
              ))}
            </div>
            {delta < 0 && (
              <p className="text-[10px] text-slate-400 mt-2">
                Damaged, lost or stolen? That is a <button type="button" onClick={onGoToWriteoffs} className="font-bold text-red-600 underline">Write-off</button>, not a count correction — the loss has to reach profit.
              </p>
            )}
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Note (optional)"
              className="w-full mt-2 px-3 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-slate-400" />
          </div>
        )}

        {tooBig && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
            <strong>Too big for a count correction.</strong> {tooBig}
            {!mayWriteDown && <span className="block mt-1">Ask a manager or the owner, or record it as a Write-off.</span>}
          </div>
        )}

        <p className="text-[10px] text-slate-400 mt-3">Every change is written to the stock ledger with your name and shows on the daily report under Stock Adjustments.</p>

        <div className="flex gap-2 mt-4">
          <button onClick={save} disabled={busy || !valid || (delta !== 0 && !reason)}
            className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-black text-sm py-3 rounded-xl">
            {busy ? 'Saving…' : delta === 0 ? 'No change' : 'Record adjustment'}
          </button>
          <button onClick={onClose} className="px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">Cancel</button>
        </div>
      </div>
    </div>
  )
}
