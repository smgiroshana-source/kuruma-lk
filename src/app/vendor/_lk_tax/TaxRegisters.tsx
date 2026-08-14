'use client'
// ── WHEEL MART ONLY — tax registers & printable compliance reports ───────────
//
// The VAT output register, input VAT register, VAT summary and SSCL liability
// report. Lives under the Tax tab beside the Filing Centre so everything tax is
// in one place (moved out of Sales → Tax).
//
// One TIN = one return: these figures always cover the WHOLE Pvt Ltd — parts
// shop (PART) and workshop (REPR) together — never a single branch.

import { useState } from 'react'
import { escapeHtml } from '@/lib/escapeHtml'
import { colomboToday } from '@/lib/dates'

export default function TaxRegisters({ showToast, vendorSettings, onGoToFiling }: {
  showToast: (m: string) => void
  vendorSettings?: any
  // Moving input credits between months happens in ONE place — the Filing
  // Centre. These registers are the evidence trail, read-only by design.
  onGoToFiling?: () => void
}) {
  const [taxReportType, setTaxReportType] = useState<'vat_register' | 'sscl_report' | 'input_vat' | 'vat_summary'>('vat_register')
  const [taxReportFrom, setTaxReportFrom] = useState(() => colomboToday().slice(0, 7) + '-01')
  const [taxReportTo, setTaxReportTo] = useState(() => colomboToday())
  const [taxReportData, setTaxReportData] = useState<any>(null)
  const [taxReportLoading, setTaxReportLoading] = useState(false)

  async function runTaxReport() {
    if (!taxReportFrom || !taxReportTo) return
    setTaxReportLoading(true)
    setTaxReportData(null)
    try {
      const r = await fetch(`/api/vendor/tax-reports?type=${taxReportType}&from=${taxReportFrom}&to=${taxReportTo}`)
      const j = await r.json()
      if (!r.ok) { showToast('⚠️ ' + (j.error || 'Failed')); return }
      setTaxReportData(j)
    } catch { showToast('Network error') }
    finally { setTaxReportLoading(false) }
  }

  function printTaxReport() {
    if (!taxReportData) return
    const titleMap: Record<string, string> = {
      vat_register: `VAT Output Register — ${taxReportFrom} to ${taxReportTo}`,
      input_vat:    `Input VAT Register — ${taxReportFrom} to ${taxReportTo}`,
      vat_summary:  `VAT Summary — ${taxReportFrom} to ${taxReportTo}`,
      sscl_report:  `SSCL Liability Report — ${taxReportFrom} to ${taxReportTo}`,
    }
    const title = titleMap[taxReportType] || 'Tax Report'
    const entityName = taxReportData.entity || ''
    let body = ''
    if (taxReportType === 'vat_register') {
      const rows = (taxReportData.register || []).map((r: any) => {
        const isCrn = r.status === 'CRN'
        // CRN against a VOIDED invoice: listed for the record but excluded
        // from totals (the void already reversed that VAT) — grey it out.
        const exCrn = isCrn && r.originalVoided
        const style = r.status === 'VOID' || exCrn ? 'color:#999;text-decoration:line-through'
          : isCrn ? 'color:#1d4ed8;background:#eff6ff' : ''
        const prefix = isCrn ? '−' : ''
        return `<tr style="${style}">
          <td>${r.serial}${isCrn && r.refSerial ? `<br/><span style="font-size:9px;color:#93c5fd">↳ ${r.refSerial}</span>` : ''}</td>
          <td>${r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('en-LK') : ''}</td>
          <td>${r.customerName || ''}</td>
          <td>${r.customerTin || ''}</td>
          <td style="text-align:right">${prefix}Rs.${Math.abs(r.netAmount).toLocaleString()}</td>
          <td style="text-align:right">${prefix}Rs.${Math.abs(r.vatAmount).toLocaleString()}</td>
          <td style="text-align:right">${prefix}Rs.${Math.abs(r.total).toLocaleString()}</td>
          <td style="text-align:center">${exCrn ? 'CRN·VOID' : r.status}</td>
        </tr>`}).join('')
      const t = taxReportData.totals
      const crnNote = (t.crnCount > 0 ? `, ${t.crnCount} credit note(s)` : '')
        + (t.crnExcludedCount > 0 ? ` — ${t.crnExcludedCount} CRN(s) against voided invoices excluded from totals` : '')
      body = `<table border="1" cellpadding="4" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#f0f0f0"><th>Serial / Ref</th><th>Date</th><th>Customer</th><th>TIN</th><th>Net</th><th>VAT</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="font-weight:bold;background:#f8f8f8"><td colspan="4">NET TOTALS (${t.count} valid, ${t.voidCount} void${crnNote})</td><td style="text-align:right">Rs.${t.netAmount.toLocaleString()}</td><td style="text-align:right">Rs.${t.vatAmount.toLocaleString()}</td><td style="text-align:right">Rs.${t.total.toLocaleString()}</td><td></td></tr></tfoot>
      </table>`
    } else if (taxReportType === 'sscl_report') {
      const rows = (taxReportData.months || []).map((m: any) =>
        `<tr>
          <td>${m.month}</td>
          <td style="text-align:right">Rs.${m.partTurnover.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.svcTurnover.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.totalTurnover.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.partLiable.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.svcLiable.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.totalLiable.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.partSscl.toLocaleString()}</td>
          <td style="text-align:right">Rs.${m.svcSscl.toLocaleString()}</td>
          <td style="text-align:right;font-weight:bold">Rs.${m.totalSscl.toLocaleString()}</td>
        </tr>`).join('')
      const t = taxReportData.totals
      const cfg = taxReportData.config
      body = `<p style="font-size:11px;color:#555">SSCL Rate: ${cfg?.ssclRate}% | Parts Liable Base: ${cfg?.liableBasePart}% | Services Liable Base: ${cfg?.liableBaseSvc}%</p>
        <table border="1" cellpadding="4" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:11px">
          <thead><tr style="background:#f0f0f0"><th>Month</th><th>Parts T/O</th><th>SVC T/O</th><th>Total T/O</th><th>Parts Liable</th><th>SVC Liable</th><th>Total Liable</th><th>Parts SSCL</th><th>SVC SSCL</th><th>Total SSCL</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr style="font-weight:bold;background:#f8f8f8"><td>TOTALS</td>
            <td style="text-align:right">Rs.${t.partTurnover.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.svcTurnover.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.totalTurnover.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.partLiable.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.svcLiable.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.totalLiable.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.partSscl.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.svcSscl.toLocaleString()}</td>
            <td style="text-align:right">Rs.${t.ssclDue.toLocaleString()}</td>
          </tr></tfoot>
        </table>`
    } else if (taxReportType === 'input_vat') {
      const rows = (taxReportData.rows || []).map((r: any) =>
        `<tr>
          <td style="font-family:monospace">${r.grnNumber}</td>
          <td>${r.receivedAt}</td>
          <td>${r.supplierName}</td>
          <td>${r.supplierInvoiceNo || ''}</td>
          <td style="text-align:right">Rs.${r.netCost.toLocaleString()}</td>
          <td style="text-align:right;color:#c05621">Rs.${r.inputVat.toLocaleString()}</td>
          <td style="text-align:right;font-weight:bold">Rs.${r.totalCost.toLocaleString()}</td>
        </tr>`).join('')
      const t = taxReportData.totals
      body = `<table border="1" cellpadding="4" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:11px">
        <thead><tr style="background:#f0f0f0"><th>GRN No.</th><th>Date</th><th>Supplier</th><th>Supplier Inv. No.</th><th>Net Cost</th><th>Input VAT</th><th>Total Cost</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="font-weight:bold;background:#f8f8f8">
          <td colspan="4">TOTALS (${t.count} GRN${t.count !== 1 ? 's' : ''})</td>
          <td style="text-align:right">Rs.${t.netCost.toLocaleString()}</td>
          <td style="text-align:right">Rs.${t.inputVat.toLocaleString()}</td>
          <td style="text-align:right">Rs.${t.totalCost.toLocaleString()}</td>
        </tr></tfoot>
      </table>`
    } else if (taxReportType === 'vat_summary') {
      const d = taxReportData
      const netPayableStyle = d.netPayable >= 0 ? 'color:#991b1b' : 'color:#1e40af'
      body = `<table border="1" cellpadding="8" cellspacing="0" style="width:360px;border-collapse:collapse;font-size:12px">
        <tbody>
          <tr><td><strong>Output VAT</strong> (invoices net of CRNs)</td><td style="text-align:right">Rs.${d.outputVat.toLocaleString()}</td></tr>
          <tr><td>&nbsp;&nbsp;Net taxable sales</td><td style="text-align:right">Rs.${d.outputNetSales.toLocaleString()}</td></tr>
          <tr><td>&nbsp;&nbsp;Invoices: ${d.invoiceCount} | Credit notes: ${d.crnCount}</td><td></td></tr>
          <tr><td><strong>Input VAT</strong> (from posted GRNs)</td><td style="text-align:right">Rs.${d.inputVat.toLocaleString()}</td></tr>
          <tr style="font-size:14px;font-weight:bold;background:#f0f0f0"><td>Net VAT Payable</td><td style="text-align:right;${netPayableStyle}">Rs.${Math.abs(d.netPayable).toLocaleString()}${d.netPayable < 0 ? ' (credit)' : ''}</td></tr>
        </tbody>
      </table>`
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
      <style>body{font-family:Arial,sans-serif;margin:20px}h2{font-size:14px}h3{font-size:12px;color:#555}@media print{@page{size:A4 landscape;margin:10mm}}</style>
      </head><body>
      <h2>${title}</h2><h3>${entityName}</h3>
      ${taxReportData.filing_valid === false
        ? `<p style="border:2px solid #dc2626;background:#fef2f2;color:#b91c1c;font-size:11px;font-weight:bold;padding:8px 10px;margin:8px 0">PARTIAL VIEW — ${escapeHtml(String(taxReportData.branch || ''))} branch only. NOT VALID FOR IRD SUBMISSION. The Pvt Ltd files one consolidated return covering all streams.</p>`
        : `<p style="font-size:10px;color:#666;margin:4px 0 10px">Consolidated for the whole company — all invoice streams (PART parts shop + REPR workshop) under one TIN, as required for a single VAT/SSCL return.</p>`}
      ${body}
      <p style="font-size:10px;color:#999;margin-top:16px">Generated ${new Date().toLocaleString('en-LK')}</p>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1000)}</script>
      </body></html>`
    const w = window.open('', '_blank', 'width=1000,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div className="space-y-4">
      {/* Report selector + date range */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h3 className="font-bold text-sm text-slate-800 mb-1">🧾 Tax Compliance Reports</h3>
        {/* One TIN = one return. These reports always cover the
            WHOLE Pvt Ltd — parts shop and workshop together —
            regardless of the branch view used elsewhere. */}
        {taxReportData?.filing_valid === false ? (
          <div className="mb-3 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2">
            <p className="text-[11px] font-black text-red-700">⚠️ PARTIAL VIEW — {taxReportData.branch} only. NOT valid for IRD submission.</p>
            <p className="text-[11px] text-red-600 mt-0.5">Your access is limited to one branch. The VAT/SSCL return must be filed by the owner for the whole company.</p>
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 mb-3">Covers the <strong>whole Pvt Ltd</strong> — parts shop (PART) and workshop (REPR) together, as one taxpayer under TIN {vendorSettings?.tax_id || '101969738'}. The Shop/Workshop view in Sales does not apply here.</p>
        )}
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Report Type</label>
            <select value={taxReportType} onChange={e => { setTaxReportType(e.target.value as any); setTaxReportData(null) }} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white">
              <option value="vat_register">VAT Output Register</option>
              <option value="input_vat">Input VAT Register</option>
              <option value="vat_summary">VAT Summary (Net Payable)</option>
              <option value="sscl_report">SSCL Liability Report</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label>
            <input type="date" value={taxReportFrom} onChange={e => { setTaxReportFrom(e.target.value); setTaxReportData(null) }} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label>
            <input type="date" value={taxReportTo} onChange={e => { setTaxReportTo(e.target.value); setTaxReportData(null) }} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
          </div>
          <button onClick={runTaxReport} disabled={taxReportLoading} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">
            {taxReportLoading ? '⏳ Loading…' : '🔍 Run Report'}
          </button>
          {taxReportData && (
            <button onClick={printTaxReport} className="bg-slate-700 hover:bg-slate-900 text-white text-xs font-bold px-4 py-2.5 rounded-lg">🖨️ Print</button>
          )}
        </div>
        {/* Quick range buttons */}
        <div className="flex gap-2 mt-3 flex-wrap">
          {[
            {l:'This Month',fn:()=>{ const n=new Date(); setTaxReportFrom(new Date(n.getFullYear(),n.getMonth(),1).toISOString().slice(0,10)); setTaxReportTo(n.toISOString().slice(0,10)) }},
            {l:'Last Month',fn:()=>{ const n=new Date(); const f=new Date(n.getFullYear(),n.getMonth()-1,1); const t=new Date(n.getFullYear(),n.getMonth(),0); setTaxReportFrom(f.toISOString().slice(0,10)); setTaxReportTo(t.toISOString().slice(0,10)) }},
            {l:'This Quarter',fn:()=>{ const n=new Date(); const q=Math.floor(n.getMonth()/3); const f=new Date(n.getFullYear(),q*3,1); setTaxReportFrom(f.toISOString().slice(0,10)); setTaxReportTo(n.toISOString().slice(0,10)) }},
          ].map(p => (
            <button key={p.l} onClick={() => { p.fn(); setTaxReportData(null) }} className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-100">{p.l}</button>
          ))}
        </div>
      </div>

      {/* ── VAT Output Register results ── */}
      {taxReportData && taxReportType === 'vat_register' && (() => {
        const { register, totals, entity } = taxReportData
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-sm text-slate-800">VAT Output Register</h3>
                <p className="text-[11px] text-slate-400">{entity} · {taxReportFrom} to {taxReportTo}</p>
              </div>
              <div className="flex gap-3 text-xs flex-wrap">
                <span className="text-slate-500">{totals.count} valid</span>
                {totals.voidCount > 0 && <span className="text-red-500">{totals.voidCount} void</span>}
                {totals.crnCount > 0 && <span className="text-blue-500">{totals.crnCount} credit note{totals.crnCount > 1 ? 's' : ''}</span>}
              </div>
            </div>
            {/* Totals summary — net of credit notes */}
            <div className="grid grid-cols-3 gap-px bg-slate-100">
              {[
                {l:'Net Amount (net of CRNs)', v: totals.netAmount},
                {l:'VAT Output (net of CRNs)', v: totals.vatAmount},
                {l:'Total (net of CRNs)', v: totals.total},
              ].map(s => (
                <div key={s.l} className="bg-white px-4 py-3 text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{s.l}</p>
                  <p className="font-black text-slate-800 text-sm">Rs.{s.v.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {/* Table */}
            {register.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">No tax invoices found for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase">
                    <th className="px-3 py-2 text-left">Serial / Ref</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Customer</th>
                    <th className="px-3 py-2 text-left">TIN</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2 text-right">VAT</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-center">Status</th>
                  </tr></thead>
                  <tbody>
                    {register.map((r: any, i: number) => {
                      const isCrn  = r.status === 'CRN'
                      const isVoid = r.status === 'VOID'
                      // CRN whose original invoice is VOID: shown for the record,
                      // excluded from totals (void already reversed that VAT)
                      const exCrn  = isCrn && r.originalVoided
                      return (
                        <tr key={i} className={`border-t border-slate-100 ${isVoid || exCrn ? 'opacity-40 line-through' : ''} ${isCrn ? 'bg-blue-50' : ''}`}>
                          <td className="px-3 py-2">
                            <span className="font-mono text-[10px]">{r.serial}</span>
                            {isCrn && r.refSerial && <span className="block text-[9px] text-blue-400">↳ {r.refSerial}</span>}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{r.invoiceDate ? new Date(r.invoiceDate).toLocaleDateString('en-LK') : '—'}</td>
                          <td className="px-3 py-2 font-semibold">{r.customerName || '—'}</td>
                          <td className="px-3 py-2 font-mono text-slate-400">{r.customerTin || '—'}</td>
                          <td className={`px-3 py-2 text-right ${isCrn ? 'text-blue-600 font-semibold' : ''}`}>{isCrn ? '−' : ''}Rs.{Math.abs(r.netAmount).toLocaleString()}</td>
                          <td className={`px-3 py-2 text-right ${isCrn ? 'text-blue-600 font-semibold' : 'text-orange-600'}`}>{isCrn ? '−' : ''}Rs.{Math.abs(r.vatAmount).toLocaleString()}</td>
                          <td className={`px-3 py-2 text-right font-bold ${isCrn ? 'text-blue-600' : ''}`}>{isCrn ? '−' : ''}Rs.{Math.abs(r.total).toLocaleString()}</td>
                          <td className="px-3 py-2 text-center">
                            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded ${
                              isVoid || exCrn ? 'bg-red-100 text-red-600'
                              : isCrn ? 'bg-blue-100 text-blue-700'
                              : 'bg-green-100 text-green-700'
                            }`}>{exCrn ? 'CRN·VOID' : r.status}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                      <td className="px-3 py-2" colSpan={4}>NET TOTALS (after credit notes){totals.crnExcludedCount > 0 ? <span className="block text-[10px] font-normal text-slate-400">{totals.crnExcludedCount} CRN(s) against voided invoices excluded — the void already reversed that VAT</span> : null}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.netAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-orange-600">Rs.{totals.vatAmount.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.total.toLocaleString()}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Input VAT Register results ── */}
      {taxReportData && taxReportType === 'input_vat' && (() => {
        const { rows, months, totals, entity, carriedForward = [], carriedTotal = 0, expiringSoonCount = 0 } = taxReportData
        // Move a credit to a later month (or back to its own month).
        // Standard SL practice: don't claim more input than output —
        // carry the excess forward (12 months local / 24 imports).
        const importRows = taxReportData.importRows || []
        const importCarried = taxReportData.importCarried || []
        const importTotals = taxReportData.importTotals || { vatUpfront: 0, vatDeferred: 0, disallowed: 0, claimable: 0, count: 0, carried: 0 }
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-sm text-slate-800">Input VAT Register</h3>
                <p className="text-[11px] text-slate-400">{entity} · {taxReportFrom} to {taxReportTo}</p>
              </div>
              <span className="text-xs text-slate-400">{totals.count} GRN{totals.count !== 1 ? 's' : ''}</span>
            </div>
            {/* ── Import VAT — IRD Schedule 03 (per Customs declaration) ── */}
            <div className="px-5 py-4 border-b border-slate-100 bg-sky-50/40">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div>
                  <p className="text-xs font-black text-sky-900">🚢 Import VAT — Schedule 03</p>
                  <p className="text-[11px] text-sky-700">Claimed per Customs declaration, never per item — a container&apos;s VAT needs no product costs. 24-month claim window.</p>
                </div>
                {onGoToFiling && (
                  <button onClick={onGoToFiling} className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-sky-300 bg-white text-sky-700 hover:bg-sky-100">
                    Generate Schedule 03 in Filing →
                  </button>
                )}
              </div>
              {importRows.length === 0 && importCarried.length === 0 ? (
                <p className="text-[11px] text-slate-400">No Cusdec entries in this period — add them in Import Shipments as each container clears Customs.</p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead><tr className="text-slate-400 text-left">
                        <th className="py-1">Cusdec</th><th>Date</th><th>Office</th>
                        <th className="text-right">Upfront</th><th className="text-right">Deferred</th>
                        <th className="text-right">Disallowed</th><th className="text-right">Claimable</th>
                      </tr></thead>
                      <tbody>
                        {importRows.map((r: any) => (
                          <tr key={r.id} className="border-t border-sky-100">
                            <td className="py-1.5 font-mono font-bold">{r.cusdecNo}{r.deferred && <span className="ml-1 text-[9px] text-amber-600 font-black">MOVED</span>}</td>
                            <td>{r.cusdecDate}</td>
                            <td className="text-slate-400">{r.cusdecOfficeId || '—'}</td>
                            <td className="text-right font-mono">{r.vatUpfront.toLocaleString()}</td>
                            <td className="text-right font-mono text-slate-400">{r.vatDeferred.toLocaleString()}</td>
                            <td className="text-right font-mono text-slate-400">{r.disallowedVat.toLocaleString()}</td>
                            <td className="text-right font-mono font-black text-sky-700">{r.inputVat.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 pt-2 border-t border-sky-200 text-[11px]">
                    <span className="text-sky-900">Import VAT claimable this period: <strong className="font-mono">Rs.{importTotals.claimable.toLocaleString()}</strong> ({importTotals.count} cusdec{importTotals.count !== 1 ? 's' : ''})</span>
                    {importTotals.carried > 0 && <span className="text-amber-700">Moved to later months: <strong className="font-mono">Rs.{importTotals.carried.toLocaleString()}</strong></span>}
                  </div>
                  {importCarried.length > 0 && (
                    <div className="mt-2">
                      <p className="text-[10px] font-black text-amber-700 uppercase mb-1">Waiting in later months</p>
                      {importCarried.map((r: any) => (
                        <div key={r.id} className="flex items-center justify-between text-[11px] py-0.5">
                          <span className="font-mono">{r.cusdecNo} · {r.cusdecDate} · claim in {r.claimPeriod}</span>
                          <span className="flex items-center gap-2">
                            <span className={r.monthsLeft <= 3 ? 'text-red-600 font-bold' : 'text-slate-400'}>{r.monthsLeft} month{r.monthsLeft !== 1 ? 's' : ''} left</span>
                            <span className="font-mono font-bold">Rs.{r.inputVat.toLocaleString()}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Totals */}
            <div className="grid grid-cols-3 gap-px bg-slate-100">
              {[
                {l:'Local Input VAT (GRNs)', v: totals.inputVat},
                {l:'Import VAT (Schedule 03)', v: importTotals.claimable},
                {l:'Total Input VAT Claimed', v: taxReportData.grandTotalInputVat ?? (totals.inputVat + importTotals.claimable), hi: true},
              ].map(s => (
                <div key={s.l} className="bg-white px-4 py-3 text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{s.l}</p>
                  <p className={`font-black text-sm ${s.hi ? 'text-orange-600' : 'text-slate-800'}`}>Rs.{s.v.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {/* By month */}
            {months.length > 1 && (
              <div className="px-5 py-3 border-b border-slate-100">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">By Month</p>
                <div className="flex flex-wrap gap-3">
                  {months.map((m: any) => (
                    <div key={m.month} className="text-xs bg-slate-50 rounded-lg px-3 py-2">
                      <p className="font-semibold text-slate-600">{m.month}</p>
                      <p className="text-orange-600">VAT: Rs.{m.inputVat.toLocaleString()}</p>
                      <p className="text-slate-400 text-[10px]">{m.count} GRN{m.count !== 1 ? 's' : ''}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Credits held back for a later month */}
            {carriedForward.length > 0 && (
              <div className="px-5 py-3 border-b border-slate-100 bg-purple-50/50">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <p className="text-[11px] font-black text-purple-700 uppercase tracking-wide">
                    Carried forward — not claimed yet: Rs.{carriedTotal.toLocaleString()}
                  </p>
                  {expiringSoonCount > 0 && (
                    <span className="text-[10px] font-black text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                      ⚠️ {expiringSoonCount} expiring within 3 months
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {carriedForward.map((r: any) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-1.5 border border-purple-100">
                      <span className="font-mono text-[10px] text-slate-500">{r.grnNumber}</span>
                      <span className="flex-1 truncate text-slate-600">{r.supplierName}{r.isImport && <span className="ml-1 text-[9px] font-black text-sky-600">IMPORT</span>}</span>
                      <span className="text-[10px] text-slate-400">bought {r.originMonth} · held for {r.claimPeriod}</span>
                      <span className={`text-[10px] font-bold ${r.monthsLeft <= 3 ? 'text-red-600' : 'text-slate-400'}`}>
                        {r.monthsLeft <= 0 ? 'EXPIRED' : `${r.monthsLeft}mo left`}
                      </span>
                      <span className="font-bold text-orange-600">Rs.{r.inputVat.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-purple-600 mt-2">
                  Claim these against a month with enough output VAT. Deadline: 12 months from purchase for local, 24 for imports.
                  {onGoToFiling && <button onClick={onGoToFiling} className="ml-1 font-black underline">Move them in Filing →</button>}
                </p>
              </div>
            )}

            {/* Table */}
            {rows.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">No input VAT claimed in this period{carriedForward.length > 0 ? ' — everything is carried forward' : ''}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase">
                    <th className="px-3 py-2 text-left">GRN No.</th>
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Supplier</th>
                    <th className="px-3 py-2 text-left">Supplier Inv.</th>
                    <th className="px-3 py-2 text-right">Net Cost</th>
                    <th className="px-3 py-2 text-right">Input VAT</th>
                    <th className="px-3 py-2 text-right">Total Cost</th>
                    <th className="px-3 py-2 text-center">Claimed</th>
                  </tr></thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{r.grnNumber}</td>
                        <td className="px-3 py-2 text-slate-500">{r.receivedAt}</td>
                        <td className="px-3 py-2 font-semibold">{r.supplierName}{r.isImport && <span className="ml-1 text-[9px] font-black text-sky-600">IMPORT</span>}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{r.supplierInvoiceNo || '—'}</td>
                        <td className="px-3 py-2 text-right text-slate-600">Rs.{r.netCost.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold text-orange-600">Rs.{r.inputVat.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-bold">Rs.{r.totalCost.toLocaleString()}</td>
                        <td className="px-3 py-2 text-center whitespace-nowrap text-[10px] text-slate-400">
                          {r.deferred
                            ? <span className="font-black text-purple-600" title={`Purchased ${r.originMonth}, claimable until ${r.expiryMonth}`}>moved from {r.originMonth}</span>
                            : 'own month'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                      <td className="px-3 py-2" colSpan={4}>TOTALS</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.netCost.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-orange-600">Rs.{totals.inputVat.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.totalCost.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── VAT Summary results ── */}
      {taxReportData && taxReportType === 'vat_summary' && (() => {
        const d = taxReportData
        const netPositive = d.netPayable >= 0
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800">VAT Summary — Net Payable</h3>
              <p className="text-[11px] text-slate-400">{d.entity} · {taxReportFrom} to {taxReportTo}</p>
            </div>
            <div className="p-6 space-y-4 max-w-md">
              {/* Output VAT block */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Output VAT (from tax invoices)</p>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Net taxable sales</span>
                    <span className="font-semibold">Rs.{d.outputNetSales.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Output VAT collected</span>
                    <span className="font-bold text-orange-600">Rs.{d.outputVat.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-200">
                    <span>{d.invoiceCount} valid invoice{d.invoiceCount !== 1 ? 's' : ''}</span>
                    {d.crnCount > 0 && <span>{d.crnCount} credit note{d.crnCount !== 1 ? 's' : ''} applied</span>}
                  </div>
                </div>
              </div>
              {/* Input VAT block */}
              <div className="bg-slate-50 rounded-xl p-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Input VAT (from posted GRNs)</p>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Input VAT claimed this period</span>
                  <span className="font-bold text-green-700">Rs.{d.inputVat.toLocaleString()}</span>
                </div>
                {(d.availableCarryForward || 0) > 0 && (
                  <div className="flex justify-between text-xs mt-1.5 pt-1.5 border-t border-slate-200">
                    <span className="text-purple-600">Held back for later months</span>
                    <span className="font-bold text-purple-600">Rs.{d.availableCarryForward.toLocaleString()}</span>
                  </div>
                )}
              </div>
              {/* Net payable */}
              <div className={`rounded-xl p-5 border-2 ${netPositive ? 'bg-red-50 border-red-200' : 'bg-blue-50 border-blue-200'}`}>
                <p className="text-[10px] font-bold uppercase mb-1 text-slate-500">Net VAT {netPositive ? 'Payable to CGIR' : 'Refundable / Credit'}</p>
                <p className={`text-2xl font-black ${netPositive ? 'text-red-600' : 'text-blue-700'}`}>
                  Rs.{Math.abs(d.netPayable).toLocaleString()}
                </p>
                <p className="text-[10px] text-slate-400 mt-1">Output Rs.{d.outputVat.toLocaleString()} − Input Rs.{d.inputVat.toLocaleString()}</p>
                {/* Refund positions are slow to recover in SL — the usual
                    practice is to carry the excess credit forward instead */}
                {!netPositive && (
                  <p className="text-[11px] text-blue-800 bg-blue-100 rounded-lg px-2.5 py-1.5 mt-2">
                    A credit position is hard to recover. Consider deferring Rs.{Math.abs(d.netPayable).toLocaleString()} of input VAT to a later month —
                    <button onClick={() => { setTaxReportType('input_vat'); setTaxReportData(null) }} className="font-bold underline ml-1">open the Input VAT register</button>
                  </p>
                )}
                {netPositive && (d.availableCarryForward || 0) > 0 && (
                  <p className="text-[11px] text-purple-800 bg-purple-100 rounded-lg px-2.5 py-1.5 mt-2">
                    Rs.{d.availableCarryForward.toLocaleString()} of held-back credit is available — claiming up to Rs.{Math.min(d.availableCarryForward, d.netPayable).toLocaleString()} of it would reduce this payment to zero.
                  </p>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── SSCL Liability Report results ── */}
      {taxReportData && taxReportType === 'sscl_report' && (() => {
        const { months, totals, config, entity } = taxReportData
        return (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h3 className="font-bold text-sm text-slate-800">SSCL Liability Report</h3>
                <p className="text-[11px] text-slate-400">{entity} · {taxReportFrom} to {taxReportTo}</p>
              </div>
              <div className="text-[10px] text-slate-400">
                Rate {config?.ssclRate}% · Parts base {config?.liableBasePart}% · SVC base {config?.liableBaseSvc}%
              </div>
            </div>
            {/* Totals summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-slate-100">
              {[
                {l:'Total Turnover', v: totals.totalTurnover},
                {l:'Liable Base', v: totals.totalLiable},
                {l:'SSCL Due', v: totals.ssclDue, highlight: true},
                {l:'Parts / SVC Split', v: `${((totals.partTurnover/(totals.totalTurnover||1))*100).toFixed(0)}% / ${((totals.svcTurnover/(totals.totalTurnover||1))*100).toFixed(0)}%`, isText: true},
              ].map((s: any) => (
                <div key={s.l} className="bg-white px-4 py-3 text-center">
                  <p className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">{s.l}</p>
                  <p className={`font-black text-sm ${s.highlight ? 'text-red-600' : 'text-slate-800'}`}>
                    {s.isText ? s.v : `Rs.${(s.v as number).toLocaleString()}`}
                  </p>
                </div>
              ))}
            </div>
            {/* Table */}
            {months.length === 0 ? (
              <div className="text-center py-10 text-slate-400 text-sm">No sales found for this period</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase">
                    <th className="px-3 py-2 text-left">Month</th>
                    <th className="px-3 py-2 text-right">Parts T/O</th>
                    <th className="px-3 py-2 text-right">SVC T/O</th>
                    <th className="px-3 py-2 text-right">Total T/O</th>
                    <th className="px-3 py-2 text-right">Parts Liable</th>
                    <th className="px-3 py-2 text-right">SVC Liable</th>
                    <th className="px-3 py-2 text-right">Total Liable</th>
                    <th className="px-3 py-2 text-right">Parts SSCL</th>
                    <th className="px-3 py-2 text-right">SVC SSCL</th>
                    <th className="px-3 py-2 text-right font-black text-slate-700">SSCL Due</th>
                  </tr></thead>
                  <tbody>
                    {months.map((m: any) => (
                      <tr key={m.month} className="border-t border-slate-100">
                        <td className="px-3 py-2 font-semibold">{m.month}</td>
                        <td className="px-3 py-2 text-right text-slate-500">Rs.{m.partTurnover.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-500">Rs.{m.svcTurnover.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold">Rs.{m.totalTurnover.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-500">Rs.{m.partLiable.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-500">Rs.{m.svcLiable.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-semibold">Rs.{m.totalLiable.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-orange-500">Rs.{m.partSscl.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-orange-500">Rs.{m.svcSscl.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-black text-red-600">Rs.{m.totalSscl.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-bold">
                      <td className="px-3 py-2">TOTALS</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.partTurnover.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.svcTurnover.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.totalTurnover.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.partLiable.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.svcLiable.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.totalLiable.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.partSscl.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">Rs.{totals.svcSscl.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-red-600">Rs.{totals.ssclDue.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
