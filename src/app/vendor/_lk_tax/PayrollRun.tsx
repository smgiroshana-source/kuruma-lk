'use client'
// ── WHEEL MART ONLY — monthly payroll run (owner only) ───────────────────────
//
// Closes one month: what each person earned, less EPF and less the advances
// they already took, leaving the balance handed over on payday. The system
// proposes the figures from attendance and pay items; the owner corrects what
// only they know (how many tyre repairs, what the workshop profit was) and
// saves. Marking it paid posts the salaries expenses.

import { useState, useEffect, useCallback } from 'react'
import { colomboToday } from '@/lib/dates'
import { printSlips } from './salarySlip'
import { printPayrollSheet } from './payrollSheet'

const rs = (n: number) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()
const r0 = (n: any) => Math.round(Number(n) || 0)

const PAID_FROM: Record<string, string> = { cash: 'drawer', online: 'online', owner: "owner's money" }

const KIND_LABEL: Record<string, string> = {
  base: 'Base', allowance: 'Allowance', commission_rate: 'Commission',
  profit_rate: 'Profit share', epf: 'EPF', other: 'Other', loan: 'Loan',
}

type Line = any

// Salary cycle runs 25th → 24th; the period key is the month the cycle ends
// in (= is paid in). "2026-08" ⇒ 25 Jul – 24 Aug, paid ~25 Aug.
function cycleLabel(p: string): string {
  const [y, m] = p.split('-').map(Number)
  const f = new Date(y, m - 2, 25), t = new Date(y, m - 1, 24)
  const fmt = (d: Date, yr: boolean) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(yr ? { year: 'numeric' } : {}) })
  return fmt(f, f.getFullYear() !== t.getFullYear()) + ' – ' + fmt(t, true)
}

export default function PayrollRun({ showToast, vendorName, initialPeriod }: { showToast: (m: string) => void; vendorName?: string; initialPeriod?: string }) {
  const [period, setPeriod] = useState(() => {
    // Opened from the dashboard's "salaries not marked paid" line
    if (initialPeriod && /^\d{4}-\d{2}$/.test(initialPeriod)) return initialPeriod
    // Default to the cycle that most recently ENDED: from the 25th that is the
    // current month (cycle ended on the 24th just past); before it, last month.
    const today = colomboToday()
    const [y, m] = today.slice(0, 7).split('-').map(Number)
    const day = Number(today.slice(8, 10))
    const d = day >= 25 ? new Date(y, m - 1, 1) : new Date(y, m - 2, 1)
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    // Payroll in the system starts with the 25 Aug – 24 Sep 2026 cycle —
    // never default to a cycle the API refuses to save.
    return p < '2026-09' ? '2026-09' : p
  })
  const [lines, setLines] = useState<Line[]>([])
  const [run, setRun] = useState<any>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [payDate, setPayDate] = useState(colomboToday())
  const [payMethod, setPayMethod] = useState<'cash' | 'online' | 'owner'>('cash')
  const [showPay, setShowPay] = useState(false)
  const [dirty, setDirty] = useState(false)

  const load = useCallback(async (p: string) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/vendor/payroll?period=${p}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to load')
      setLines(j.lines || [])
      setRun(j.run || null)
      setSaved(!!j.saved)
      setDirty(false)
      setOpen(null)
    } catch (e: any) { showToast('⚠️ ' + e.message); setLines([]); setRun(null) }
    setLoading(false)
  }, [showToast])
  useEffect(() => { load(period) }, [period, load])

  const isPaid = run?.status === 'paid'

  // Recompute one line's totals after the owner edits a component
  function recalc(line: Line): Line {
    const comps = line.components || []
    const baseEarned = comps.filter((c: any) => c.kind === 'base' && !c.isDeduction)
      .reduce((s: number, c: any) => s + r0(c.amount), 0)
    for (const c of comps) {
      if (c.kind === 'epf' && c.unit === 'percent') c.amount = r0(baseEarned * (Number(c.rate) || 0) / 100)
    }
    const gross = comps.filter((c: any) => !c.isDeduction).reduce((s: number, c: any) => s + r0(c.amount), 0)
    const deductions = comps.filter((c: any) => c.isDeduction).reduce((s: number, c: any) => s + r0(c.amount), 0)
    return { ...line, components: comps, gross, deductions, net_pay: gross - deductions - r0(line.advances) }
  }

  function editComponent(empId: string, idx: number, patch: any) {
    setDirty(true)
    setLines(prev => prev.map(l => {
      if (l.employee_id !== empId) return l
      const comps = (l.components || []).map((c: any, i: number) => {
        if (i !== idx) return c
        const next = { ...c, ...patch }
        // Quantity × rate drives the amount unless the amount was typed directly
        if (patch.qty !== undefined) next.amount = r0((Number(next.qty) || 0) * (Number(next.rate) || 0))
        next.needsInput = false
        return next
      })
      return recalc({ ...l, components: comps })
    }))
  }

  const totals = lines.reduce((t, l) => ({
    gross: t.gross + r0(l.gross), deductions: t.deductions + r0(l.deductions),
    advances: t.advances + r0(l.advances), net: t.net + r0(l.net_pay),
  }), { gross: 0, deductions: 0, advances: 0, net: 0 })

  const needsAttention = lines.filter(l => (l.components || []).some((c: any) => c.needsInput))

  async function post(body: any, okMsg: string) {
    setBusy(true)
    try {
      const r = await fetch('/api/vendor/payroll', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast(okMsg)
      await load(period)
      return true
    } catch (e: any) { showToast('⚠️ ' + e.message); return false }
    finally { setBusy(false) }
  }

  const saveDraft = () => post({ action: 'save_draft', period, lines }, '✅ Payroll saved as a draft')

  async function markPaid() {
    if (!run?.id) { showToast('Save the draft first'); return }
    setShowPay(false)
    await post({ action: 'mark_paid', runId: run.id, paid_date: payDate, payment_method: payMethod },
      `✅ Paid — ${rs(totals.net)} recorded as salaries`)
  }

  // ── Salary slips ─────────────────────────────────────────────────────────
  // The shop's own slip layout (salarySlip.ts): every day of the cycle, the
  // advance on the date it was taken, working days for daily staff. Amounts
  // come from the lines on screen, so an unsaved edit prints as shown; the
  // day-by-day detail is fetched fresh.
  async function printSlipsFor(which: Line[]) {
    if (which.length === 0) return
    // The pop-up must open inside the click, before any await, or the
    // browser blocks it as unrequested.
    const pending = window.open('', '_blank', 'width=820,height=900')
    pending?.document.write('<p style="font-family:Arial;padding:20px;color:#666">Preparing salary slips…</p>')
    try {
      const r = await fetch(`/api/vendor/payroll?period=${period}&detail=1`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Could not load the slip detail')
      printSlips(vendorName || 'Macforce Auto Engineering', j.cycle,
        which.map(l => ({ line: l, detail: j.detail?.[l.employee_id] })), pending)
    } catch (e: any) { pending?.close(); showToast('⚠️ ' + e.message) }
  }
  const printPayslip = (l: Line) => printSlipsFor([l])

  const printRun = () => printPayrollSheet(vendorName || 'Macforce Auto Engineering', cycleLabel(period), run, lines)

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading {period}…</div>

  return (
    <div>
      {/* ── Month + state ── */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <input type="month" value={period} max={colomboToday().slice(0, 7)}
            onChange={e => setPeriod(e.target.value)}
            className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold outline-none focus:border-orange-400" />
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-200">Cycle {cycleLabel(period)}</span>
          {isPaid
            ? <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                PAID {run.paid_date} · {PAID_FROM[run.payment_method] || run.payment_method}
              </span>
            : saved
              ? <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">DRAFT SAVED</span>
              : <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">NOT STARTED</span>}
          {dirty && <span className="text-[11px] font-bold text-orange-600">unsaved changes</span>}
        </div>

        <div className="flex items-center gap-2">
          {lines.length > 0 && (
            <button onClick={printRun} className="px-3 py-2 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
              🖨️ Payroll sheet
            </button>
          )}
          {lines.length > 0 && (
            <button onClick={() => printSlipsFor(lines)} className="px-3 py-2 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50">
              🧾 All salary slips
            </button>
          )}
          {!isPaid && lines.length > 0 && (
            <button onClick={saveDraft} disabled={busy}
              className="px-4 py-2 rounded-xl border-2 border-orange-300 text-xs font-black text-orange-700 hover:bg-orange-50 disabled:opacity-50">
              Save draft
            </button>
          )}
          {!isPaid && saved && !dirty && (
            <button onClick={() => setShowPay(true)} disabled={busy}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black disabled:opacity-50">
              Mark paid — {rs(totals.net)}
            </button>
          )}
          {isPaid && (
            <button onClick={() => { if (confirm('Reopen this payroll? The salary expenses will be reversed and the advances handed back.')) post({ action: 'reopen', runId: run.id }, 'Payroll reopened') }}
              disabled={busy} className="px-3 py-2 rounded-xl border-2 border-red-200 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">
              Reopen
            </button>
          )}
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-sm text-slate-400">
          No active staff to pay for {period}.
        </div>
      ) : (
        <>
          {/* ── Totals ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 rounded-xl overflow-hidden mb-4">
            {[
              { l: 'Gross earnings', v: totals.gross },
              { l: 'Deductions', v: totals.deductions },
              { l: 'Advances already taken', v: totals.advances },
              { l: 'To hand over', v: totals.net, hi: true },
            ].map(c => (
              <div key={c.l} className="bg-white px-4 py-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{c.l}</p>
                <p className={`font-black ${c.hi ? 'text-emerald-700 text-lg' : 'text-slate-800 text-sm'}`}>{rs(c.v)}</p>
              </div>
            ))}
          </div>

          {needsAttention.length > 0 && !isPaid && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 mb-4">
              <p className="text-xs font-black text-amber-800">
                {needsAttention.length} {needsAttention.length === 1 ? 'person needs' : 'people need'} a figure only you know
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                Commissions and profit shares aren&apos;t tracked anywhere yet — open each person below and enter the count or the amount.
                Anything left at zero is simply not paid.
              </p>
            </div>
          )}

          {/* ── People ── */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {lines.map((l: Line) => {
              const isOpen = open === l.employee_id
              const pending = (l.components || []).filter((c: any) => c.needsInput).length
              return (
                <div key={l.employee_id} className="border-b border-slate-100 last:border-0">
                  <button onClick={() => setOpen(isOpen ? null : l.employee_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
                    <span className="text-slate-300 text-xs w-3">{isOpen ? '▾' : '▸'}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-slate-800 truncate">{l.employee_name}</span>
                      <span className="block text-[11px] text-slate-400">
                        {l.branch} · {Number(l.payable_days)} day{Number(l.payable_days) !== 1 ? 's' : ''} payable
                        {Number(l.days_absent) > 0 && <span className="text-red-500"> · {Number(l.days_absent)} absent</span>}
                        {pending > 0 && !isPaid && <span className="text-amber-600 font-bold"> · {pending} to enter</span>}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-[11px] text-slate-400">
                        {rs(l.gross)}{r0(l.deductions) > 0 && ` − ${rs(l.deductions)}`}{r0(l.advances) > 0 && ` − ${rs(l.advances)} adv`}
                      </span>
                      <span className={`block text-sm font-black ${r0(l.net_pay) < 0 ? 'text-red-600' : 'text-slate-800'}`}>{rs(l.net_pay)}</span>
                    </span>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 bg-slate-50/70">
                      {(l.components || []).length === 0 ? (
                        <p className="text-xs text-slate-400 py-2">
                          No pay items set up for {l.employee_name} — add them in People before running payroll.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          {(l.components || []).map((c: any, idx: number) => (
                            <div key={idx} className={`flex items-center gap-2 rounded-lg px-3 py-2 bg-white border ${c.needsInput ? 'border-amber-300' : 'border-slate-200'}`}>
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded shrink-0 ${c.isDeduction ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                                {KIND_LABEL[c.kind] || c.kind}
                              </span>
                              <span className="flex-1 min-w-0 text-xs font-semibold text-slate-700 truncate">
                                {c.label}
                                {c.proratedFrom && (
                                  <span className="text-[10px] font-normal text-slate-400">
                                    {' '}· {c.proratedFrom.payableDays}/{c.proratedFrom.marked} days
                                  </span>
                                )}
                                {c.kind === 'loan' && (
                                  r0(c.amount) > r0(c.balance)
                                    ? <span className="text-[10px] font-bold text-red-600"> · only {rs(c.balance)} left on the loan</span>
                                    : <span className="text-[10px] font-normal text-slate-400">
                                        {' '}· {rs(r0(c.balance) - r0(c.amount))} left after{r0(c.amount) === 0 ? ' · skipped this month' : ''}
                                      </span>
                                )}
                              </span>

                              {/* per-event and daily rates are quantity × rate */}
                              {(c.period === 'per_event' || c.period === 'daily') && (
                                <span className="flex items-center gap-1 shrink-0">
                                  <input
                                    type="number" min={0} step="0.5" disabled={isPaid}
                                    value={c.qty ?? 0}
                                    onChange={e => editComponent(l.employee_id, idx, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                                    className="w-16 px-2 py-1 rounded border-2 border-slate-200 text-xs font-mono text-right outline-none focus:border-orange-400 disabled:bg-slate-100"
                                  />
                                  <span className="text-[10px] text-slate-400">× {rs(c.rate)}</span>
                                </span>
                              )}
                              {c.unit === 'percent' && c.period !== 'per_event' && c.period !== 'daily' && (
                                <span className="text-[10px] text-slate-400 shrink-0">{Number(c.rate)}%</span>
                              )}

                              <span className="flex items-center gap-1 shrink-0">
                                <span className="text-[10px] text-slate-400">Rs.</span>
                                <input
                                  type="number" disabled={isPaid}
                                  value={r0(c.amount)}
                                  onChange={e => editComponent(l.employee_id, idx, { amount: e.target.value === '' ? 0 : Number(e.target.value) })}
                                  className={`w-24 px-2 py-1 rounded border-2 text-xs font-mono font-bold text-right outline-none focus:border-orange-400 disabled:bg-slate-100 ${
                                    c.isDeduction ? 'border-red-200 text-red-700' : 'border-slate-200'
                                  }`}
                                />
                              </span>
                            </div>
                          ))}

                          {r0(l.advances) > 0 && (
                            <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-indigo-50 border border-indigo-200">
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 shrink-0">ADVANCES</span>
                              <span className="flex-1 text-xs font-semibold text-indigo-900">Already taken during {period}</span>
                              <span className="text-xs font-mono font-black text-indigo-800">− {rs(l.advances)}</span>
                            </div>
                          )}

                          <div className="flex items-center justify-between pt-1.5">
                            <input
                              type="text" disabled={isPaid} placeholder="Note on this payslip (optional)"
                              value={l.note || ''}
                              onChange={e => { setDirty(true); setLines(prev => prev.map(x => x.employee_id === l.employee_id ? { ...x, note: e.target.value } : x)) }}
                              className="flex-1 mr-3 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-orange-400 disabled:bg-slate-100"
                            />
                            <button onClick={() => printPayslip(l)} className="text-[11px] font-bold text-slate-500 hover:text-orange-600 shrink-0">
                              🧾 Salary slip
                            </button>
                          </div>

                          {r0(l.net_pay) < 0 && (
                            (l.components || []).some((c: any) => c.kind === 'loan' && r0(c.amount) > 0)
                              ? <p className="text-[11px] font-bold text-red-600">
                                  This month&apos;s pay doesn&apos;t cover the loan repayment — lower it or type 0 to skip the month.
                                </p>
                              : <p className="text-[11px] font-bold text-red-600">
                                  Advances exceed this month&apos;s pay by {rs(Math.abs(r0(l.net_pay)))} — nothing is handed over.
                                  When you mark it paid, that {rs(Math.abs(r0(l.net_pay)))} is carried into next month as an advance
                                  and comes off that pay.
                                </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          <p className="text-[11px] text-slate-400 mt-3">
            Marking the month paid posts one salaries expense per person for the balance handed over, settles their advances
            against this run, and — for a cash payday — takes it off that day&apos;s drawer.
          </p>
        </>
      )}

      {/* ── Payday confirmation ── */}
      {showPay && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowPay(false)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">Pay {period}</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">
              {lines.filter(l => r0(l.net_pay) > 0).length} people · {rs(totals.net)} handed over
            </p>

            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Paid on</label>
            <input type="date" value={payDate} max={colomboToday()} onChange={e => setPayDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 mb-3" />

            <label className="block text-[11px] font-bold text-slate-500 uppercase mb-1">Paid from</label>
            <div className="grid grid-cols-3 gap-1.5 mb-2">
              {([{ v: 'cash', l: '💵 Drawer' }, { v: 'online', l: '🏦 Online' }, { v: 'owner', l: '👤 My own money' }] as const).map(m => (
                <button key={m.v} onClick={() => setPayMethod(m.v)}
                  className={`py-2.5 rounded-xl border-2 text-sm font-bold ${payMethod === m.v ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
                  {m.l}
                </button>
              ))}
            </div>
            {payMethod === 'cash' && (
              <p className="text-[11px] text-amber-700 mb-2">
                {rs(totals.net)} will come off the drawer for {payDate}. Make sure that day&apos;s cash is counted after this.
              </p>
            )}
            {payMethod === 'owner' && (
              <p className="text-[11px] text-slate-500 mb-2">
                {rs(totals.net)} is booked as the shop&apos;s salary cost, paid by you personally. The drawer and bank are not touched, and Cash Flow shows it separately.
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <button onClick={() => setShowPay(false)} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
              <button onClick={markPaid} disabled={busy}
                className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-50">
                {busy ? 'Posting…' : 'Confirm payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
