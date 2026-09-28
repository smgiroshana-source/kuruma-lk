// ─────────────────────────────────────────────────────────────────────────────
// Spare parts sales — the printable A4 report (WHEEL MART)
//
// Owner, 2026-09-28: "proper A4 formatted report … clearly mention total
// Macforce sale and other sale". Portrait A4: the period's totals up front
// with the workshop (Macforce Auto Engineering) and other customers side by
// side, then by category, then every item — in two groups, workshop first,
// each with its own subtotal. Pure function of the report data so it can be
// previewed outside the browser.
// ─────────────────────────────────────────────────────────────────────────────
import { escapeHtml } from '@/lib/escapeHtml'

const rs = (n: any) => 'Rs.' + Math.round(Number(n) || 0).toLocaleString('en-US')
const dmy = (d: string) => { const [y, m, dd] = String(d).split('-'); return dd && m && y ? `${dd}/${m}/${y}` : String(d) }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const longDate = (d: string) => { const [y, m, dd] = String(d).split('-').map(Number); return `${dd} ${MON[m - 1]} ${y}` }

type Tot = { units: number; lines: number; revenue: number; costedRevenue: number; cost: number; profit: number; noCostRevenue: number }
function total(rows: any[]): Tot {
  const t: Tot = { units: 0, lines: 0, revenue: 0, costedRevenue: 0, cost: 0, profit: 0, noCostRevenue: 0 }
  for (const r of rows) {
    t.lines++; t.units += r.qty; t.revenue += r.revenue
    if (r.cost != null) { t.costedRevenue += r.revenue; t.cost += r.cost; t.profit += r.profit } else t.noCostRevenue += r.revenue
  }
  return t
}
const marginOf = (t: Tot) => t.costedRevenue > 0 ? Math.round((t.profit / t.costedRevenue) * 100) : null
const profitCell = (t: Tot) => t.costedRevenue > 0 ? `${rs(t.profit)}${marginOf(t) != null ? ` <span class="pct">${marginOf(t)}%</span>` : ''}` : '<span class="muted">—</span>'

/** The full HTML document. `category` is 'all' or one product category. */
export function sparePartsPdfHtml(data: any, category: string): string {
  const rows: any[] = (data.rows || []).filter((r: any) => category === 'all' || r.category === category)
  const all = total(rows)
  const wsRows = rows.filter(r => r.workshop), otherRows = rows.filter(r => !r.workshop)
  const ws = total(wsRows), other = total(otherRows)
  const pctOf = (n: number) => all.revenue > 0 ? Math.round((n / all.revenue) * 100) : 0
  const scope = category === 'all' ? 'All spare parts' : category

  const cats = new Map<string, any[]>()
  for (const r of rows) { if (!cats.has(r.category)) cats.set(r.category, []); cats.get(r.category)!.push(r) }
  const catRows = [...cats.entries()]
    .map(([c, list]) => ({ c, t: total(list), w: total(list.filter(r => r.workshop)) }))
    .sort((a, b) => b.t.revenue - a.t.revenue)

  const itemRows = (list: any[], showCustomer: boolean) => list.map(r => `
    <tr>
      <td class="nowrap">${escapeHtml(dmy(r.date))}</td>
      <td class="nowrap inv">${escapeHtml(String(r.invoice))}</td>
      <td>
        <div class="item">${escapeHtml(r.item)}</div>
        <div class="sub">${showCustomer ? `<span class="cust">${escapeHtml(r.customer)}</span> · ` : ''}${[r.sku, r.category, r.vehicleNo].filter(Boolean).map((x: string) => escapeHtml(x)).join(' · ')}</div>
      </td>
      <td class="num">${r.qty}</td>
      <td class="num">${rs(r.revenue)}</td>
      <td class="num">${r.cost != null ? rs(r.cost) : '<span class="muted">—</span>'}</td>
      <td class="num">${r.cost != null ? `<span class="${r.profit >= 0 ? 'pos' : 'neg'}">${rs(r.profit)}</span>` : '<span class="nocost">no cost</span>'}</td>
    </tr>`).join('')

  const group = (title: string, hint: string, list: any[], t: Tot, showCustomer: boolean) => list.length === 0 ? '' : `
    <h3>${title} <span class="h3sub">${hint}</span></h3>
    <table class="items">
      <colgroup><col style="width:17mm"><col style="width:21mm"><col><col style="width:9mm"><col style="width:23mm"><col style="width:21mm"><col style="width:23mm"></colgroup>
      <thead><tr><th>Date</th><th>Receipt / inv.</th><th>Item</th><th class="num">Qty</th><th class="num">Sales</th><th class="num">Cost</th><th class="num">Profit</th></tr></thead>
      <tbody>${itemRows(list, showCustomer)}
        <tr class="subtot"><td colspan="3">Subtotal · ${t.lines} line${t.lines !== 1 ? 's' : ''}</td><td class="num">${t.units}</td><td class="num">${rs(t.revenue)}</td>
        <td class="num">${t.cost > 0 ? rs(t.cost) : '—'}</td><td class="num">${t.costedRevenue > 0 ? rs(t.profit) : '—'}</td></tr></tbody>
    </table>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Spare parts sales ${escapeHtml(data.from)} to ${escapeHtml(data.to)}</title>
  <style>
    @page{size:A4 portrait;margin:14mm 13mm 14mm 13mm}
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#1f2328;margin:0;font-size:10.5px;line-height:1.35}
    .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #1f2328;padding-bottom:7px}
    .co{font-size:16px;font-weight:800;letter-spacing:.2px}
    .title{font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#c2410c;margin-top:3px}
    .meta{text-align:right;font-size:10.5px;line-height:1.55}
    .meta strong{font-size:11.5px}

    .cards{display:grid;grid-template-columns:1.15fr 1fr 1fr;gap:7px;margin:10px 0 2px}
    .card{border:1px solid #d9dde3;border-radius:6px;padding:8px 10px}
    .card .l{font-size:8.5px;text-transform:uppercase;letter-spacing:1px;color:#6b7280;font-weight:700}
    .card .v{font-size:16px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
    .card .s{font-size:9.5px;color:#6b7280;margin-top:1px}
    .card.total{border:2px solid #1f2328}
    .card.ws{border-color:#7dd3fc;background:#f0f9ff}
    .card.ws .l{color:#075985}

    h3{font-size:10.5px;text-transform:uppercase;letter-spacing:1.2px;color:#374151;margin:14px 0 5px;padding-bottom:3px;border-bottom:1.5px solid #d1d5db}
    .h3sub{text-transform:none;letter-spacing:0;font-weight:400;color:#6b7280;font-size:9.5px}
    table{width:100%;border-collapse:collapse;table-layout:fixed}
    th{font-size:8.5px;text-transform:uppercase;letter-spacing:.6px;color:#4b5563;text-align:left;padding:5px 5px;background:#f3f4f6;border-bottom:1.5px solid #9ca3af}
    td{padding:4px 5px;border-bottom:1px solid #e5e7eb;vertical-align:top}
    .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    .nowrap{white-space:nowrap}
    .inv{font-size:9.5px;color:#374151}
    .item{font-weight:600}
    .sub{font-size:8.5px;color:#6b7280;margin-top:1px}
    .cust{color:#1f2328;font-weight:600}
    .muted{color:#9ca3af} .pct{font-size:8.5px;color:#6b7280;font-weight:400}
    .pos{color:#15803d} .neg{color:#b91c1c} .nocost{font-size:8.5px;color:#b45309}
    tr.subtot td{font-weight:700;background:#fafafa;border-top:1.5px solid #9ca3af;border-bottom:none}
    tr.grand td{font-weight:800;border-top:2px solid #1f2328;background:#fafafa}
    tr{page-break-inside:avoid}
    thead{display:table-header-group}
    .split td:first-child{font-weight:600}
    .note{font-size:9px;color:#6b7280;margin-top:5px;line-height:1.45}
    .foot{margin-top:10px;padding-top:6px;border-top:1px solid #e5e7eb;font-size:8.5px;color:#9ca3af;display:flex;justify-content:space-between}
  </style></head><body>

  <div class="top">
    <div><div class="co">${escapeHtml(data.entity || '')}</div><div class="title">Spare parts sales report</div></div>
    <div class="meta"><strong>${escapeHtml(longDate(data.from))} – ${escapeHtml(longDate(data.to))}</strong><br>${escapeHtml(scope)}</div>
  </div>

  <div class="cards">
    <div class="card total"><div class="l">Total spare parts sales</div><div class="v">${rs(all.revenue)}</div><div class="s">${all.units} unit${all.units !== 1 ? 's' : ''} · ${all.lines} line${all.lines !== 1 ? 's' : ''}</div></div>
    <div class="card ws"><div class="l">Macforce Auto Engineering</div><div class="v">${rs(ws.revenue)}</div><div class="s">${ws.units} unit${ws.units !== 1 ? 's' : ''} · ${pctOf(ws.revenue)}% of sales · workshop</div></div>
    <div class="card"><div class="l">Other customers</div><div class="v">${rs(other.revenue)}</div><div class="s">${other.units} unit${other.units !== 1 ? 's' : ''} · ${pctOf(other.revenue)}% of sales</div></div>
  </div>

  <h3>Sales by customer</h3>
  <table class="split">
    <colgroup><col><col style="width:16mm"><col style="width:28mm"><col style="width:26mm"><col style="width:30mm"><col style="width:28mm"></colgroup>
    <thead><tr><th></th><th class="num">Units</th><th class="num">Sales</th><th class="num">Cost</th><th class="num">Profit</th><th class="num">No-cost sales</th></tr></thead>
    <tbody>
      <tr><td>Macforce Auto Engineering (workshop)</td><td class="num">${ws.units}</td><td class="num">${rs(ws.revenue)}</td><td class="num">${ws.cost > 0 ? rs(ws.cost) : '—'}</td><td class="num">${profitCell(ws)}</td><td class="num">${ws.noCostRevenue > 0 ? rs(ws.noCostRevenue) : '—'}</td></tr>
      <tr><td>Other customers</td><td class="num">${other.units}</td><td class="num">${rs(other.revenue)}</td><td class="num">${other.cost > 0 ? rs(other.cost) : '—'}</td><td class="num">${profitCell(other)}</td><td class="num">${other.noCostRevenue > 0 ? rs(other.noCostRevenue) : '—'}</td></tr>
      <tr class="grand"><td>Total</td><td class="num">${all.units}</td><td class="num">${rs(all.revenue)}</td><td class="num">${all.cost > 0 ? rs(all.cost) : '—'}</td><td class="num">${profitCell(all)}</td><td class="num">${all.noCostRevenue > 0 ? rs(all.noCostRevenue) : '—'}</td></tr>
    </tbody>
  </table>

  ${catRows.length > 1 ? `
  <h3>By category</h3>
  <table>
    <colgroup><col><col style="width:14mm"><col style="width:27mm"><col style="width:27mm"><col style="width:27mm"><col style="width:30mm"></colgroup>
    <thead><tr><th>Category</th><th class="num">Units</th><th class="num">Sales</th><th class="num">Macforce</th><th class="num">Other</th><th class="num">Profit</th></tr></thead>
    <tbody>${catRows.map(c => `<tr><td>${escapeHtml(c.c)}</td><td class="num">${c.t.units}</td><td class="num">${rs(c.t.revenue)}</td>
      <td class="num">${c.w.revenue > 0 ? rs(c.w.revenue) : '—'}</td><td class="num">${c.t.revenue - c.w.revenue > 0 ? rs(c.t.revenue - c.w.revenue) : '—'}</td><td class="num">${profitCell(c.t)}</td></tr>`).join('')}
      <tr class="grand"><td>Total</td><td class="num">${all.units}</td><td class="num">${rs(all.revenue)}</td><td class="num">${rs(ws.revenue)}</td><td class="num">${rs(other.revenue)}</td><td class="num">${profitCell(all)}</td></tr>
    </tbody>
  </table>` : ''}

  <p class="note">
    Spare parts = everything sold from stock except tyres, tubes &amp; flaps and consumables. Sales are net of ${escapeHtml(String(data.vatRate))}% VAT on tax invoices (receipts carry no VAT);
    returned quantities are left out. Parts with no cost recorded — most body parts are not cost-tracked — show sales only and are not in the profit figure.
  </p>
  ${group('Sold to Macforce Auto Engineering', '— the workshop', wsRows, ws, false)}
  ${group('Sold to other customers', '', otherRows, other, true)}

  <div class="foot"><span>Internal management report · not a tax document</span><span>Generated ${escapeHtml(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span></div>
  <script>window.onload=()=>{window.print()}</script>
  </body></html>`
}
