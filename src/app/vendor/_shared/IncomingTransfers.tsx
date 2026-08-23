'use client'
import { useState, useEffect, useCallback } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
// Shipments another shop has sent us that nobody here has answered.
//
// Stock sent by the other shop is IN TRANSIT: it has left their shelf and is on
// nobody's until someone here accepts. Nothing reaches this shop's inventory
// without a person saying so.
//
// Lives in _shared and fetches its own data so the same panel — one
// implementation, one set of rules — can sit on the dashboard where the shop
// actually looks, as well as inside the Transfer Stock tab.
//
// Accept is the big green target; Reject is small, quiet and asks for a
// reason. Accepting is the normal answer, and rejecting sends goods back
// across town.
// ─────────────────────────────────────────────────────────────────────────────

export interface IncomingItem {
  id: string
  name: string
  sku: string
  quantity: number
  transferCost: number | null
  transferPrice: number | null
  notes: string | null
}

export interface IncomingBatch {
  key: string
  batchId: string | null
  status: 'pending' | 'accepted' | 'rejected' | 'reversed'
  fromVendor: string
  sentAt: string
  settledAt: string | null
  rejectReason: string | null
  items: IncomingItem[]
  totalUnits: number
}

export default function IncomingTransfers({
  showToast,
  onDataChanged,
}: {
  showToast: (msg: string) => void
  onDataChanged: () => void
}) {
  const [incoming, setIncoming] = useState<IncomingBatch[]>([])
  const [answering, setAnswering] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<IncomingBatch | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const fetchIncoming = useCallback(async () => {
    try {
      const r = await fetch('/api/vendor/stock-transfer?action=incoming')
      if (r.ok) {
        const j = await r.json()
        setIncoming(j.pending || [])
      }
    } catch {}
  }, [])

  useEffect(() => { fetchIncoming() }, [fetchIncoming])

  async function answerShipment(batch: IncomingBatch, accept: boolean, reason?: string) {
    setAnswering(batch.key)
    try {
      const r = await fetch('/api/vendor/stock-transfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: accept ? 'accept' : 'reject', batchId: batch.batchId, reason,
        }),
      })
      const j = await r.json()
      if (j.success) {
        showToast((accept ? '✅ ' : '↩ ') + j.message)
        if (j.errors?.length) j.errors.forEach((e: string) => showToast('⚠️ ' + e))
        setRejecting(null); setRejectReason('')
        fetchIncoming(); onDataChanged()
      } else showToast('⚠️ ' + (j.error || 'Could not complete'))
    } catch { showToast('Network error') }
    setAnswering(null)
  }

  // Nothing waiting — take up no room at all.
  if (incoming.length === 0) return null

  return (
    <>
      <div className="bg-white rounded-xl border-2 border-emerald-300 shadow-sm overflow-hidden mb-5">
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
              <p className="text-[11px] text-slate-400">
                {new Date(b.sentAt).toLocaleString('en-GB', { timeZone: 'Asia/Colombo' })}
              </p>
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
    </>
  )
}
