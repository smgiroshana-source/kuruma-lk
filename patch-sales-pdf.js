const fs = require('fs')
const FILE = 'src/app/vendor/page.tsx'
let code = fs.readFileSync(FILE, 'utf8')
let changes = 0

function replace(label, from, to) {
  if (!code.includes(from)) { console.error(`❌ NOT FOUND: ${label}`); return }
  code = code.replace(from, to)
  console.log(`✅ ${label}`)
  changes++
}

// ── Change 1: Add printSalesSummaryPDF function just before handleExportCSV ───
replace(
  'Add printSalesSummaryPDF function',
  `  // ── Export Sales CSV ────────────────────────────────────────────────────
  async function handleExportCSV(mode: 'summary' | 'items') {`,
  `  // ── Sales Summary PDF ───────────────────────────────────────────────────
  async function handleExportSummaryPDF() {
    if (!exportFrom || !exportTo) { showToast('Please select both dates'); return }
    setExportLoading(true)
    try {
      const r = await fetch(\`/api/vendor/sales?from=\${exportFrom}&to=\${exportTo}\`)
      const j = await r.json()
      const sales = (j.sales || []).filter((s: any) => s.payment_status !== 'voided')
      if (!sales.length) { showToast('No sales in that date range'); setExportLoading(false); return }

      const vendor = j.vendor || data?.vendor
      const totalRevenue = sales.reduce((s: number, x: any) => s + parseFloat(x.total || 0), 0)
      const totalPaid = sales.reduce((s: number, x: any) => s + parseFloat(x.paid_amount || 0), 0)
      const totalCredit = sales.reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0)
      const totalDiscount = sales.reduce((s: number, x: any) => s + parseFloat(x.discount || 0), 0)
      const totalItems = sales.reduce((s: number, x: any) => s + (x.items || []).reduce((is: number, i: any) => is + i.quantity, 0), 0)

      const fromLabel = new Date(exportFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      const toLabel = new Date(exportTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

      const rows = sales.map((s: any) => \`
        <tr>
          <td>\${new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td class="mono">\${s.invoice_no}</td>
          <td>\${s.customer?.name || s.customer_name || 'Walk-in'}</td>
          <td>\${s.customer?.phone || s.customer_phone || ''}</td>
          <td class="right">\${(s.items || []).reduce((is: number, i: any) => is + i.quantity, 0)}</td>
          <td class="right">\${s.discount > 0 ? 'Rs.' + parseFloat(s.discount).toLocaleString() : '-'}</td>
          <td class="right bold">Rs.\${parseFloat(s.total).toLocaleString()}</td>
          <td class="right green">Rs.\${parseFloat(s.paid_amount).toLocaleString()}</td>
          <td class="right \${parseFloat(s.balance_due) > 0 ? 'red' : ''}">\${parseFloat(s.balance_due) > 0 ? 'Rs.' + parseFloat(s.balance_due).toLocaleString() : '-'}</td>
          <td><span class="badge \${s.payment_status === 'paid' ? 'badge-green' : s.payment_status === 'partial' ? 'badge-amber' : 'badge-red'}">\${s.payment_status.toUpperCase()}</span></td>
        </tr>
      \`).join('')

      const html = \`<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Sales Report \${fromLabel} – \${toLabel}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; border-bottom: 3px solid #f97316; margin-bottom: 16px; }
        .shop-name { font-size: 22px; font-weight: 900; color: #0f172a; }
        .shop-sub { font-size: 11px; color: #64748b; margin-top: 2px; }
        .report-title { font-size: 16px; font-weight: 800; color: #f97316; text-align: right; }
        .report-period { font-size: 12px; color: #64748b; text-align: right; margin-top: 2px; }
        .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 16px; }
        .stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; }
        .stat-label { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; }
        .stat-value { font-size: 17px; font-weight: 900; margin-top: 3px; }
        .green { color: #16a34a; } .red { color: #dc2626; } .blue { color: #2563eb; } .orange { color: #f97316; }
        table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
        thead tr { background: #f1f5f9; }
        th { text-align: left; padding: 8px 6px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
        td { padding: 7px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        tr:nth-child(even) { background: #fafafa; }
        .right { text-align: right; }
        .bold { font-weight: 700; }
        .mono { font-family: monospace; font-size: 10px; }
        .badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 9px; font-weight: 700; }
        .badge-green { background: #dcfce7; color: #15803d; }
        .badge-amber { background: #fef3c7; color: #b45309; }
        .badge-red { background: #fee2e2; color: #b91c1c; }
        .footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style></head><body>
      <div class="header">
        <div>
          <div class="shop-name">\${vendor?.name || 'kuruma.lk'}</div>
          <div class="shop-sub">\${vendor?.location || ''}\${vendor?.phone ? ' | ' + vendor.phone : ''}</div>
        </div>
        <div>
          <div class="report-title">Sales Summary Report</div>
          <div class="report-period">\${fromLabel} — \${toLabel}</div>
        </div>
      </div>
      <div class="summary-grid">
        <div class="stat"><div class="stat-label">Invoices</div><div class="stat-value blue">\${sales.length}</div></div>
        <div class="stat"><div class="stat-label">Items Sold</div><div class="stat-value orange">\${totalItems}</div></div>
        <div class="stat"><div class="stat-label">Revenue</div><div class="stat-value green">Rs.\${totalRevenue.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Collected</div><div class="stat-value green">Rs.\${totalPaid.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Outstanding</div><div class="stat-value \${totalCredit > 0 ? 'red' : 'green'}">Rs.\${totalCredit.toLocaleString()}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Date</th><th>Invoice</th><th>Customer</th><th>Phone</th>
          <th class="right">Items</th><th class="right">Discount</th>
          <th class="right">Total</th><th class="right">Paid</th>
          <th class="right">Balance</th><th>Status</th>
        </tr></thead>
        <tbody>\${rows}</tbody>
        <tfoot><tr style="border-top:2px solid #e2e8f0;font-weight:800;background:#f8fafc">
          <td colspan="4"><strong>TOTAL (\${sales.length} invoices)</strong></td>
          <td class="right">\${totalItems}</td>
          <td class="right">\${totalDiscount > 0 ? 'Rs.' + totalDiscount.toLocaleString() : '-'}</td>
          <td class="right bold green">Rs.\${totalRevenue.toLocaleString()}</td>
          <td class="right bold green">Rs.\${totalPaid.toLocaleString()}</td>
          <td class="right bold \${totalCredit > 0 ? 'red' : ''}">Rs.\${totalCredit.toLocaleString()}</td>
          <td></td>
        </tr></tfoot>
      </table>
      <div class="footer">
        <span>Generated: \${new Date().toLocaleString('en-GB')}</span>
        <span>kuruma.lk — Auto Parts Marketplace</span>
      </div>
      </body></html>\`

      const w = window.open('', '_blank', 'width=1100,height=800')
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
      showToast(\`PDF ready — \${sales.length} invoices\`)
      setShowExportModal(false)
    } catch { showToast('PDF generation failed') }
    setExportLoading(false)
  }

  // ── Export Sales CSV ────────────────────────────────────────────────────
  async function handleExportCSV(mode: 'summary' | 'items') {`
)

// ── Change 2: Update the modal buttons — replace Summary CSV with PDF ─────────
replace(
  'Update export modal buttons',
  `                  <button onClick={() => handleExportCSV('summary')} disabled={exportLoading || !exportFrom || !exportTo} className="w-full bg-slate-800 text-white font-bold text-sm py-2.5 rounded-xl disabled:opacity-50 hover:bg-slate-700">
                    {exportLoading ? 'Exporting…' : '⬇ Invoice Summary CSV'}
                  </button>
                  <button onClick={() => handleExportCSV('items')} disabled={exportLoading || !exportFrom || !exportTo} className="w-full bg-emerald-600 text-white font-bold text-sm py-2.5 rounded-xl disabled:opacity-50 hover:bg-emerald-700">
                    {exportLoading ? 'Exporting…' : '⬇ Line Items CSV (with Profit)'}
                  </button>`,
  `                  <button onClick={handleExportSummaryPDF} disabled={exportLoading || !exportFrom || !exportTo} className="w-full bg-orange-500 text-white font-bold text-sm py-2.5 rounded-xl disabled:opacity-50 hover:bg-orange-600">
                    {exportLoading ? 'Generating…' : '📄 Sales Summary PDF'}
                  </button>
                  <button onClick={() => handleExportCSV('items')} disabled={exportLoading || !exportFrom || !exportTo} className="w-full bg-emerald-600 text-white font-bold text-sm py-2.5 rounded-xl disabled:opacity-50 hover:bg-emerald-700">
                    {exportLoading ? 'Exporting…' : '⬇ Line Items CSV (Profit Analysis)'}
                  </button>`
)

fs.writeFileSync(FILE, code, 'utf8')
console.log(`\n${changes}/2 changes applied`)
