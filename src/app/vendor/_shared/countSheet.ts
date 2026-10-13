// ── Shared by BOTH vendors — count sheet: print / PDF and Excel (2026-10-13) ─
// The items Browse & Count is showing, with a blank "Actual" column to fill
// in on the shelf — the same shape as the paper sheet staff already use.
// Print opens the browser's print dialog (Save as PDF lives there); Excel
// downloads a real .xlsx (src/lib/xlsx.ts). Results are entered back on
// Browse & Count, which records each change.
import { escapeHtml } from '@/lib/escapeHtml'
import { lastCountedLabel, countAgeDays } from '@/lib/countCoverage'
import { downloadXlsx } from '@/lib/xlsx'

export function downloadCountSheetXlsx({ shopName, heading, products }: {
  shopName: string
  heading: string
  products: any[]
}): boolean {
  const now = Date.now()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })   // YYYY-MM-DD
  const rows = products.map((p, i) => {
    const d = countAgeDays(p, now)
    return [
      i + 1, p.sku || '', p.name || '',
      p.loc_store || '', p.loc_floor || '', p.loc_sub1 || '', p.loc_sub2 || '',
      Number(p.quantity) || 0,
      p.last_stock_confirmed_at
        ? new Date(p.last_stock_confirmed_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
        : 'Never counted',
      Number.isFinite(d) ? Math.floor(d) : null,
      '',
    ]
  })
  return downloadXlsx({
    name: 'Count sheet',
    title: [`${shopName} — Stock count sheet`, `${heading} · ${products.length} item${products.length !== 1 ? 's' : ''} · ${today}`],
    header: ['#', 'Stock no', 'Part', 'Store', 'Floor', 'Sub location 1', 'Sub location 2', 'System qty', 'Last counted', 'Days waiting', 'Actual'],
    rows,
    widths: [5, 12, 46, 14, 12, 15, 15, 10, 14, 12, 10],
  }, `Count sheet ${shopName} ${heading} ${today}.xlsx`)
}

export function printCountSheet({ shopName, heading, products }: {
  shopName: string
  heading: string            // e.g. "Sakura Yard · Yard · Rack A1 — not counted in 1 month+"
  products: any[]
}) {
  const w = window.open('', '_blank')
  if (!w) return false
  const now = Date.now()
  const today = new Date().toLocaleDateString('en-GB', { timeZone: 'Asia/Colombo', day: '2-digit', month: 'short', year: 'numeric' })
  const rows = products.map((p, i) => `<tr>
    <td class="n">${i + 1}</td>
    <td class="mono">${escapeHtml(p.sku || '')}</td>
    <td>${escapeHtml(p.name || '')}</td>
    <td>${escapeHtml([p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ') || '—')}</td>
    <td class="n">${Number(p.quantity) || 0}</td>
    <td class="small">${escapeHtml(lastCountedLabel(p, now))}</td>
    <td class="blank"></td>
  </tr>`).join('')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Count sheet — ${escapeHtml(heading)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  body { font: 11pt system-ui, sans-serif; color: #0f172a; margin: 0; }
  h1 { font-size: 15pt; margin: 0 0 2px; }
  .sub { color: #475569; font-size: 10pt; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #94a3b8; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-size: 9.5pt; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .n { text-align: right; white-space: nowrap; }
  .mono { font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
  .small { font-size: 9pt; color: #475569; white-space: nowrap; }
  .blank { width: 22mm; }
  .sign { margin-top: 14px; font-size: 10pt; display: flex; gap: 40px; }
</style></head><body>
<h1>${escapeHtml(shopName)} — Stock count sheet</h1>
<div class="sub">${escapeHtml(heading)} · ${products.length} item${products.length !== 1 ? 's' : ''} · printed ${escapeHtml(today)}</div>
<table><thead><tr><th>#</th><th>Stock no</th><th>Part</th><th>Location</th><th>System qty</th><th>Last counted</th><th>Actual</th></tr></thead>
<tbody>${rows}</tbody></table>
<div class="sign"><span>Counted by: ____________________</span><span>Date: ____________</span></div>
<script>window.onload = () => window.print()</script>
</body></html>`)
  w.document.close()
  return true
}
