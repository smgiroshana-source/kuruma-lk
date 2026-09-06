'use client'
// ── WHEEL MART ONLY — profit report + printable PDF ──────────────────────────
//
// Answers three questions the owner actually asks:
//   1. What did we make?            → summary, gross and net
//   2. On what?                     → per-product and line-by-line detail
//   3. What can't the figure see?   → items sold with NO cost, revenue only
//
// (3) is the honest part: those sales are NOT given an invented profit, and
// the report states what share of the period's revenue they represent, so a
// healthy-looking margin computed on half the takings can't mislead.

import { useState, useCallback } from 'react'
import { colomboToday } from '@/lib/dates'
import { escapeHtml } from '@/lib/escapeHtml'

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()

export default function ProfitReport({ showToast }: { showToast: (m: string) => void }) {
  const monthStart = colomboToday().slice(0, 7) + '-01'
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(colomboToday())
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/vendor/profit-report?from=${from}&to=${to}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to build the report')
      setData(j)
      if ((j.detail || []).length === 0) showToast('No sales in this period')
    } catch (e: any) { showToast('⚠️ ' + e.message); setData(null) }
    setLoading(false)
  }, [from, to, showToast])

  function printPdf(mode: 'summary' | 'full') {
    if (!data) return
    const s = data.summary
    const money = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString()
    const row = (label: string, value: string, opts: { bold?: boolean; color?: string; indent?: boolean } = {}) =>
      `<tr${opts.bold ? ' style="font-weight:700;background:#fafafa"' : ''}>
        <td${opts.indent ? ' style="padding-left:22px;color:#555"' : ''}>${label}</td>
        <td class="num"${opts.color ? ` style="color:${opts.color}"` : ''}>${value}</td>
      </tr>`

    const summaryTable = `
      <table class="fig">
        <tbody>
          ${row('Revenue with a known cost', money(s.knownRevenue), { bold: true })}
          ${row('Items sold at a real cost', money(s.realRevenue), { indent: true })}
          ${s.roughRevenue > 0 ? row('Items sold at a rough (estimated) cost', money(s.roughRevenue), { indent: true }) : ''}
          ${s.serviceRevenue > 0 ? row('Service / labour lines (no stock cost)', money(s.serviceRevenue), { indent: true }) : ''}
          ${row('Cost of goods sold', '− ' + money(s.realCogs + s.roughCogs), { bold: true })}
          ${row('GROSS PROFIT' + (s.grossMarginPct != null ? ` (${s.grossMarginPct}% margin)` : ''), money(s.grossProfit), { bold: true, color: s.grossProfit >= 0 ? '#15803d' : '#dc2626' })}
          ${row('Operating expenses' + (s.salaryPaidInWindow > 0 ? ' (excl. salary)' : ''), '− ' + money(s.expenseExclSalary), { bold: true })}
          ${s.salaryAccrual > 0 ? row('Salary for days worked' + (data.salary?.basis === 'estimated' ? ' (estimated)' : ''), '− ' + money(s.salaryAccrual), { bold: true }) : ''}
          ${s.writeoffTotal > 0 ? row('Stock written off', '− ' + money(s.writeoffTotal), { bold: true, color: '#b45309' }) : ''}
          ${s.supplierCreditTotal > 0 ? row('Supplier discounts received', '+ ' + money(s.supplierCreditTotal), { bold: true, color: '#15803d' }) : ''}
          ${row('NET PROFIT', money(s.netProfit), { bold: true, color: s.netProfit >= 0 ? '#15803d' : '#dc2626' })}
        </tbody>
      </table>
      ${s.salaryAccrual > 0 ? `
      <p class="note" style="border-left:3px solid #64748b;padding-left:10px;color:#475569">
        Salary is charged for the days worked in this period, not for when it is paid:
        monthly pay ÷ ${data.salary.workingDaysPerMonth} working days × days worked, and daily rates × days worked
        (${data.salary.staffCount} staff, ${data.salary.daysWorked} staff-days${data.salary.basis === 'estimated' ? ', estimated at 25 working days a month because no attendance is marked for these dates' : ', from the attendance register'}).
        ${s.salaryPaidInWindow > 0 ? `The <strong>${money(s.salaryPaidInWindow)}</strong> of salary and advances actually paid out in this period is that same cost, so it is not charged again.` : 'Nothing has been paid out for it yet.'}
      </p>` : ''}`

    // The no-cost block is deliberately OUTSIDE the profit arithmetic
    // ── Which line of trade earns what ──────────────────────────────────
    // Tyres, tubes, spare parts, consumables and labour are different trades
    // with different margins, and the shop's mix is the thing an owner acts on.
    // No extra entry made this possible: every line already carries its product.
    const groupBlock = (data.groups || []).length > 1 ? `
      <h3>By line of trade</h3>
      <table>
        <thead><tr><th>Group</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Share</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">Margin</th></tr></thead>
        <tbody>
          ${(data.groups || []).map((g: any) => `
            <tr>
              <td>${escapeHtml(g.group)}${g.noCostLines > 0 ? ` <span style="font-size:9px;color:#b45309">(${g.noCostLines} line${g.noCostLines !== 1 ? 's' : ''} with no cost — ${money(g.noCostRevenue)} not in profit)</span>` : ''}</td>
              <td class="num">${g.qty}</td>
              <td class="num">${money(g.revenue)}</td>
              <td class="num">${g.shareOfRevenuePct}%</td>
              <td class="num">${g.cost > 0 ? money(g.cost) : '—'}</td>
              <td class="num">${g.profit > 0 || g.cost > 0 ? money(g.profit) : '—'}</td>
              <td class="num">${g.marginPct != null ? g.marginPct + '%' : '—'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="note">Grouped by what the product is. A typed labour line has no cost, so its whole net amount is margin.</p>
    ` : ''

    const noCostBlock = s.noCostRevenue > 0 ? `
      <h3>Sold without a cost — revenue only</h3>
      <p class="note">
        These ${s.noCostQty} unit${s.noCostQty !== 1 ? 's' : ''} have no cost recorded, so no profit is claimed on them.
        Their ${money(s.noCostRevenue)} is <strong>not</strong> in the gross profit above.
        The profit figure therefore speaks for ${s.coveragePct}% of the period's ${money(s.totalRevenue)} revenue.
      </p>
      <table>
        <thead><tr><th>Part ID</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th></tr></thead>
        <tbody>
          ${data.noCost.map((n: any) => `<tr>
            <td class="mono">${escapeHtml(n.sku || '—')}</td>
            <td>${escapeHtml(n.name)}</td>
            <td class="num">${n.qty}</td>
            <td class="num">${money(n.revenue)}</td>
          </tr>`).join('')}
          <tr class="tot"><td colspan="2">Total revenue with no cost</td><td class="num">${s.noCostQty}</td><td class="num">${money(s.noCostRevenue)}</td></tr>
        </tbody>
      </table>` : ''

    const salaryBlock = (data.salary?.lines || []).length > 0 ? `
      <h3>Salary for days worked</h3>
      <table>
        <thead><tr><th>Staff</th><th>Pay basis</th><th class="num">Days worked</th><th class="num">Accrued</th></tr></thead>
        <tbody>
          ${data.salary.lines.map((l: any) => `<tr><td>${escapeHtml(l.name)}</td><td>${l.payType === 'daily' ? 'Daily rate × days' : 'Monthly ÷ ' + data.salary.workingDaysPerMonth + ' × days'}</td><td class="num">${l.daysWorked}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}
          <tr class="tot"><td colspan="3">Total</td><td class="num">${money(s.salaryAccrual)}</td></tr>
        </tbody>
      </table>` : ''

    const expenseBlock = data.expenses.length > 0 ? `
      <h3>Operating expenses</h3>
      <table>
        <thead><tr><th>Category</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${data.expenses.map((e: any) => `<tr><td>${escapeHtml(e.category)}${e.category === 'salaries' ? ' <span style="color:#64748b;font-size:11px">— paid out in this period; profit charges the accrual above instead</span>' : ''}</td><td class="num">${money(e.amount)}</td></tr>`).join('')}
          <tr class="tot"><td>Total</td><td class="num">${money(s.expenseTotal)}</td></tr>
        </tbody>
      </table>
      <p class="note">Shown net of any input VAT claimed back. Owner top-ups, banking and drawings are money moved, not expenses — they never appear here.</p>` : ''

    // Its own block, not folded into expenses: stock walking out unsold is a
    // different problem from spending money, and the owner needs to see it.
    const writeoffBlock = (data.writeoffs || []).length > 0 ? `
      <h3>Stock written off</h3>
      <table>
        <thead><tr><th>Reason</th><th class="num">Cost</th></tr></thead>
        <tbody>
          ${data.writeoffs.map((w: any) => `<tr><td>${escapeHtml(w.reason)}</td><td class="num">${money(w.amount)}</td></tr>`).join('')}
          <tr class="tot"><td>Total</td><td class="num">${money(s.writeoffTotal)}</td></tr>
        </tbody>
      </table>
      <p class="note">Goods that left the shelf without being sold. The cost is a loss of this period — it is not in cost of goods sold, because nothing was sold.</p>` : ''

    const creditBlock = (data.supplierCredits || []).length > 0 ? `
      <h3>Supplier discounts received</h3>
      <table>
        <thead><tr><th>Date</th><th>Credit note</th><th>Supplier</th><th>Reason</th><th class="num">Amount</th></tr></thead>
        <tbody>
          ${data.supplierCredits.map((c: any) => `<tr><td>${escapeHtml(c.date)}</td><td>${escapeHtml(c.no)}</td><td>${escapeHtml(c.supplier)}</td><td>${escapeHtml(String(c.reason).replace(/_/g, ' '))}</td><td class="num">${money(c.amount)}</td></tr>`).join('')}
          <tr class="tot"><td colspan="4">Total</td><td class="num">${money(s.supplierCreditTotal)}</td></tr>
        </tbody>
      </table>
      <p class="note">Net of VAT. The VAT on each note is recovered through the VAT return, not kept, so it is not profit.</p>` : ''

    const productBlock = `
      <h3>Profit by item</h3>
      <table>
        <thead><tr><th>Part ID</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">GP%</th></tr></thead>
        <tbody>
          ${data.byProduct.map((p: any) => `<tr>
            <td class="mono">${escapeHtml(p.sku || '—')}</td>
            <td>${escapeHtml(p.name)}${p.rough ? ' <span class="tag">~rough cost</span>' : ''}</td>
            <td class="num">${p.qty}</td>
            <td class="num">${money(p.revenue)}</td>
            <td class="num">${money(p.cost)}</td>
            <td class="num" style="color:${p.profit >= 0 ? '#15803d' : '#dc2626'}">${money(p.profit)}</td>
            <td class="num">${p.revenue > 0 ? Math.round((p.profit / p.revenue) * 100) + '%' : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>`

    const detailBlock = mode === 'full' ? `
      <h3>Line by line</h3>
      <table class="sm">
        <thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Item</th><th class="num">Qty</th><th class="num">Revenue</th><th class="num">Cost</th><th class="num">Profit</th><th>Basis</th></tr></thead>
        <tbody>
          ${data.detail.map((d: any) => `<tr${d.basis === 'none' ? ' style="background:#fff7ed"' : ''}>
            <td>${d.date}</td>
            <td class="mono">${escapeHtml(d.invoice)}</td>
            <td>${escapeHtml(d.customer)}</td>
            <td>${escapeHtml(d.name)}</td>
            <td class="num">${d.qty}</td>
            <td class="num">${money(d.revenue)}</td>
            <td class="num">${d.basis === 'none' ? '—' : money(d.cost)}</td>
            <td class="num" style="color:${d.basis === 'none' ? '#b45309' : d.profit >= 0 ? '#15803d' : '#dc2626'}">${d.basis === 'none' ? 'no cost' : money(d.profit)}</td>
            <td class="tag-cell">${d.basis === 'real' ? 'cost' : d.basis === 'rough' ? '~rough' : d.basis === 'service' ? 'service' : 'none'}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Profit report ${data.period.from} to ${data.period.to}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;margin:22px;color:#111}
        h1{font-size:17px;margin:0}
        h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#555;margin:20px 0 6px;border-bottom:1.5px solid #ddd;padding-bottom:4px}
        .sub{font-size:11px;color:#666}
        table{width:100%;border-collapse:collapse;font-size:11px}
        th,td{border-bottom:1px solid #eee;padding:5px 6px;text-align:left;vertical-align:top}
        th{background:#f4f4f4;font-size:10px;text-transform:uppercase;letter-spacing:.4px}
        .num{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
        .mono{font-family:ui-monospace,Menlo,monospace;font-size:10px}
        .fig td{font-size:12px;padding:6px}
        .tot{font-weight:700;background:#fafafa}
        .tag{font-size:9px;background:#fef3c7;color:#92400e;padding:1px 4px;border-radius:3px}
        .tag-cell{font-size:9px;color:#777}
        .sm{font-size:10px}
        .note{font-size:10.5px;color:#555;line-height:1.5;margin:6px 0 10px}
        .foot{margin-top:18px;font-size:9.5px;color:#999;border-top:1px solid #eee;padding-top:8px}
        @media print{@page{size:A4 ${mode === 'full' ? 'landscape' : 'portrait'};margin:10mm}}
      </style></head><body>
      <h1>${escapeHtml(data.entity)}</h1>
      <div class="sub">${data.tin ? 'TIN ' + escapeHtml(data.tin) + ' · ' : ''}Profit report · ${data.period.from} to ${data.period.to}${mode === 'summary' ? ' · summary' : ' · detailed'}</div>

      <h3>Summary</h3>
      ${summaryTable}
      <p class="note">
        ${data.vat.isVatEntity ? `Revenue is shown NET of ${data.vat.rate}% VAT on tax invoices — the VAT is payable to IRD, not margin. ` : ''}
        Returned quantities are excluded. Voided invoices are excluded.
      </p>

      ${groupBlock}
      ${noCostBlock}
      ${salaryBlock}
      ${expenseBlock}
      ${writeoffBlock}
      ${creditBlock}
      ${mode === 'full' ? productBlock + detailBlock : productBlock}

      <div class="foot">
        ${s.saleCount} invoice${s.saleCount !== 1 ? 's' : ''} · ${s.lineCount} line${s.lineCount !== 1 ? 's' : ''} ·
        Generated ${new Date().toLocaleString('en-LK')} · Internal management report, not a tax document.
      </div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),900)}</script>
      </body></html>`

    const w = window.open('', '_blank', 'width=1100,height=800')
    if (w) { w.document.write(html); w.document.close() }
  }

  const s = data?.summary

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <h3 className="font-bold text-sm text-slate-800 mb-1">📈 Profit report</h3>
      <p className="text-[11px] text-slate-400 mb-3">
        Gross and net profit, item by item. Sales with no cost recorded are reported separately — revenue only, never an invented profit.
      </p>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setData(null) }}
            className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label>
          <input type="date" value={to} max={colomboToday()} onChange={e => { setTo(e.target.value); setData(null) }}
            className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
        </div>
        <button onClick={run} disabled={loading}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">
          {loading ? '⏳ Working…' : '🔍 Run report'}
        </button>
        {[
          { l: 'This month', f: colomboToday().slice(0, 7) + '-01', t: colomboToday() },
          { l: 'Last 30 days', f: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), t: colomboToday() },
        ].map(p => (
          <button key={p.l} onClick={() => { setFrom(p.f); setTo(p.t); setData(null) }}
            className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">{p.l}</button>
        ))}
      </div>

      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-200 rounded-xl overflow-hidden mb-3">
            {[
              { l: 'Revenue (with cost)', v: rs(s.knownRevenue) },
              { l: 'Cost of goods', v: rs(s.realCogs + s.roughCogs) },
              { l: `Gross profit${s.grossMarginPct != null ? ` · ${s.grossMarginPct}%` : ''}`, v: rs(s.grossProfit), hi: true },
              { l: s.writeoffTotal > 0 ? 'Net after expenses & write-offs' : 'Net after expenses', v: rs(s.netProfit), hi: true },
            ].map(c => (
              <div key={c.l} className="bg-white px-4 py-3">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{c.l}</p>
                <p className={`font-black ${c.hi ? (Number(String(c.v).replace(/\D/g, '')) >= 0 ? 'text-emerald-700 text-lg' : 'text-red-600 text-lg') : 'text-slate-800 text-sm'}`}>{c.v}</p>
              </div>
            ))}
          </div>

          {(data.groups || []).length > 1 && (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden mb-3">
              <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                <p className="text-xs font-black text-slate-700">By line of trade</p>
                <p className="text-[10px] text-slate-400">Tyres, spare parts and labour earn differently — this is the mix.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[10px] uppercase text-slate-400">
                      <th className="text-left px-4 py-2 font-bold">Group</th>
                      <th className="text-right px-3 py-2 font-bold">Revenue</th>
                      <th className="text-right px-3 py-2 font-bold">Share</th>
                      <th className="text-right px-3 py-2 font-bold">Profit</th>
                      <th className="text-right px-4 py-2 font-bold">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.groups || []).map((g: any) => (
                      <tr key={g.group} className="border-t border-slate-100">
                        <td className="px-4 py-2">
                          <span className="font-semibold text-slate-800">{g.group}</span>
                          <span className="block text-[10px] text-slate-400">{g.qty} unit{g.qty !== 1 ? 's' : ''} · {g.lines} line{g.lines !== 1 ? 's' : ''}</span>
                          {g.noCostLines > 0 && (
                            <span className="block text-[10px] font-semibold text-amber-700">
                              {g.noCostLines} line{g.noCostLines !== 1 ? 's' : ''} with no cost — {rs(g.noCostRevenue)} not in profit
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-bold text-slate-800">{rs(g.revenue)}</td>
                        <td className="px-3 py-2 text-right text-slate-500">{g.shareOfRevenuePct}%</td>
                        <td className="px-3 py-2 text-right font-bold text-emerald-700">{g.cost > 0 || g.profit > 0 ? rs(g.profit) : '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold text-slate-600">{g.marginPct != null ? g.marginPct + '%' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {s.noCostRevenue > 0 && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 mb-3">
              <p className="text-xs font-black text-amber-800">
                {rs(s.noCostRevenue)} sold with no cost recorded ({s.noCostQty} unit{s.noCostQty !== 1 ? 's' : ''})
              </p>
              <p className="text-[11px] text-amber-700 mt-0.5">
                No profit is claimed on these — the figures above speak for {s.coveragePct}% of the period&apos;s {rs(s.totalRevenue)} revenue.
                They&apos;re listed on their own page in the PDF.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => printPdf('summary')}
              className="bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Summary PDF</button>
            <button onClick={() => printPdf('full')}
              className="bg-slate-700 hover:bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📑 Detailed PDF (line by line)</button>
            <span className="text-[11px] text-slate-400 self-center">
              {s.saleCount} invoice{s.saleCount !== 1 ? 's' : ''} · {s.lineCount} lines
            </span>
          </div>
        </>
      )}
    </div>
  )
}
