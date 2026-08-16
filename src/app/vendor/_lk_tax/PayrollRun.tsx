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
import { escapeHtml } from '@/lib/escapeHtml'

const rs = (n: number) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()
const r0 = (n: any) => Math.round(Number(n) || 0)

const KIND_LABEL: Record<string, string> = {
  base: 'Base', allowance: 'Allowance', commission_rate: 'Commission',
  profit_rate: 'Profit share', epf: 'EPF', other: 'Other',
}

type Line = any

export default function PayrollRun({ showToast, vendorName }: { showToast: (m: string) => void; vendorName?: string }) {
  const [period, setPeriod] = useState(() => {
    // Default to LAST month — payroll is run after a month ends
    const [y, m] = colomboToday().slice(0, 7).split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const [lines, setLines] = useState<Line[]>([])
  const [run, setRun] = useState<any>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [payDate, setPayDate] = useState(colomboToday())
  const [payMethod, setPayMethod] = useState<'cash' | 'bank'>('cash')
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

  // ── Payslip ──────────────────────────────────────────────────────────────
  function printPayslip(l: Line) {
    const comps = (l.components || [])
    const earn = comps.filter((c: any) => !c.isDeduction && r0(c.amount) !== 0)
    const ded = comps.filter((c: any) => c.isDeduction && r0(c.amount) !== 0)
    const rows = (list: any[]) => list.map((c: any) =>
      `<tr><td>${escapeHtml(c.label)}${c.qty && Number(c.qty) !== 1
        ? `<span style="color:#888;font-size:10px"> — ${Number(c.qty)} × Rs.${Number(c.rate).toLocaleString()}</span>` : ''}</td>
        <td style="text-align:right">Rs.${r0(c.amount).toLocaleString()}</td></tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payslip ${escapeHtml(l.employee_name)} ${period}</title>
      <style>
        body{font-family:Arial,sans-serif;margin:24px;color:#111}
        h2{font-size:16px;margin:0} .sub{font-size:11px;color:#666}
        table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
        td,th{padding:5px 6px;border-bottom:1px solid #eee}
        .sec{font-size:11px;font-weight:800;text-transform:uppercase;color:#666;padding-top:12px}
        .net{font-size:15px;font-weight:800;background:#f4f4f4}
        @media print{@page{size:A5;margin:10mm}}
      </style></head><body>
      <h2>${escapeHtml(vendorName || 'MacForce Auto Engineering (Pvt) Ltd')}</h2>
      <div class="sub">PAYSLIP — ${period}</div>
      <table>
        <tr><td><strong>${escapeHtml(l.employee_name)}</strong><div class="sub">${escapeHtml(l.branch || '')}</div></td>
            <td style="text-align:right" class="sub">Days worked: ${Number(l.payable_days)}${
              Number(l.days_half) ? ` (${Number(l.days_present)} full, ${Number(l.days_half)} half)` : ''}</td></tr>
      </table>
      <div class="sec">Earnings</div>
      <table>${rows(earn)}<tr><td><strong>Gross</strong></td><td style="text-align:right"><strong>Rs.${r0(l.gross).toLocaleString()}</strong></td></tr></table>
      ${ded.length || r0(l.advances) ? `<div class="sec">Deductions</div><table>${rows(ded)}${
        r0(l.advances) ? `<tr><td>Advances taken during ${period}</td><td style="text-align:right">Rs.${r0(l.advances).toLocaleString()}</td></tr>` : ''
      }</table>` : ''}
      <table><tr class="net"><td>NET PAID</td><td style="text-align:right">Rs.${r0(l.net_pay).toLocaleString()}</td></tr></table>
      ${l.note ? `<p class="sub">${escapeHtml(String(l.note))}</p>` : ''}
      <p class="sub" style="margin-top:22px">Received by: ______________________ &nbsp;&nbsp; Date: ____________</p>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800)}</script>
      </body></html>`
    const w = window.open('', '_blank', 'width=760,height=800')
    if (w) { w.document.write(html); w.document.close() }
  }

  function printRun() {
    const rows = lines.map((l: Line) =>
      `<tr><td>${escapeHtml(l.employee_name)}<div style="font-size:10px;color:#888">${escapeHtml(l.branch || '')}</div></td>
       <td style="text-align:center">${Number(l.payable_days)}</td>
       <td style="text-align:right">Rs.${r0(l.gross).toLocaleString()}</td>
       <td style="text-align:right">Rs.${r0(l.deductions).toLocaleString()}</td>
       <td style="text-align:right">Rs.${r0(l.advances).toLocaleString()}</td>
       <td style="text-align:right;font-weight:700">Rs.${r0(l.net_pay).toLocaleString()}</td>
       <td style="width:110px"></td></tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payroll ${period}</title>
      <style>body{font-family:Arial,sans-serif;margin:20px}table{width:100%;border-collapse:collapse;font-size:12px}
      th,td{border:1px solid #ddd;padding:5px 7px}th{background:#f2f2f2;font-size:11px;text-transform:uppercase}
      @media print{@page{size:A4;margin:10mm}}</style></head><body>
      <h2 style="font-size:15px;margin:0">${escapeHtml(vendorName || 'MacForce Auto Engineering (Pvt) Ltd')}</h2>
      <div style="font-size:12px;color:#666;margin-bottom:10px">Payroll — ${period}${
        run?.status === 'paid' ? ` · paid ${escapeHtml(String(run.paid_date))} by ${escapeHtml(String(run.payment_method))}` : ' · DRAFT'}</div>
      <table><thead><tr><th>Employee</th><th>Days</th><th>Gross</th><th>Deductions</th><th>Advances</th><th>Net</th><th>Signature</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="font-weight:800;background:#fafafa"><td>TOTAL (${lines.length})</td><td></td>
        <td style="text-align:right">Rs.${totals.gross.toLocaleString()}</td>
        <td style="text-align:right">Rs.${totals.deductions.toLocaleString()}</td>
        <td style="text-align:right">Rs.${totals.advances.toLocaleString()}</td>
        <td style="text-align:right">Rs.${totals.net.toLocaleString()}</td><td></td></tr></tfoot></table>
      <p style="font-size:10px;color:#999;margin-top:14px">Generated ${new Date().toLocaleString('en-LK')}</p>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),800)}</script>
      </body></html>`
    const w = window.open('', '_blank', 'width=1000,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  if (loading) return <div className="p-8 text-center text-slate-400 text-sm">Loading {period}…</div>

  return (
    <div>
      {/* ── Month + state ── */}
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div className="flex items-center gap-2">
          <input type="month" value={period} max={colomboToday().slice(0, 7)}
            onChange={e => setPeriod(e.target.value)}
            className="px-3 py-2 rounded-xl border-2 border-slate-200 text-sm font-bold outline-none focus:border-orange-400" />
          {isPaid
            ? <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                PAID {run.paid_date} · {run.payment_method}
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
                              🧾 Payslip
                            </button>
                          </div>

                          {r0(l.net_pay) < 0 && (
                            <p className="text-[11px] font-bold text-red-600">
                              Advances exceed this month&apos;s pay by {rs(Math.abs(r0(l.net_pay)))} — nothing is handed over,
                              and the balance stays owing. Adjust an amount above if that isn&apos;t right.
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
            <div className="grid grid-cols-2 gap-1.5 mb-2">
              {([{ v: 'cash', l: '💵 Cash / drawer' }, { v: 'bank', l: '🏦 Bank' }] as const).map(m => (
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
