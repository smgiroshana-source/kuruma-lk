// ─────────────────────────────────────────────────────────────────────────────
// Payroll sheet — WHEEL MART
//
// The one-page summary of a salary cycle the owner signs off and staff sign
// against on payday (owner, 2026-09-24: "more well structured, nice
// looking"). Landscape A4: the cycle and its totals first, then everyone
// grouped by shop and workshop, each with how they're paid, what they earned
// and what came off, and a signature box. Figures are the payroll lines as
// shown on screen.
// ─────────────────────────────────────────────────────────────────────────────
import { escapeHtml } from '@/lib/escapeHtml'

const r0 = (n: any) => Math.round(Number(n) || 0)
const n = (v: any) => r0(v).toLocaleString('en-US')
const days = (v: any) => { const x = Number(v) || 0; return Number.isInteger(x) ? String(x) : x.toFixed(1) }

type Run = { status?: string; paid_date?: string | null; payment_method?: string | null } | null

const METHOD: Record<string, string> = { cash: 'cash from the drawer', online: 'bank transfer', owner: "the owner's own money" }

function payBasis(l: any): string {
  const base = (l.components || []).find((c: any) => c.kind === 'base' && !c.isDeduction)
  if (!base) return '<span class="muted">no pay set</span>'
  return base.period === 'daily' ? `Rs.${n(base.rate)} <span class="muted">/ day</span>` : `Rs.${n(base.rate)} <span class="muted">/ month</span>`
}

/** "Base 88,000 · Food allowance 11,000" — only the parts with money on them. */
function parts(l: any, deductions: boolean): string {
  return (l.components || [])
    .filter((c: any) => !!c.isDeduction === deductions && r0(c.amount) !== 0)
    .map((c: any) => `${escapeHtml(c.kind === 'loan' ? 'Loan' : c.kind === 'base' ? 'Base' : c.label)} ${n(c.amount)}`)
    .join(' · ')
}

/** The sheet as a full HTML document. */
export function payrollSheetHtml(company: string, cycleLabel: string, run: Run, lines: any[]): string {
  const sum = (list: any[], k: string) => list.reduce((s, l) => s + r0(l[k]), 0)
  const status = run?.status === 'paid'
    ? `<span class="pill paid">PAID</span> ${escapeHtml(String(run.paid_date || ''))} · ${escapeHtml(METHOD[String(run.payment_method)] || String(run.payment_method || ''))}`
    : '<span class="pill draft">DRAFT</span> not paid yet'

  const groups = [
    { key: 'shop', label: 'Shop' },
    { key: 'workshop', label: 'Workshop' },
  ].map(g => ({ ...g, lines: lines.filter(l => (l.branch || 'shop') === g.key) }))
   .concat([{ key: 'other', label: 'Other', lines: lines.filter(l => !['shop', 'workshop'].includes(l.branch || 'shop')) }])
   .filter(g => g.lines.length > 0)

  let i = 0
  const body = groups.map(g => {
    const rows = g.lines.map(l => {
      i++
      const earn = parts(l, false), ded = parts(l, true)
      const neg = r0(l.net_pay) < 0
      return `<tr>
        <td class="num-col">${i}</td>
        <td><div class="name">${escapeHtml(l.employee_name)}</div>${l.note ? `<div class="sub">${escapeHtml(String(l.note))}</div>` : ''}</td>
        <td>${payBasis(l)}</td>
        <td class="c">${days(l.payable_days)}${Number(l.days_absent) > 0 ? `<div class="sub">${days(l.days_absent)} absent</div>` : ''}</td>
        <td class="r"><div>${n(l.gross)}</div>${earn ? `<div class="sub">${earn}</div>` : ''}</td>
        <td class="r">${r0(l.deductions) ? `<div>${n(l.deductions)}</div>${ded ? `<div class="sub">${ded}</div>` : ''}` : '<span class="muted">–</span>'}</td>
        <td class="r">${r0(l.advances) ? n(l.advances) : '<span class="muted">–</span>'}</td>
        <td class="r net ${neg ? 'neg' : ''}">${n(l.net_pay)}${neg ? '<div class="sub">carried to next month</div>' : ''}</td>
        <td class="sign"></td>
      </tr>`
    }).join('')
    const subtotal = groups.length > 1 ? `<tr class="subtotal">
        <td></td><td colspan="3">${g.label} · ${g.lines.length} ${g.lines.length === 1 ? 'person' : 'people'}</td>
        <td class="r">${n(sum(g.lines, 'gross'))}</td><td class="r">${n(sum(g.lines, 'deductions'))}</td>
        <td class="r">${n(sum(g.lines, 'advances'))}</td><td class="r">${n(sum(g.lines, 'net_pay'))}</td><td></td></tr>` : ''
    return `${groups.length > 1 ? `<tr class="group"><td colspan="9">${g.label}</td></tr>` : ''}${rows}${subtotal}`
  }).join('')

  // Cash actually handed over: a negative line hands nothing over
  const handOver = lines.reduce((s, l) => s + Math.max(0, r0(l.net_pay)), 0)

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payroll sheet ${escapeHtml(cycleLabel)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#1f2328;margin:0;padding:10mm 12mm;font-size:11.5px}
    .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #1f2328;padding-bottom:8px}
    .co{font-size:19px;font-weight:800;letter-spacing:.2px}
    .title{font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c2410c;margin-top:3px}
    .meta{text-align:right;font-size:11.5px;line-height:1.6}
    .pill{display:inline-block;font-size:9.5px;font-weight:800;letter-spacing:1px;padding:1px 7px;border-radius:9px;vertical-align:1px}
    .pill.paid{background:#dcfce7;color:#166534} .pill.draft{background:#fef3c7;color:#92400e}
    .cards{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:12px 0 14px}
    .card{border:1px solid #d9dde3;border-radius:6px;padding:7px 10px}
    .card .l{font-size:9.5px;text-transform:uppercase;letter-spacing:1px;color:#6b7280}
    .card .v{font-size:16px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
    .card.hi{border-color:#1f2328;background:#f8f8f8}
    table{width:100%;border-collapse:collapse}
    th{font-size:9.5px;text-transform:uppercase;letter-spacing:.8px;color:#4b5563;text-align:left;padding:6px 7px;border-bottom:1.5px solid #1f2328;background:#f3f4f6}
    td{padding:7px 7px;border-bottom:1px solid #e5e7eb;vertical-align:top}
    .c{text-align:center} .r,th.r{text-align:right} th.c{text-align:center}
    td.r,td.c{font-variant-numeric:tabular-nums}
    .num-col{width:22px;color:#9ca3af}
    .name{font-weight:700} .sub{font-size:9.5px;color:#6b7280;margin-top:2px;line-height:1.35}
    .muted{color:#9ca3af}
    .net{font-weight:800;font-size:12.5px} .neg{color:#b91c1c}
    .sign{width:140px} tbody td{padding:10px 7px}
    tr.group td{font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#c2410c;background:#fff7ed;padding:5px 7px;border-bottom:1px solid #fed7aa}
    tr.subtotal td{font-weight:700;color:#374151;background:#fafafa;border-bottom:1.5px solid #d1d5db}
    tfoot td{font-weight:800;font-size:12.5px;border-top:2.5px solid #1f2328;border-bottom:none;padding-top:8px}
    .signoff{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin-top:34px;font-size:11px;color:#374151}
    .signoff div{border-top:1px solid #6b7280;padding-top:5px}
    .foot{margin-top:14px;font-size:9px;color:#9ca3af}
    @media print{@page{size:A4 landscape;margin:0} tr{page-break-inside:avoid}}
  </style></head><body>
  <div class="top">
    <div><div class="co">${escapeHtml(company)}</div><div class="title">Payroll sheet</div></div>
    <div class="meta"><div><strong>Salary cycle ${escapeHtml(cycleLabel)}</strong></div><div>${status}</div></div>
  </div>

  <div class="cards">
    <div class="card"><div class="l">People</div><div class="v">${lines.length}</div></div>
    <div class="card"><div class="l">Gross earned</div><div class="v">Rs.${n(sum(lines, 'gross'))}</div></div>
    <div class="card"><div class="l">Deductions</div><div class="v">Rs.${n(sum(lines, 'deductions'))}</div></div>
    <div class="card"><div class="l">Advances taken</div><div class="v">Rs.${n(sum(lines, 'advances'))}</div></div>
    <div class="card hi"><div class="l">To hand over</div><div class="v">Rs.${n(handOver)}</div></div>
  </div>

  <table>
    <thead><tr>
      <th class="num-col">#</th><th>Employee</th><th>Pay basis</th><th class="c">Days</th>
      <th class="r">Gross</th><th class="r">Deductions</th><th class="r">Advances</th><th class="r">Net pay</th><th>Signature</th>
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td></td><td colspan="3">Total · ${lines.length} ${lines.length === 1 ? 'person' : 'people'}</td>
      <td class="r">${n(sum(lines, 'gross'))}</td><td class="r">${n(sum(lines, 'deductions'))}</td>
      <td class="r">${n(sum(lines, 'advances'))}</td><td class="r">${n(sum(lines, 'net_pay'))}</td><td></td>
    </tr></tfoot>
  </table>

  <div class="signoff"><div>Prepared by</div><div>Approved by (owner)</div><div>Date paid</div></div>
  <div class="foot">All amounts in Sri Lankan rupees. Net pay = gross − deductions − advances already taken. Generated ${escapeHtml(new Date().toLocaleString('en-LK'))}.</div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`
  return html
}

export function printPayrollSheet(company: string, cycleLabel: string, run: Run, lines: any[]) {
  const w = window.open('', '_blank', 'width=1100,height=760')
  if (w) { w.document.write(payrollSheetHtml(company, cycleLabel, run, lines)); w.document.close() }
}
