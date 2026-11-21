'use client'
// ── WHEEL MART — payments made to one supplier, and the owner's method fix ────
// Owner, 2026-11-21: staff picked Cash for a supplier payment that went by
// bank. The owner can change how a payment left (cash / bank transfer /
// cheque) with a reason; amount, date and the bills it settled never change.
// The server moves the rest of a multi-bill payment with it, recomputes that
// day's drawer and logs a cash correction if the day was already closed.

import { useEffect, useState } from 'react'

const METHOD_LABEL: Record<string, string> = { cash: '💵 Cash', online: '🏦 Bank transfer', cheque: '📝 Cheque' }
const rs = (n: number) => 'Rs.' + Math.round(n || 0).toLocaleString()

export default function SupplierPaymentsList({ supplierId, isOwner, showToast }: {
  supplierId: string; isOwner: boolean; showToast: (m: string) => void
}) {
  const [payments, setPayments] = useState<any[] | null>(null)
  const [open, setOpen] = useState(false)
  const [fixing, setFixing] = useState<any>(null)
  const [form, setForm] = useState({ method: 'online', reference: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<any>(null)

  async function load() {
    try {
      const r = await fetch(`/api/vendor/supplier-invoices?action=supplier_payments&supplier_id=${supplierId}`)
      const j = await r.json()
      setPayments(r.ok ? j.payments || [] : [])
    } catch { setPayments([]) }
  }
  // Fetched only when the list is opened — no extra call on every supplier view
  useEffect(() => { if (open && payments === null) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPayments(null) }, [supplierId])

  async function save() {
    if (!fixing) return
    if (!form.reason.trim()) { showToast('⚠️ Say why the method is being changed'); return }
    if (form.method === 'cheque' && !form.reference.trim()) { showToast('⚠️ Enter the cheque number'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/supplier-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_payment_method', payment_id: fixing.id, ...form }),
      })
      const j = await r.json()
      if (!r.ok) { showToast('⚠️ ' + j.error); setSaving(false); return }
      setDone(j); setFixing(null); await load()
      showToast(`✅ ${rs(j.amount)} now recorded as ${METHOD_LABEL[j.to]?.replace(/^\S+ /, '') || j.to}`)
    } catch { showToast('Network error') }
    setSaving(false)
  }

  return (
    <div className="mt-4 bg-white rounded-xl border border-slate-200">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-bold text-slate-700">💸 Payments made</span>
        <span className="text-xs text-slate-400">{open ? '▾' : '▸'} last 40</span>
      </button>
      {open && (
        <div className="border-t border-slate-100">
          {payments === null ? <p className="p-4 text-xs text-slate-400">Loading…</p>
            : payments.length === 0 ? <p className="p-4 text-xs text-slate-400">No payments recorded to this supplier.</p>
            : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-[10px] uppercase text-slate-500 text-left">
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2">Bill</th><th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Method</th><th className="px-3 py-2">Ref / control no.</th><th className="px-3 py-2"></th>
                  </tr></thead>
                  <tbody>
                    {payments.map(p => {
                      const changed = /owner changed/.test(p.notes || '')
                      return (
                        <tr key={p.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 whitespace-nowrap">{p.payment_date}</td>
                          <td className="px-3 py-2 font-mono text-[10px]">{p.bill?.invoice_no || (p.supplier_invoice_id ? '—' : 'prepayment')}</td>
                          <td className="px-3 py-2 text-right font-bold whitespace-nowrap">{rs(p.amount)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {METHOD_LABEL[p.method] || p.method}
                            {changed && <span className="block text-[9px] font-bold text-amber-600" title={p.notes}>method changed</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px] text-slate-500">{[p.reference, p.payment_confirm_no].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="px-3 py-2 text-right">
                            {isOwner && (
                              <button onClick={() => { setFixing(p); setForm({ method: p.method === 'cash' ? 'online' : 'cash', reference: '', reason: '' }) }}
                                className="text-[11px] font-bold text-orange-600 hover:text-orange-700 whitespace-nowrap">Change method</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          {!isOwner && payments && payments.length > 0 && (
            <p className="px-4 py-2 text-[10px] text-slate-400">Wrong method on a payment? Ask the owner — only the owner can change it.</p>
          )}
        </div>
      )}

      {fixing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => !saving && setFixing(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">Change payment method</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">
              {rs(fixing.amount)} on {fixing.payment_date}{fixing.bill?.invoice_no ? ` · ${fixing.bill.invoice_no}` : ''} — recorded as <strong>{METHOD_LABEL[fixing.method] || fixing.method}</strong>.
              The amount, date and the bills it paid stay as they are. If this was one payment across several bills, all of it moves.
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">How the money really left</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['online', 'cheque', 'cash'] as const).filter(m => m !== fixing.method).map(m => (
                    <button key={m} onClick={() => setForm(f => ({ ...f, method: m }))}
                      className={`text-xs font-bold py-2 rounded-lg border-2 ${form.method === m ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600'}`}>
                      {METHOD_LABEL[m]}
                    </button>
                  ))}
                </div>
              </div>
              {form.method !== 'cash' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">{form.method === 'cheque' ? 'Cheque number *' : 'Bank reference (optional)'}</label>
                  <input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400" />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Why *</label>
                <input value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="e.g. Staff picked cash — paid by bank transfer"
                  className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
              </div>
              {(fixing.method === 'cash' || form.method === 'cash') && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                  {fixing.method === 'cash'
                    ? `The cash drawer for ${fixing.payment_date} will expect ${rs(fixing.amount)} MORE (this money didn't leave the drawer).`
                    : `The cash drawer for ${fixing.payment_date} will expect ${rs(fixing.amount)} LESS (this money left the drawer).`}
                  {' '}If that day is already closed, its difference changes and the change shows on that day&apos;s report.
                </p>
              )}
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setFixing(null)} disabled={saving} className="px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-500">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-black text-sm py-2.5 rounded-xl">
                {saving ? '⏳ Saving…' : 'Change method'}
              </button>
            </div>
          </div>
        </div>
      )}

      {done && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setDone(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">✅ Method changed</h3>
            <p className="text-sm text-slate-600 mt-2">
              {rs(done.amount)} on {done.payment_date}{done.changed > 1 ? ` (${done.changed} bills)` : ''} is now recorded as {METHOD_LABEL[done.to] || done.to}.
            </p>
            {done.confirm_no && (
              <p className="text-sm mt-2">Control number: <span className="font-mono font-black">{done.confirm_no}</span> — write it on the {done.to === 'cheque' ? 'cheque book slip' : 'bank transfer record'}.</p>
            )}
            {done.variance_after != null && (
              <p className="text-xs text-slate-500 mt-2">That day&apos;s cash difference is now {rs(done.variance_after)}.</p>
            )}
            <button onClick={() => setDone(null)} className="mt-4 w-full bg-slate-800 text-white font-bold text-sm py-2.5 rounded-xl">OK</button>
          </div>
        </div>
      )}
    </div>
  )
}
