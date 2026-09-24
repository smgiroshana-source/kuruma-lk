// ─────────────────────────────────────────────────────────────────────────────
// Salary slip — WHEEL MART
//
// The slip each person is handed on payday. It keeps what the shop's paper
// slips always showed (owner, 2026-09-23, samples for Buddhini and
// Abubakker): every day of the 25th→24th cycle, the advance taken on each
// date, working days for daily-paid staff, then totals and the amount due.
// Restyled 2026-09-24 ("more well structured, nice looking"): a header band,
// the staff details, the days in two side-by-side columns so the month reads
// at a glance, and a pay summary that builds up to the amount due.
//
// Figures come from the payroll line exactly as the owner left it, so the
// slip always agrees with what is actually paid.
// ─────────────────────────────────────────────────────────────────────────────
import { escapeHtml } from '@/lib/escapeHtml'

export type SlipDetail = {
  pay_type: 'daily' | 'monthly' | string
  attendance: { date: string; status: string }[]
  advances: { date: string; amount: number; note: string | null }[]
  next_raise: { item_label: string; effective_from: string; new_amount: number } | null
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const r0 = (n: any) => Math.round(Number(n) || 0)
const n = (v: any) => r0(v).toLocaleString('en-US')
const utc = (iso: string) => new Date(iso + 'T00:00:00Z')
const dayLabel = (iso: string) => { const d = utc(iso); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }
const dayValue = (status: string) => status === 'present' ? 1 : status === 'half' ? 0.5 : status === 'absent' ? 0 : null
const fmtDays = (x: number) => Number.isInteger(x) ? String(x) : x.toFixed(1)

function daysOfCycle(from: string, to: string): string[] {
  const out: string[] = []
  const d = utc(from), end = utc(to)
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

export const SLIP_CSS = `
  *{box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;color:#1f2328;margin:0;font-size:11.5px}
  .slip{padding:11mm 13mm 9mm;page-break-after:always;max-width:210mm;margin:0 auto}
  .slip:last-child{page-break-after:auto}
  .band{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #1f2328;padding-bottom:7px}
  .co{font-size:18px;font-weight:800}
  .kind{font-size:11px;font-weight:700;letter-spacing:2.5px;color:#c2410c;margin-top:3px}
  .cyc{text-align:right;font-size:11px;color:#4b5563;line-height:1.5}
  .cyc strong{display:block;font-size:14px;color:#1f2328;letter-spacing:1px}
  .who{display:grid;grid-template-columns:2.2fr 1fr 1.3fr;gap:0;margin:10px 0 12px;border:1px solid #d9dde3;border-radius:6px}
  .who>div{padding:7px 10px;border-right:1px solid #e5e7eb}
  .who>div:last-child{border-right:none}
  .lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;color:#6b7280}
  .val{font-size:13px;font-weight:700;margin-top:2px}
  .raise{font-size:9.5px;color:#15803d;font-weight:700;margin-top:2px}
  .sec{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:1.5px;color:#4b5563;margin:0 0 5px}
  .days{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  table{width:100%;border-collapse:collapse}
  .days th{font-size:9px;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;text-align:left;padding:3px 5px;border-bottom:1.5px solid #1f2328}
  .days td{padding:2.6px 5px;border-bottom:1px solid #eef0f2;font-variant-numeric:tabular-nums;height:18px}
  .days th.c,.days td.c{text-align:center} .days th.r,.days td.r{text-align:right}
  .wd{color:#9ca3af;font-size:9.5px;margin-left:3px}
  tr.sun td{background:#fafafa}
  tr.adv td{font-weight:700} tr.adv td.r{color:#b45309}
  .abs{color:#b91c1c}
  .bf td{font-size:10px;color:#6b7280;font-style:italic}
  .key{font-size:9px;color:#9ca3af;margin-top:4px}
  .pay{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px;align-items:start}
  .box{border:1px solid #d9dde3;border-radius:6px;padding:8px 10px}
  .box td{padding:3.5px 0;font-variant-numeric:tabular-nums} .box td.r{text-align:right}
  .box .sub{font-size:9.5px;color:#6b7280}
  .box tr.tot td{border-top:1px solid #d1d5db;font-weight:800;padding-top:5px}
  .minus{color:#b45309}
  .due{margin-top:10px;background:#1f2328;color:#fff;border-radius:6px;padding:9px 12px;display:flex;justify-content:space-between;align-items:center}
  .due .l{font-size:10px;letter-spacing:2px;text-transform:uppercase}
  .due .v{font-size:20px;font-weight:800;font-variant-numeric:tabular-nums}
  .due.neg{background:#b91c1c}
  .note{font-size:10.5px;color:#374151;margin-top:8px;padding:6px 9px;background:#f9fafb;border-left:3px solid #d1d5db}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:30px;font-size:10.5px;color:#374151}
  .sign div{border-top:1px solid #6b7280;padding-top:4px}
  .foot{font-size:8.5px;color:#9ca3af;margin-top:10px}
  @media print{@page{size:A4;margin:0}}
`

/** One slip, as an HTML fragment (a page of its own when printed). */
export function slipHtml(company: string, cycle: { from: string; to: string }, line: any, detail: SlipDetail | undefined): string {
  const daily = detail?.pay_type === 'daily'
  const comps: any[] = line.components || []
  const base = comps.find(c => c.kind === 'base' && !c.isDeduction)
  const otherEarnings = comps.filter(c => !c.isDeduction && c !== base && r0(c.amount) !== 0)
  const deductions = comps.filter(c => c.isDeduction && r0(c.amount) !== 0)

  const f = utc(cycle.from), t = utc(cycle.to)
  const monthLabel = `${MON[f.getUTCMonth()].toUpperCase()} / ${MON[t.getUTCMonth()].toUpperCase()} ${t.getUTCFullYear()}`
  const cycleText = `${dayLabel(cycle.from)} ${f.getUTCFullYear()} – ${dayLabel(cycle.to)} ${t.getUTCFullYear()}`

  const rateText = !base ? '—'
    : daily ? `Rs ${n(base.rate)} a day` : `Rs ${n(base.amount ?? base.rate)} a month`
  const extras = comps.filter(c => !c.isDeduction && c !== base && r0(c.rate) > 0 && c.unit !== 'percent' && c.period === 'daily')
    .map(c => `+ ${escapeHtml(String(c.label).toLowerCase())} Rs ${n(c.rate)}`).join(' ')
  const raise = detail?.next_raise
    ? (() => { const d = utc(detail.next_raise!.effective_from); return `From ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}: Rs ${n(detail.next_raise!.new_amount)}` })()
    : ''

  // Advances and attendance by date
  const advByDate = new Map<string, number>()
  for (const a of detail?.advances || []) advByDate.set(a.date, (advByDate.get(a.date) || 0) + r0(a.amount))
  const attByDate = new Map<string, number | null>()
  for (const a of detail?.attendance || []) attByDate.set(a.date, dayValue(a.status))

  const days = daysOfCycle(cycle.from, cycle.to)
  const carried = [...advByDate.keys()].filter(d => d < cycle.from).sort()
  let dayTotal = 0
  const row = (d: string) => {
    const v = attByDate.get(d)
    if (typeof v === 'number') dayTotal += v
    const adv = advByDate.get(d)
    const wd = utc(d).getUTCDay()
    return `<tr class="${wd === 0 ? 'sun' : ''} ${adv ? 'adv' : ''}">
      <td>${dayLabel(d)}<span class="wd">${WD[wd]}</span></td>
      ${daily ? `<td class="c ${v === 0 ? 'abs' : ''}">${v == null ? '' : fmtDays(v)}</td>` : ''}
      <td class="r">${adv ? n(adv) : ''}</td></tr>`
  }
  const half = Math.ceil(days.length / 2)
  const head = `<thead><tr><th>Date</th>${daily ? '<th class="c">Worked</th>' : ''}<th class="r">Advance</th></tr></thead>`
  const left = days.slice(0, half).map(row).join('')
  const right = days.slice(half).map(row).join('')
  const bf = carried.map(d => `<tr class="bf"><td>${dayLabel(d)} · brought forward</td>${daily ? '<td></td>' : ''}<td class="r">${n(advByDate.get(d))}</td></tr>`).join('')

  // The deducted total is the payroll line's, which the owner may have
  // edited; if it differs from the dated advances, say so in the summary.
  const datedTotal = [...advByDate.values()].reduce((s, x) => s + x, 0)
  const adjust = r0(line.advances) - datedTotal

  const earnRows = [
    base ? `<tr><td>${daily ? `Salary<div class="sub">${fmtDays(Number(base.qty) || 0)} days × Rs ${n(base.rate)}</div>` : 'Monthly salary'}</td><td class="r">${n(base.amount)}</td></tr>` : '',
    ...otherEarnings.map(c => `<tr><td>${escapeHtml(c.label)}${c.qty && Number(c.qty) !== 1 ? `<div class="sub">${fmtDays(Number(c.qty))} × Rs ${n(c.rate)}</div>` : ''}</td><td class="r">${n(c.amount)}</td></tr>`),
    `<tr class="tot"><td>Total earned</td><td class="r">${n(line.gross)}</td></tr>`,
  ].join('')
  const lessRows = [
    `<tr><td>Advances taken${adjust !== 0 ? '<div class="sub">as adjusted in payroll</div>' : ''}</td><td class="r minus">${r0(line.advances) ? n(line.advances) : '–'}</td></tr>`,
    ...deductions.map(c => c.kind === 'loan'
      ? `<tr><td>Loan repayment<div class="sub">balance after this: Rs ${n(r0(c.balance) - r0(c.amount))}</div></td><td class="r minus">${n(c.amount)}</td></tr>`
      : `<tr><td>${escapeHtml(c.label)}</td><td class="r minus">${n(c.amount)}</td></tr>`),
    `<tr class="tot"><td>Total deducted</td><td class="r">${n(r0(line.advances) + r0(line.deductions))}</td></tr>`,
  ].join('')

  const neg = r0(line.net_pay) < 0

  return `
  <section class="slip">
    <div class="band">
      <div><div class="co">${escapeHtml(company)}</div><div class="kind">SALARY SLIP</div></div>
      <div class="cyc"><strong>${monthLabel}</strong>Cycle ${cycleText}</div>
    </div>

    <div class="who">
      <div><div class="lbl">Name</div><div class="val">${escapeHtml(line.employee_name)}</div></div>
      <div><div class="lbl">Paid</div><div class="val">${daily ? 'Daily' : 'Monthly'}</div></div>
      <div><div class="lbl">Rate</div><div class="val">${rateText}</div>${extras ? `<div class="sub">${extras}</div>` : ''}${raise ? `<div class="raise">${escapeHtml(raise)}</div>` : ''}</div>
    </div>

    <p class="sec">Daily record</p>
    <div class="days">
      <table>${head}<tbody>${bf}${left}</tbody></table>
      <table>${head}<tbody>${right}</tbody></table>
    </div>
    <p class="key">${daily ? `Worked: 1 full day · 0.5 half day · 0 absent · blank not marked. Total worked: <strong>${fmtDays(dayTotal)}</strong> days. ` : ''}Advances in rupees on the day they were taken.</p>

    <div class="pay">
      <div class="box"><p class="sec">Earned</p><table>${earnRows}</table></div>
      <div class="box"><p class="sec">Less</p><table>${lessRows}</table></div>
    </div>

    <div class="due ${neg ? 'neg' : ''}">
      <span class="l">${neg ? 'Carried to next month' : 'Amount due'}</span>
      <span class="v">Rs ${n(neg ? -r0(line.net_pay) : line.net_pay)}</span>
    </div>
    ${line.note ? `<div class="note">${escapeHtml(String(line.note))}</div>` : ''}

    <div class="sign"><div>Received by (employee)</div><div>Paid by · date</div></div>
    <div class="foot">All amounts in Sri Lankan rupees. Amount due = total earned − total deducted.</div>
  </section>`
}

/** Full document with one or more slips, one per A4 page. */
export function slipsDocument(company: string, cycle: { from: string; to: string }, items: { line: any; detail?: SlipDetail }[]): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Salary slips ${cycle.to.slice(0, 7)}</title>
  <style>${SLIP_CSS}</style></head><body>
  ${items.map(i => slipHtml(company, cycle, i.line, i.detail)).join('')}
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`
}

/** Print one or more slips, one per A4 page. Pass a window opened inside the
 * click handler when the data arrives after an await — a window opened later
 * is blocked by the browser as a pop-up. */
export function printSlips(company: string, cycle: { from: string; to: string }, items: { line: any; detail?: SlipDetail }[], target?: Window | null) {
  const w = target || window.open('', '_blank', 'width=820,height=900')
  if (w) { w.document.open(); w.document.write(slipsDocument(company, cycle, items)); w.document.close() }
}
