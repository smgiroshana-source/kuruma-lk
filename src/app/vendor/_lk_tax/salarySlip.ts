// ─────────────────────────────────────────────────────────────────────────────
// Salary slip — WHEEL MART
//
// Prints the slip in the layout the shop already hands out (owner,
// 2026-09-23, from the paper samples for Buddhini and Abubakker): every day
// of the 25th→24th cycle down the page, the advance taken on each date in
// brackets, working days per date for daily-paid staff, then the totals and
// the amount due. Figures come from the payroll line exactly as the owner
// left it, so the slip always agrees with what is actually paid.
// ─────────────────────────────────────────────────────────────────────────────
import { escapeHtml } from '@/lib/escapeHtml'

export type SlipDetail = {
  pay_type: 'daily' | 'monthly' | string
  attendance: { date: string; status: string }[]
  advances: { date: string; amount: number; note: string | null }[]
  next_raise: { item_label: string; effective_from: string; new_amount: number } | null
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const r0 = (n: any) => Math.round(Number(n) || 0)
const rs = (n: any) => 'Rs ' + r0(n).toLocaleString('en-US')
const bracket = (n: any) => '(' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')'
const dayLabel = (iso: string) => { const d = new Date(iso + 'T00:00:00Z'); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }
const dayValue = (status: string) => status === 'present' ? 1 : status === 'half' ? 0.5 : status === 'absent' ? 0 : null
const fmtDays = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(1)

function daysOfCycle(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00Z'), end = new Date(to + 'T00:00:00Z')
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

/** One slip, as an HTML fragment (a page of its own when printed). */
export function slipHtml(company: string, cycle: { from: string; to: string }, line: any, detail: SlipDetail | undefined): string {
  const daily = detail?.pay_type === 'daily'
  const comps: any[] = line.components || []
  const base = comps.find(c => c.kind === 'base' && !c.isDeduction)
  const otherEarnings = comps.filter(c => !c.isDeduction && c !== base && r0(c.amount) !== 0)
  const deductions = comps.filter(c => c.isDeduction && r0(c.amount) !== 0)

  const f = new Date(cycle.from + 'T00:00:00Z'), t = new Date(cycle.to + 'T00:00:00Z')
  const monthLabel = `${MON[f.getUTCMonth()].toUpperCase()}/${MON[t.getUTCMonth()].toUpperCase()} ${t.getUTCFullYear()}`

  // Salary line: monthly shows the month's amount; daily shows the day rate
  // and every other rate that rides on it ("4000 + night Rs.250").
  const salaryText = daily
    ? `Rs ${r0(base?.rate).toLocaleString('en-US')} a day` + comps
        .filter(c => !c.isDeduction && c !== base && r0(c.rate) > 0 && c.unit !== 'percent')
        .map(c => ` + ${escapeHtml(String(c.label).toLowerCase())} Rs.${r0(c.rate).toLocaleString('en-US')}`).join('')
    : rs(base?.amount ?? base?.rate)
  const raise = detail?.next_raise
    ? (() => { const d = new Date(detail.next_raise!.effective_from + 'T00:00:00Z'); return `From ${d.getUTCFullYear()} ${MON[d.getUTCMonth()]} salary – ${r0(detail.next_raise!.new_amount).toLocaleString('en-US')}` })()
    : ''

  // Advances by date. Anything taken before the cycle began and never
  // deducted is carried in at the top on its own date.
  const advByDate = new Map<string, number>()
  for (const a of detail?.advances || []) advByDate.set(a.date, (advByDate.get(a.date) || 0) + r0(a.amount))
  const attByDate = new Map<string, number | null>()
  for (const a of detail?.attendance || []) attByDate.set(a.date, dayValue(a.status))

  const days = daysOfCycle(cycle.from, cycle.to)
  const carried = [...advByDate.keys()].filter(d => d < cycle.from).sort()
  let dayTotal = 0
  const cell = (v: string, cls = '') => `<td class="${cls}">${v}</td>`
  const rows: string[] = []
  for (const d of carried) {
    rows.push(`<tr>${cell(dayLabel(d) + ' <span class="bf">b/f</span>')}${daily ? cell('', 'c') : ''}${cell(bracket(advByDate.get(d)), 'r')}</tr>`)
  }
  for (const d of days) {
    const v = attByDate.get(d)
    if (typeof v === 'number') dayTotal += v
    const adv = advByDate.get(d)
    rows.push(`<tr>${cell(dayLabel(d))}${daily ? cell(v == null ? '' : fmtDays(v), 'c') : ''}${cell(adv ? bracket(adv) : '', 'r')}</tr>`)
  }

  // The deducted total is the payroll line's, which the owner may have
  // edited; if it differs from the dated advances, show the difference so
  // the column still adds up to what came off.
  const datedTotal = [...advByDate.values()].reduce((s, n) => s + n, 0)
  const diff = r0(line.advances) - datedTotal
  if (diff !== 0) rows.push(`<tr>${cell('<em>Adjusted in payroll</em>')}${daily ? cell('', 'c') : ''}${cell(bracket(diff), 'r')}</tr>`)

  const earningRows = [
    daily && base ? `<tr><td>No of working days</td><td class="c">${fmtDays(Number(base.qty) || 0)}</td><td class="r">${rs(base.amount)}</td></tr>` : '',
    ...otherEarnings.map(c => `<tr><td>${escapeHtml(c.label)}</td><td class="c">${c.qty && Number(c.qty) !== 1 ? `${fmtDays(Number(c.qty))} × ${r0(c.rate).toLocaleString('en-US')}` : ''}</td><td class="r">${rs(c.amount)}</td></tr>`),
    ...deductions.map(c => c.kind === 'loan'
      ? `<tr><td>Loan<div class="bal">balance after this: ${rs(r0(c.balance) - r0(c.amount))}</div></td><td class="c"></td><td class="r">${bracket(c.amount)}</td></tr>`
      : `<tr><td>${escapeHtml(c.label)}</td><td class="c"></td><td class="r">${bracket(c.amount)}</td></tr>`),
  ].join('')

  return `
  <section class="slip">
    <h1>${escapeHtml(company)}</h1>
    <table class="head">
      <tr><td class="k">Name</td><td class="v">${escapeHtml(line.employee_name)}</td><td class="k">Month</td><td class="v">${monthLabel}</td></tr>
      <tr><td class="k">Salary</td><td class="v" colspan="3">${salaryText}${raise ? `<div class="raise">${escapeHtml(raise)}</div>` : ''}</td></tr>
    </table>
    <table class="grid">
      <thead><tr><th>Date</th>${daily ? '<th class="c">Working days</th>' : ''}<th class="r">Advance</th></tr></thead>
      <tbody>${rows.join('')}</tbody>
      <tfoot><tr><td>Total Advance</td>${daily ? `<td class="c">${fmtDays(dayTotal)}</td>` : ''}<td class="r">${bracket(r0(line.advances))}</td></tr></tfoot>
    </table>
    <table class="sum">
      ${!daily ? `<tr><td>Salary</td><td class="c"></td><td class="r">${rs(base?.amount)}</td></tr>` : ''}
      ${earningRows}
      <tr><td>Total Advance</td><td class="c"></td><td class="r">${bracket(r0(line.advances))}</td></tr>
      <tr class="due"><td>Amount Due</td><td class="c"></td><td class="r">${rs(line.net_pay)}</td></tr>
    </table>
    ${line.note ? `<p class="note">${escapeHtml(String(line.note))}</p>` : ''}
    <p class="sign">Received by: ________________________ &nbsp;&nbsp; Date: ______________</p>
    <p class="cyc">Salary cycle ${dayLabel(cycle.from)} ${f.getUTCFullYear()} – ${dayLabel(cycle.to)} ${t.getUTCFullYear()}</p>
  </section>`
}

/** Print one or more slips, one per A4 page. Pass a window opened inside the
 * click handler when the data arrives after an await — a window opened later
 * is blocked by the browser as a pop-up. */
export function printSlips(company: string, cycle: { from: string; to: string }, items: { line: any; detail?: SlipDetail }[], target?: Window | null) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Salary slips ${cycle.to.slice(0, 7)}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0}
    .slip{padding:14mm 16mm;page-break-after:always;max-width:190mm;margin:0 auto}
    .slip:last-child{page-break-after:auto}
    h1{font-size:17px;text-align:center;margin:0 0 10px}
    table{width:100%;border-collapse:collapse}
    .head td{padding:4px 6px;font-size:12.5px}
    .head .k{width:14%;color:#555} .head .v{font-weight:700}
    .raise{font-weight:400;font-size:11px;color:#444;margin-top:2px}
    .grid{margin-top:8px;font-size:11px}
    .grid th{font-size:10.5px;text-align:left;border-bottom:1.5px solid #333;padding:3px 6px}
    .grid th.c{text-align:center} .grid th.r{text-align:right}
    .grid td{padding:1.6px 6px;border-bottom:1px solid #eee;height:15px}
    .grid tfoot td{border-top:1.5px solid #333;border-bottom:none;font-weight:700;padding-top:4px}
    .c{text-align:center} .r{text-align:right;font-variant-numeric:tabular-nums}
    .bf{font-size:9px;color:#888} .bal{font-size:10px;color:#666}
    .sum{margin-top:10px;font-size:12.5px} .sum td{padding:3px 6px}
    .sum .due td{border-top:2px solid #111;font-weight:800;font-size:14px;padding-top:6px}
    .note{font-size:11px;color:#444;margin:8px 0 0}
    .sign{font-size:11.5px;margin-top:26px} .cyc{font-size:9.5px;color:#999;margin-top:6px}
    @media print{@page{size:A4;margin:0}}
  </style></head><body>
  ${items.map(i => slipHtml(company, cycle, i.line, i.detail)).join('')}
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`
  const w = target || window.open('', '_blank', 'width=820,height=900')
  if (w) { w.document.open(); w.document.write(html); w.document.close() }
}
