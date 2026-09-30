'use client'
// ── WHEEL MART ONLY — pay a supplier from the dashboard (owner, 2026-09-30) ──
//
// Three steps instead of one flat list of everyone's bills:
//   1. the supplier — what's payable now, overdue, credit notes still to come,
//      prepayment on account;
//   2. their bills — what each was for (GRN, items), total / paid / credited,
//      tick one or several; mark a part-paid bill "credit note expected";
//   3. pay — amount, method, a discount only if NO credit note will come, and
//      when something is still left, why: pay later, or a credit note coming.
// Server rules live in src/lib/supplierPay.ts (pay_bills): oldest bill first,
// everything undone if any part fails.

import { useEffect, useMemo, useState } from 'react'
import { Modal, Spinner, formatRs, todayStr } from './CashModals'

type Step = 'suppliers' | 'bills' | 'pay' | 'slip'
const owedOf = (i: any) => Number(i.amount || 0) - Number(i.amount_paid || 0) - Number(i.credit_total || 0)
const payableOf = (i: any) => Math.max(0, owedOf(i) - Number(i.cn_expected_amount || 0))
const dmy = (d?: string | null) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''

export default function SupplierPayModal({ amount, onClose, onSaved, showToast }: {
  amount?: number
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const [step, setStep] = useState<Step>('suppliers')
  const [loading, setLoading] = useState(true)
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [q, setQ] = useState('')
  const [sup, setSup] = useState<any | null>(null)
  const [bills, setBills] = useState<any[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  const [amt, setAmt] = useState<string>(amount && amount > 0 ? String(Math.round(amount)) : '')
  const [method, setMethod] = useState<'cash' | 'online' | 'cheque'>('cash')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(todayStr())
  const [discount, setDiscount] = useState('')
  const [discountOk, setDiscountOk] = useState(false)
  const [why, setWhy] = useState<'later' | 'credit_note' | ''>('')
  const [saving, setSaving] = useState(false)
  const [slip, setSlip] = useState<{ no: string; kind: string; paid: number } | null>(null)

  async function loadSuppliers() {
    setLoading(true)
    try {
      const j = await (await fetch('/api/vendor/suppliers')).json()
      const list = (j.suppliers || []).filter((s: any) => Number(s.payable_now || 0) > 0 || Number(s.cn_expected || 0) > 0)
      // Overdue first, then whoever is due soonest
      list.sort((a: any, b: any) => (Number(b.overdue_amount || 0) > 0 ? 1 : 0) - (Number(a.overdue_amount || 0) > 0 ? 1 : 0)
        || String(a.next_due || '9999').localeCompare(String(b.next_due || '9999')))
      setSuppliers(list)
    } catch { showToast('Could not load suppliers') }
    setLoading(false)
  }
  useEffect(() => { loadSuppliers() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openSupplier(s: any, keepPicked = false) {
    setSup(s); setStep('bills'); setLoading(true)
    try {
      const j = await (await fetch(`/api/vendor/supplier-invoices?supplier_id=${s.id}`)).json()
      const list = (j.invoices || []).filter((i: any) => owedOf(i) > 0)
        .sort((a: any, b: any) => String(a.invoice_date || a.due_date || '').localeCompare(String(b.invoice_date || b.due_date || '')))
      setBills(list)
      if (!keepPicked) {
        const first = list.find((i: any) => payableOf(i) > 0)
        setPicked(first ? [first.id] : [])
      } else setPicked(p => p.filter(id => list.some((i: any) => i.id === id && payableOf(i) > 0)))
    } catch { showToast('Could not load the bills') }
    setLoading(false)
  }

  const shown = useMemo(() => {
    const w = q.trim().toLowerCase()
    return w ? suppliers.filter(s => `${s.name} ${s.supplier_code || ''}`.toLowerCase().includes(w)) : suppliers
  }, [suppliers, q])
  const sum = (k: string) => suppliers.reduce((t, s) => t + Number(s[k] || 0), 0)

  const chosen = bills.filter(b => picked.includes(b.id))
  const selectedTotal = chosen.reduce((t, b) => t + payableOf(b), 0)
  const payNum = Math.max(0, Math.round(Number(amt) || 0))
  const discNum = Math.max(0, Math.round(Number(discount) || 0))
  const left = selectedTotal - payNum - discNum

  // The same walk the server makes: money first, then the discount, oldest bill first
  const preview = useMemo(() => {
    let cash = payNum, disc = discNum
    return chosen.map(b => {
      const room = payableOf(b)
      const pay = Math.min(cash, room); cash -= pay
      const d = Math.min(disc, room - pay); disc -= d
      return { b, pay, d, left: room - pay - d }
    })
  }, [chosen, payNum, discNum])

  async function toggleCn(b: any, on: boolean) {
    setBusyId(b.id)
    try {
      const r = await fetch('/api/vendor/supplier-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_cn_expected', invoice_id: b.id, expected: on }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not update the bill')
      showToast(on ? `${b.invoice_no}: waiting for the supplier's credit note` : `${b.invoice_no}: back to money owed`)
      await openSupplier(sup, true); loadSuppliers()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setBusyId(null)
  }

  async function applyPrepayment() {
    setBusyId('prepay')
    try {
      let applied = 0
      for (const b of bills.filter(x => payableOf(x) > 0)) {
        const r = await fetch('/api/vendor/supplier-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'apply_advance', invoice_id: b.id }) })
        const j = await r.json()
        if (!r.ok) break
        applied += Number(j.applied || 0)
      }
      showToast(applied > 0 ? `✅ ${formatRs(applied)} of the prepayment applied` : 'Nothing to apply')
      await loadSuppliers()
      const fresh = (await (await fetch('/api/vendor/suppliers')).json()).suppliers?.find((s: any) => s.id === sup.id)
      await openSupplier(fresh || sup)
    } catch { showToast('Could not apply the prepayment') }
    setBusyId(null)
  }

  function goPay() {
    if (chosen.length === 0) { showToast('Tick the bills you are settling'); return }
    if (!amount) setAmt(String(selectedTotal))
    setDiscount(''); setDiscountOk(false); setWhy(''); setStep('pay')
  }

  async function save() {
    if (payNum <= 0 && discNum <= 0) { showToast('Enter the amount paid'); return }
    if (left < 0) { showToast(`That is ${formatRs(-left)} more than the ${formatRs(selectedTotal)} owed on these bills`); return }
    if (discNum > 0 && !discountOk) { showToast('⚠️ Tick that the supplier confirmed no credit note — if a note is coming, choose that instead of a discount'); return }
    if (left > 0 && !why) { showToast(`Say why ${formatRs(left)} is left`); return }
    if (payNum > 0 && method === 'cheque' && !reference.trim()) { showToast('Enter the cheque number'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/supplier-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pay_bills', supplier_id: sup.id, invoice_ids: chosen.map(b => b.id),
          amount: payNum, method, reference: reference.trim() || null, payment_date: date,
          discount: discNum, discount_no_credit_note: discNum > 0 && discountOk,
          short_reason: left > 0 ? why : 'later',
        }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not record the payment')
      const cnCount = (j.bills || []).filter((b: any) => b.cn_expected).length
      const msg = [payNum > 0 ? `${formatRs(payNum)} paid to ${sup.name}` : `${sup.name} settled`,
        discNum > 0 ? `discount ${formatRs(discNum)}` : '', cnCount ? 'credit note marked as expected' : ''].filter(Boolean).join(' · ')
      if (j.confirm_no) { setSlip({ no: j.confirm_no, kind: j.confirm_kind, paid: payNum }); setStep('slip'); showToast('✅ ' + msg) }
      else { showToast('✅ ' + msg); onSaved() }
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  // ── Slip: the control number for a cheque or transfer ─────────────────────
  if (step === 'slip' && slip) {
    return (
      <Modal title="Payment recorded" onClose={onSaved}>
        <p className="text-xs font-bold text-slate-500 uppercase text-center">
          {slip.kind === 'cheque' ? 'Write this on the cheque book slip' : 'Type this into the transfer remarks'}
        </p>
        <p className="text-4xl font-black tracking-[0.3em] text-slate-900 my-4 font-mono text-center">{slip.no}</p>
        <p className="text-xs text-slate-500 text-center mb-1">{formatRs(slip.paid)} to {sup?.name}</p>
        <p className="text-[11px] font-bold text-red-600 text-center mb-4">
          {slip.kind === 'cheque'
            ? 'The owner signs ONLY cheques whose slip carries a confirmation number.'
            : 'Transfers without this number in the remarks are treated as unauthorised.'}
        </p>
        <button onClick={onSaved} className="w-full py-2.5 rounded-xl bg-slate-800 text-white text-sm font-black">Done</button>
      </Modal>
    )
  }

  // ── 1 · Pick the supplier ─────────────────────────────────────────────────
  if (step === 'suppliers') {
    const cnTotal = sum('cn_expected')
    return (
      <Modal title={amount ? `${formatRs(amount)} — to which supplier?` : 'Pay a supplier'} onClose={onClose}>
        {loading ? <Spinner /> : (
          <>
            <div className={`grid gap-2 mb-3 ${cnTotal > 0 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <div className="rounded-xl bg-orange-50 border border-orange-200 px-3 py-2">
                <p className="text-[10px] font-black uppercase tracking-wider text-orange-800">To pay</p>
                <p className="text-lg font-black text-orange-900">{formatRs(sum('payable_now'))}</p>
              </div>
              <div className={`rounded-xl border px-3 py-2 ${sum('overdue_amount') > 0 ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                <p className={`text-[10px] font-black uppercase tracking-wider ${sum('overdue_amount') > 0 ? 'text-red-700' : 'text-slate-500'}`}>Overdue</p>
                <p className={`text-lg font-black ${sum('overdue_amount') > 0 ? 'text-red-700' : 'text-slate-800'}`}>{formatRs(sum('overdue_amount'))}</p>
              </div>
              {cnTotal > 0 && (
                <div className="rounded-xl bg-sky-50 border border-sky-200 px-3 py-2">
                  <p className="text-[10px] font-black uppercase tracking-wider text-sky-800">Credit notes due</p>
                  <p className="text-lg font-black text-sky-900">{formatRs(cnTotal)}</p>
                </div>
              )}
            </div>
            {suppliers.length > 4 && (
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a supplier — name or code"
                className="w-full mb-3 px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
            )}
            {shown.length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">{suppliers.length ? 'No supplier matches.' : 'Nothing owed to any supplier.'}</p>
            ) : (
              <div className="space-y-2 max-h-[55vh] overflow-y-auto">
                {shown.map(s => {
                  const overdue = Number(s.overdue_amount || 0), cn = Number(s.cn_expected || 0), pre = Number(s.advance_balance || 0)
                  return (
                    <button key={s.id} onClick={() => openSupplier(s)}
                      className="w-full text-left rounded-xl border-2 border-slate-200 hover:border-orange-400 px-3.5 py-3 flex items-center gap-3 transition">
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-black text-slate-800 truncate">{s.name}</span>
                        <span className="block text-[11px] text-slate-500">
                          {[s.supplier_code, s.bill_count ? `${s.bill_count} bill${s.bill_count !== 1 ? 's' : ''} to pay` : 'nothing to pay now', s.next_due ? `next due ${dmy(s.next_due)}` : ''].filter(Boolean).join(' · ')}
                        </span>
                        <span className="flex flex-wrap gap-1 mt-1">
                          {overdue > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Overdue {formatRs(overdue)}</span>}
                          {cn > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800">Credit note expected {formatRs(cn)}</span>}
                          {pre > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">Prepaid {formatRs(pre)}</span>}
                        </span>
                      </span>
                      <span className="text-right shrink-0">
                        <span className="block text-base font-black text-slate-900">{formatRs(Number(s.payable_now || 0))}</span>
                        <span className="block text-[10px] text-slate-400">to pay</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <p className="text-[10px] text-slate-400 text-center mt-3">Paying ahead of a bill? Use Prepay on the supplier in Suppliers &amp; Payables.</p>
          </>
        )}
      </Modal>
    )
  }

  // ── 2 · Their bills ───────────────────────────────────────────────────────
  if (step === 'bills' && sup) {
    const pre = Number(sup.advance_balance || 0)
    return (
      <Modal title={sup.name} onClose={onClose}>
        <button onClick={() => { setStep('suppliers'); setSup(null) }} className="text-xs font-bold text-slate-500 hover:text-slate-800 mb-3">← All suppliers</button>
        {loading ? <Spinner /> : (
          <>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">To pay</p>
                <p className="text-sm font-black">{formatRs(bills.reduce((t, b) => t + payableOf(b), 0))}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">Prepaid on account</p>
                <p className="text-sm font-black">{formatRs(pre)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1.5">
                <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">VAT registered</p>
                <p className="text-sm font-black">{sup.vat_registered ? 'Yes' : 'No'}</p>
              </div>
            </div>
            {pre > 0 && bills.some(b => payableOf(b) > 0) && (
              <button onClick={applyPrepayment} disabled={busyId === 'prepay'}
                className="w-full mb-3 py-2 rounded-lg border-2 border-emerald-300 bg-emerald-50 text-emerald-800 text-xs font-black disabled:opacity-50">
                {busyId === 'prepay' ? 'Applying…' : `Use the ${formatRs(pre)} prepayment on these bills first`}
              </button>
            )}
            {bills.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">No open bills.</p> : (
              <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                {bills.map(b => {
                  const payable = payableOf(b), cn = Math.min(Number(b.cn_expected_amount || 0), owedOf(b))
                  const blocked = payable <= 0
                  const on = picked.includes(b.id)
                  const overdue = payable > 0 && b.due_date && b.due_date < todayStr()
                  const partPaid = Number(b.amount_paid || 0) + Number(b.credit_total || 0) > 0
                  return (
                    <div key={b.id} className={`rounded-xl border-2 px-3 py-2.5 ${on ? 'border-orange-500 bg-orange-50' : blocked ? 'border-sky-200 bg-sky-50/50' : 'border-slate-200'}`}>
                      <label className={`flex gap-2.5 ${blocked ? 'cursor-default' : 'cursor-pointer'}`}>
                        <input type="checkbox" className="mt-1 w-4 h-4 accent-orange-600" checked={on} disabled={blocked}
                          onChange={e => setPicked(p => e.target.checked ? [...p, b.id] : p.filter(x => x !== b.id))} />
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-black text-slate-800">{b.invoice_no}</span>
                            <span className="text-sm font-black text-slate-900">{formatRs(payable)}</span>
                          </span>
                          <span className="block text-[11px] text-slate-500">
                            {[b.invoice_date ? `bill ${dmy(b.invoice_date)}` : '', b.due_date ? `due ${dmy(b.due_date)}` : '', b.grn_number].filter(Boolean).join(' · ')}
                            {overdue && <span className="text-red-600 font-bold"> · overdue</span>}
                          </span>
                          {b.items_summary && <span className="block text-[11px] text-slate-700 mt-0.5 truncate">{b.items_summary}</span>}
                          <span className="grid grid-cols-3 gap-1 mt-1.5 text-[10px] text-slate-500">
                            <span>Total <b className="text-slate-700">{formatRs(b.amount)}</b></span>
                            <span>Paid <b className="text-slate-700">{formatRs(b.amount_paid || 0)}</b></span>
                            <span>Credited <b className="text-slate-700">{formatRs(b.credit_total || 0)}</b></span>
                          </span>
                        </span>
                      </label>
                      {cn > 0 ? (
                        <div className="flex items-center justify-between gap-2 mt-2 pl-6">
                          <span className="text-[11px] font-bold text-sky-800">Credit note expected — {formatRs(cn)} since {dmy(b.cn_expected_since)}</span>
                          <button onClick={() => toggleCn(b, false)} disabled={busyId === b.id} className="text-[10px] font-bold text-slate-500 underline shrink-0">Not coming</button>
                        </div>
                      ) : partPaid && (
                        <div className="mt-1.5 pl-6">
                          <button onClick={() => toggleCn(b, true)} disabled={busyId === b.id}
                            className="text-[10px] font-bold text-sky-700 underline">Balance is waiting for a credit note</button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
              <div className="flex-1">
                <p className="text-[11px] text-slate-500">{chosen.length} bill{chosen.length !== 1 ? 's' : ''} ticked</p>
                <p className="text-base font-black">{formatRs(selectedTotal)}</p>
              </div>
              <button onClick={goPay} disabled={chosen.length === 0}
                className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-40">Continue</button>
            </div>
          </>
        )}
      </Modal>
    )
  }

  // ── 3 · Pay ───────────────────────────────────────────────────────────────
  return (
    <Modal title={`Pay ${sup?.name || ''}`} onClose={onClose}>
      <button onClick={() => setStep('bills')} className="text-xs font-bold text-slate-500 hover:text-slate-800 mb-2">← Bills</button>
      <p className="text-[11px] text-slate-500 mb-3">{chosen.map(b => b.invoice_no).join(', ')} · {formatRs(selectedTotal)} to settle</p>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1">Paying now</label>
          <div className="flex gap-2">
            <input type="number" min={0} value={amt} onChange={e => setAmt(e.target.value)}
              className="flex-1 min-w-0 border-2 border-slate-200 rounded-lg px-3 py-2 text-base font-black outline-none focus:border-orange-400" />
            <button onClick={() => { setAmt(String(selectedTotal)); setDiscount('') }}
              className="px-3 rounded-lg border border-orange-300 bg-orange-50 text-orange-800 text-[11px] font-black shrink-0">Full {formatRs(selectedTotal)}</button>
          </div>
        </div>

        {payNum > 0 && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              {([['cash', 'Cash drawer'], ['online', 'Online'], ['cheque', 'Cheque']] as const).map(([v, l]) => (
                <button key={v} onClick={() => setMethod(v)}
                  className={`py-2 rounded-lg border-2 text-xs font-bold ${method === v ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-500'}`}>{l}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input value={reference} onChange={e => setReference(e.target.value)}
                placeholder={method === 'cheque' ? 'Cheque number *' : method === 'online' ? 'Transfer reference' : 'Reference (optional)'}
                className="border-2 border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
              <input type="date" value={date} max={todayStr()} onChange={e => setDate(e.target.value)}
                className="border-2 border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-orange-400" />
            </div>
          </>
        )}

        {/* Only a discount the supplier confirmed gets no credit note — one
            still coming is marked below instead, so it can't be forgotten */}
        <div className={`rounded-lg border-2 px-3 py-2 ${discNum > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-200'}`}>
          <label className="block text-[11px] font-bold text-slate-600 mb-1">Discount taken — only if NO credit note will come</label>
          <input type="number" min={0} value={discount} onChange={e => setDiscount(e.target.value)} placeholder="0"
            className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm outline-none focus:border-orange-400 bg-white" />
          {discNum > 0 && (
            <label className="flex items-start gap-2 mt-1.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={discountOk} onChange={e => setDiscountOk(e.target.checked)} />
              <span className="text-[11px] text-slate-700"><b>The supplier confirmed no credit note will be issued.</b> No VAT change; recorded with a DISC number.</span>
            </label>
          )}
        </div>

        {left > 0 && (
          <div className="rounded-lg border-2 border-slate-200 px-3 py-2">
            <p className="text-xs font-black text-slate-700 mb-1.5">Why is {formatRs(left)} left?</p>
            {([['later', 'We’ll pay the rest later', 'It stays owed and counts toward overdue.'],
               ['credit_note', 'Supplier will send a credit note', 'Marked "credit note expected" — not counted as money to pay, and listed until the note is entered.']] as const).map(([v, l, h]) => (
              <label key={v} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 cursor-pointer ${why === v ? 'bg-orange-50' : ''}`}>
                <input type="radio" name="why" className="mt-1" checked={why === v} onChange={() => setWhy(v)} />
                <span><span className="block text-xs font-bold text-slate-800">{l}</span><span className="block text-[10px] text-slate-500">{h}</span></span>
              </label>
            ))}
          </div>
        )}
        {left < 0 && <p className="text-xs font-bold text-red-600">{formatRs(-left)} more than the {formatRs(selectedTotal)} owed on these bills.</p>}

        {(payNum > 0 || discNum > 0) && left >= 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1">What happens</p>
            {preview.map(({ b, pay, d, left: l }) => (
              <div key={b.id} className="flex justify-between gap-2 text-xs py-0.5">
                <span className="text-slate-700 truncate">{b.invoice_no}{pay > 0 ? ` · pay ${formatRs(pay)}` : ''}{d > 0 ? ` · discount ${formatRs(d)}` : ''}</span>
                <span className={`font-bold shrink-0 ${l === 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
                  {l === 0 ? 'settled' : why === 'credit_note' && (pay > 0 || d > 0) ? `${formatRs(l)} credit note expected` : `${formatRs(l)} still owed`}
                </span>
              </div>
            ))}
            <p className="text-[10px] text-slate-500 mt-1">{payNum > 0 ? (method === 'cash' ? `${formatRs(payNum)} comes off the drawer for ${date}.` : `${formatRs(payNum)} ${method === 'cheque' ? 'by cheque' : 'by bank transfer'}.`) : 'No money moves — drawer and bank untouched.'}</p>
          </div>
        )}
      </div>

      <div className="flex gap-2 mt-4">
        <button onClick={() => setStep('bills')} className="px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">Back</button>
        <button onClick={save} disabled={saving || left < 0 || (payNum <= 0 && discNum <= 0)}
          className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Saving…' : payNum > 0 ? `Pay ${formatRs(payNum)}` : `Settle ${chosen.length === 1 ? chosen[0].invoice_no : 'bills'}`}
        </button>
      </div>
    </Modal>
  )
}
