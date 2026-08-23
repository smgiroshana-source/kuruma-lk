'use client'
// ── WHEEL MART ONLY — never import this from _standard/ ──────────────────────
// Shows the gazette CRN register (Tax Credit Notes). Customer receivables now
// live in their own 'receivables' tab (see WheelMartSidebar / page.tsx).
import { useState, useEffect, useCallback } from 'react'
import { CommonTabProps } from '../_shared/TabCredit'
import { colomboToday } from '@/lib/dates'
import { escapeHtml } from '@/lib/escapeHtml'

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })
}

function monthStart() { return colomboToday().slice(0, 7) + '-01' }
function today()      { return colomboToday() }

export default function TabCreditNotes({ vendor, vendorSettings, showToast }: CommonTabProps) {
  // ── CRN register state ───────────────────────────────────────────────────
  const [crnData, setCrnData]         = useState<any[]>([])
  const [crnLoading, setCrnLoading]   = useState(false)
  const [crnFrom, setCrnFrom]         = useState(monthStart)
  const [crnTo,   setCrnTo]           = useState(today)
  const [entities, setEntities]       = useState<any[]>([])

  const fetchCrn = useCallback(async () => {
    setCrnLoading(true)
    try {
      const [cnRes, entRes] = await Promise.all([
        fetch(`/api/vendor/credit-notes?from=${crnFrom}&to=${crnTo}`),
        fetch('/api/vendor/invoice-entities'),
      ])
      if (cnRes.ok)  { const j = await cnRes.json();  setCrnData(j.creditNotes || []) }
      if (entRes.ok) { const j = await entRes.json(); setEntities(j.entities || []) }
    } catch {}
    setCrnLoading(false)
  }, [crnFrom, crnTo])

  useEffect(() => { fetchCrn() }, [fetchCrn])

  const totalVat   = crnData.reduce((s, cn) => s + (Number(cn.vat_amount)  || 0), 0)
  const totalNet   = crnData.reduce((s, cn) => s + (Number(cn.net_amount)  || 0), 0)
  const totalCredit = crnData.reduce((s, cn) => s + (Number(cn.total)      || 0), 0)

  function printCreditNote(cn: any) {
    const entityInfo = entities.find((e: any) => e.id === cn.invoice_entity_id)
    const itemRows = (cn.items || []).map((i: any) =>
      `<tr>
        <td style="padding:7px 8px;border-bottom:1px solid #f0f0f0">${escapeHtml(i.product_name)}</td>
        <td style="padding:7px 8px;text-align:center;border-bottom:1px solid #f0f0f0">${i.quantity}</td>
        <td style="padding:7px 8px;text-align:right;border-bottom:1px solid #f0f0f0">Rs.${parseInt(i.unit_price).toLocaleString()}</td>
        <td style="padding:7px 8px;text-align:right;font-weight:700;border-bottom:1px solid #f0f0f0">Rs.${parseInt(i.total).toLocaleString()}</td>
      </tr>`).join('')
    const total    = parseInt(cn.total     || 0)
    const vatAmt   = parseInt(cn.vat_amount || 0)
    const netAmt   = parseInt(cn.net_amount || 0)
    // Historical rate derived from the stored amounts — never the current config
    const vatRate  = netAmt > 0 ? Math.round(vatAmt / netAmt * 100) : 18
    const origDateIso = cn.original_sale?.date_supply || cn.original_sale?.created_at
    const origDate = origDateIso ? new Date(origDateIso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : ''
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Credit Note ${escapeHtml(cn.credit_note_no)}</title>
<style>
@page{size:A4 portrait;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,'Helvetica Neue',sans-serif;font-size:12px;color:#111;
     width:210mm;min-height:297mm;margin:0 auto;padding:18mm 18mm 14mm;background:#fff}
@media print{body{padding:18mm 18mm 14mm}}
.title{font-size:22px;font-weight:900;letter-spacing:1px;text-align:center;margin-bottom:3px}
.subtitle{font-size:11px;text-align:center;color:#888;margin-bottom:14px}
.ref-box{background:#fff8e1;border:1px solid #f9a825;border-radius:4px;
         padding:9px 12px;font-size:11px;margin-bottom:12px;line-height:1.7}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:12px}
.party-box{border:1px solid #ddd;border-radius:4px;padding:10px 12px}
.party-label{font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;
             color:#888;border-bottom:1px solid #eee;padding-bottom:3px;margin-bottom:5px}
.meta{display:flex;gap:32px;margin-bottom:12px;font-size:11px}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
thead tr{background:#f5f5f5}
th{padding:7px 8px;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;
   border-top:1.5px solid #000;border-bottom:1.5px solid #000}
.ttbl{width:50%;margin-left:auto;border:1px solid #ddd;border-collapse:collapse}
.ttbl td{padding:6px 10px;border-bottom:1px solid #eee;font-size:12px}
.ttbl tr:last-child td{border-bottom:none;font-weight:900;font-size:14px;border-top:2px double #000;padding:7px 10px}
.tval{text-align:right;font-weight:700}
.footer{font-size:9px;color:#aaa;text-align:center;margin-top:16px;
        padding-top:8px;border-top:1px dashed #ddd}
</style></head><body>
<div class="title">CREDIT NOTE</div>
<div class="subtitle">This is not a Tax Invoice</div>

<div class="ref-box">
  <strong>Against Tax Invoice:</strong> ${escapeHtml(cn.original_serial)}${origDate ? ` &nbsp;dated&nbsp; <strong>${origDate}</strong>` : ''}
  &nbsp;&nbsp;|&nbsp;&nbsp;
  <strong>Reason:</strong> ${cn.reason === 'goods_returned' ? 'Goods Returned' : escapeHtml(cn.reason) || 'Goods Returned'}
</div>

<div class="parties">
  <div class="party-box">
    <div class="party-label">Supplier</div>
    <div style="font-weight:700;font-size:12px">${escapeHtml(entityInfo?.name) || 'MacForce Auto Engineering (Pvt) Ltd'}</div>
    <div style="font-size:10px;color:#444;margin-top:2px">${escapeHtml(entityInfo?.address)}</div>
    <div style="font-size:10px;font-weight:700;margin-top:2px">TIN: ${escapeHtml(entityInfo?.tin)}</div>
  </div>
  <div class="party-box">
    <div class="party-label">Purchaser</div>
    <div style="font-weight:700;font-size:12px">${escapeHtml(cn.customer_name) || '—'}</div>
    ${cn.customer_address ? `<div style="font-size:10px;color:#444;margin-top:2px">${escapeHtml(cn.customer_address)}</div>` : ''}
    ${cn.customer_tin    ? `<div style="font-size:10px;font-weight:700;margin-top:2px">TIN: ${escapeHtml(cn.customer_tin)}</div>` : ''}
  </div>
</div>

<div class="meta">
  <div><span style="color:#666">Credit Note No:</span> <strong>${cn.credit_note_no}</strong></div>
  <div><span style="color:#666">Date Issued:</span> <strong>${new Date(cn.issued_at).toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'})}</strong></div>
</div>

<table>
  <thead><tr>
    <th>Description of Goods / Services</th>
    <th style="text-align:center;width:50px">Qty</th>
    <th style="text-align:right;width:120px">Unit Price (Rs.)</th>
    <th style="text-align:right;width:120px">Amount (Rs.)</th>
  </tr></thead>
  <tbody>${itemRows}</tbody>
</table>

<table class="ttbl">
  <tr><td>Net Amount (excl. VAT)</td><td class="tval">Rs.${netAmt.toLocaleString()}</td></tr>
  <tr><td>VAT @ ${vatRate}%</td><td class="tval">Rs.${vatAmt.toLocaleString()}</td></tr>
  <tr><td>Total Credit (Rs.)</td><td class="tval">Rs.${total.toLocaleString()}</td></tr>
</table>

<div class="footer">
  ${escapeHtml(entityInfo?.name) || 'MacForce Auto Engineering (Pvt) Ltd'} · TIN: ${escapeHtml(entityInfo?.tin)}<br/>
  This credit note reduces output VAT and SSCL turnover in the period of issue (not the original invoice period).<br/>
  Generated ${new Date().toLocaleString('en-LK')} · Retain for 5 years
</div>
<script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1200)}</script>
</body></html>`
    const w = window.open('', '_blank', 'width=820,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-black text-slate-800">📋 Credit Notes</h1>
        <p className="text-sm text-slate-500 mt-1">Tax Credit Notes (CRN) issued against gazette invoices. To collect money owed by customers, use <strong>Receivables</strong>.</p>
      </div>

      {/* ── CRN Register ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
          {/* Date filter + refresh */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">From</span>
              <input type="date" value={crnFrom} onChange={e => setCrnFrom(e.target.value)}
                className="text-sm font-semibold text-slate-700 outline-none bg-transparent" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">To</span>
              <input type="date" value={crnTo} onChange={e => setCrnTo(e.target.value)}
                className="text-sm font-semibold text-slate-700 outline-none bg-transparent" />
            </div>
            <button onClick={fetchCrn} disabled={crnLoading}
              className="px-4 py-2 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-sm font-bold hover:bg-orange-100 disabled:opacity-50">
              {crnLoading ? '⏳' : '🔄'} Refresh
            </button>
          </div>

          {/* Summary cards */}
          {crnData.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Credit Notes Issued', value: crnData.length.toString(), color: 'text-slate-800' },
                { label: 'VAT Credited', value: `Rs.${totalVat.toLocaleString()}`, color: 'text-blue-700' },
                { label: 'Total Credited', value: `Rs.${totalCredit.toLocaleString()}`, color: 'text-orange-600' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-4">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">{c.label}</p>
                  <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
                </div>
              ))}
            </div>
          )}

          {/* CRN table */}
          {crnLoading ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 font-semibold">Loading credit notes…</p>
            </div>
          ) : crnData.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-3xl mb-3 opacity-30">🧾</p>
              <p className="text-slate-500 font-semibold">No credit notes issued in this period</p>
              <p className="text-xs text-slate-400 mt-1">Credit notes are issued when items are returned against a gazette tax invoice</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">CRN No.</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Against Invoice</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Date Issued</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Customer</th>
                    <th className="text-left px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Reason</th>
                    <th className="text-right px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Net</th>
                    <th className="text-right px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">VAT</th>
                    <th className="text-right px-4 py-3 text-[10px] font-black text-slate-500 uppercase tracking-wider">Total Credit</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {crnData.map((cn: any) => (
                    <tr key={cn.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-black text-green-700">{cn.credit_note_no}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{cn.original_serial}</td>
                      <td className="px-4 py-3 text-slate-600">{fmtDate(cn.issued_at)}</td>
                      <td className="px-4 py-3 font-semibold text-slate-800">{cn.customer_name || '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {cn.reason === 'goods_returned' ? 'Goods Returned' : cn.reason || '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-700">Rs.{(cn.net_amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right text-blue-700 font-semibold">Rs.{(cn.vat_amount || 0).toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-black text-orange-600">Rs.{(cn.total || 0).toLocaleString()}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => printCreditNote(cn)}
                          className="text-xs font-bold text-slate-500 hover:text-slate-800 px-2 py-1 rounded border border-slate-200 hover:border-slate-400">
                          🖨️ Print
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr className="border-t-2 border-slate-300 bg-slate-50">
                    <td colSpan={5} className="px-4 py-3 text-xs font-black text-slate-500 uppercase tracking-wider">
                      Period Totals — {crnData.length} credit note{crnData.length !== 1 ? 's' : ''}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">Rs.{totalNet.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-700">Rs.{totalVat.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right font-black text-orange-600">Rs.{totalCredit.toLocaleString()}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* VAT register note */}
          {crnData.length > 0 && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-xs text-blue-700 font-semibold">
              ℹ️ These credit notes reduce output VAT by <strong>Rs.{totalVat.toLocaleString()}</strong> in your VAT register for this period.
              View the full VAT register under <span className="underline cursor-pointer">Sales → Tax</span>.
            </div>
          )}
        </div>
    </div>
  )
}
