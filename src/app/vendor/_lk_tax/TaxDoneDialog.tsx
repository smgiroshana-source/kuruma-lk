'use client'
// ── WHEEL MART ONLY — tick a VAT / SSCL deadline Done (owner, 2026-10-20) ────
// A payment asks what was paid and where the money came from (usually the
// owner's own pocket); a return just confirms it was filed. Kept for the
// record only — never an expense (see /api/vendor/tax-deadlines).
import { useState } from 'react'
import { TAX_KIND_LABEL, type TaxDue } from '@/lib/taxDeadlines'

export default function TaxDoneDialog({ item, onClose, onSaved, showToast }: {
  item: TaxDue
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const isPayment = item.kind.endsWith('_payment')
  const [amount, setAmount] = useState('')
  const [paidFrom, setPaidFrom] = useState<'owner' | 'bank' | 'cash'>('owner')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/tax-deadlines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'done', kind: item.kind, period: item.period, amount: isPayment ? amount.replace(/,/g, '') : null, paidFrom }),
      })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'Could not save')
      showToast(`✓ ${TAX_KIND_LABEL[item.kind]} for ${item.periodLabel} marked done`)
      onSaved()
    } catch (e: any) { showToast('⚠ ' + e.message) }
    setBusy(false)
  }

  const opt = (v: 'owner' | 'bank' | 'cash', l: string) => (
    <button key={v} type="button" role="radio" aria-checked={paidFrom === v} onClick={() => setPaidFrom(v)}
      className={`min-h-11 rounded-xl border-2 text-sm font-bold ${paidFrom === v ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-200 text-slate-600'}`}>{l}</button>
  )

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${TAX_KIND_LABEL[item.kind]} done`}
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="text-lg font-black text-slate-900">{TAX_KIND_LABEL[item.kind]} — {item.periodLabel}</h3>
          <p className="text-sm text-slate-600 mt-1">{isPayment ? 'Paid to IRD?' : 'Return filed with IRD?'} The reminder clears once you confirm.</p>
        </div>
        {isPayment && (
          <>
            <label className="block text-xs font-bold text-slate-600">Amount paid (Rs.) <span className="font-normal text-slate-400">— optional</span>
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="numeric" placeholder="e.g. 5,248"
                className="mt-1 block w-full h-12 px-3 rounded-xl border-2 border-slate-200 text-base outline-none focus:border-orange-400" />
            </label>
            <div>
              <p className="text-xs font-bold text-slate-600 mb-1">Paid from</p>
              <div role="radiogroup" aria-label="Paid from" className="grid grid-cols-3 gap-2">
                {opt('owner', 'My own money')}{opt('bank', 'Company bank')}{opt('cash', 'Cash drawer')}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Not booked as an expense: VAT never counts in profit, and SSCL is already charged from the month&apos;s sales.</p>
          </>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="flex-1 h-12 rounded-xl border-2 border-slate-200 text-slate-600 font-bold">Cancel</button>
          <button type="button" onClick={save} disabled={busy} className="flex-[1.4] h-12 rounded-xl bg-emerald-600 text-white font-black disabled:opacity-50">{busy ? 'Saving…' : isPayment ? 'Yes, paid' : 'Yes, filed'}</button>
        </div>
      </div>
    </div>
  )
}
