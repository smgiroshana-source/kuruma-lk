'use client'
import { toWhatsAppNumber } from '@/lib/constants'
import { colomboToday } from '@/lib/dates'
import { escapeHtml } from '@/lib/escapeHtml'
import { isValidSLPhone, PHONE_FORMAT_MSG } from '@/lib/phone'
import { gpPercent, isBelowCost, netOfVat, costIncVat } from '@/lib/margin'
import { useState, useEffect, useMemo } from 'react'

const PAY_METHODS = ['cash', 'cheque', 'bank', 'card']
const PAY_LABELS: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank: 'Bank Transfer', card: 'Card', advance: 'Advance', credit: 'Credit' }

function formatDate(d: string) { return new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) }
function cleanPrintNotes(notes: string | null | undefined): string {
  if (!notes) return ''
  return notes.split(/;\s*|\n/).map(s => s.trim()).filter(s =>
    s.length > 0 && !s.startsWith('Cancelled SAK-') && !s.startsWith('ON APPROVAL')
    && !s.startsWith('VOIDED:') && !s.startsWith('RETURN:') && !s.startsWith('ITEM RETURNED:')
  ).join('; ').trim()
}
function numberToWords(n: number): string {
  if (n === 0) return 'Zero'
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  function chunk(x: number): string {
    if (x === 0) return ''
    if (x < 20) return ones[x]
    if (x < 100) return tens[Math.floor(x/10)] + (x%10 ? ' ' + ones[x%10] : '')
    return ones[Math.floor(x/100)] + ' Hundred' + (x%100 ? ' ' + chunk(x%100) : '')
  }
  let result = ''
  if (Math.floor(n/10000000)) result += chunk(Math.floor(n/10000000)) + ' Crore '
  if (Math.floor((n%10000000)/100000)) result += chunk(Math.floor((n%10000000)/100000)) + ' Lakh '
  if (Math.floor((n%100000)/1000)) result += chunk(Math.floor((n%100000)/1000)) + ' Thousand '
  if (n%1000) result += chunk(n%1000)
  return result.trim()
}
function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${mm}/${dd}/${yyyy}`
}

function printTaxInvoice(sale: any, vendor: any, settings?: any) {
  const items = (sale.items || [])
    .filter((i: any) => (i.returned_quantity || 0) < i.quantity)
    .map((i: any) => {
      const qty = i.quantity - (i.returned_quantity || 0)
      return { ...i, quantity: qty, total: qty * parseFloat(i.unit_price) }
    })
  const s            = settings || {}
  const vatRate      = Number(s.vat_rate) || 18                              // gazette: never hardcode rates
  const total        = parseFloat(sale.total) || 0
  const vatAmount    = parseInt(sale.vat_amount) || Math.round(total * vatRate / (100 + vatRate))
  const netAmount    = parseInt(sale.net_amount) || (total - vatAmount)
  const discount     = parseFloat(sale.discount || 0)
  const serial       = escapeHtml(sale.tax_serial || sale.invoice_no || '')
  // A promoted invoice carries ONE date (owner rule): Date of Invoice and Date
  // of Supply both read the date stamped at promotion, which is the date of
  // the previous tax invoice. The real timestamps stay in the database —
  // created_at for the sale, promoted_at for when the document was raised.
  const invoiceDate  = fmtDate(sale.promoted_at ? (sale.date_supply || sale.created_at) : sale.created_at)
  const supplyDate   = fmtDate(sale.date_supply || sale.created_at)
  const totalWords   = numberToWords(total) + ' Rupees Only'
  const supplierName    = 'MacForce Auto Engineering (Pvt) Ltd'
  const supplierAddress = escapeHtml(s.supplier_address) || 'No. 351/T, Pannipitiya Road, Thalawathugoda'
  const supplierTin     = escapeHtml(s.supplier_tin)     || '101969738'
  const purchaserName    = escapeHtml(sale.customer_name)
  const purchaserAddress = escapeHtml(sale.customer_address)
  const purchaserTin     = escapeHtml(sale.customer_tin)
  const purchaserPhone   = escapeHtml(sale.customer_phone)
  const vehicleNo        = escapeHtml(sale.vehicle_no)
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false)
    ? `<img src="${escapeHtml(s.logo_url)}" style="height:52px;max-width:120px;object-fit:contain;display:block;margin-bottom:4px">`
    : ''
  const lineRows = items.map((i: any, idx: number) => `
    <tr>
      <td class="c-no">${idx + 1}</td>
      <td class="c-desc">${escapeHtml(i.product_name)}</td>
      <td class="c-qty">${i.quantity}</td>
      <td class="c-price">${parseFloat(i.unit_price).toLocaleString()}</td>
      <td class="c-amt">${parseFloat(i.total).toLocaleString()}</td>
    </tr>`).join('')
  const paymentHtml = (() => {
    const pmts = (sale.payments || []).filter((p: any) => p.payment_method !== 'credit_return')
    if (!pmts.length) return ''
    const lines = pmts.map((p: any) =>
      `<span style="margin-right:16px"><strong>${escapeHtml((p.payment_method || 'cash').toUpperCase())}${p.cheque_number ? ' #' + escapeHtml(p.cheque_number) : ''}</strong>: Rs.&nbsp;${parseFloat(p.amount).toLocaleString()}</span>`
    ).join('')
    return `<div class="pmt"><div class="pmt-lbl">Payment Method</div><div class="pmt-val">${lines}</div></div>`
  })()
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TAX INVOICE ${serial}</title>
<style>
/* ─── Page: zero browser margins; body padding = paper margins ─── */
@page{size:A4 portrait;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html{background:#8c9194;min-height:100%;padding:10mm 0 20mm}
body{
  font-family:Arial,'Helvetica Neue',sans-serif;
  font-size:13.5px;color:#111;line-height:1.5;
  width:210mm;min-height:297mm;
  margin:0 auto;padding:16mm 16mm 13mm;
  background:#fff;
  box-shadow:0 4px 24px rgba(0,0,0,.4);
  display:flex;flex-direction:column;
}
@media print{
  html{background:#fff;padding:0}
  body{width:100%;min-height:297mm;margin:0;padding:16mm 16mm 13mm;box-shadow:none}
}
/* ─── Header ─────────────────────────────────────────────── */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;
     gap:16px;padding-bottom:13px;border-bottom:3px solid #000;margin-bottom:14px}
.hl{flex:1}
.hl-name{font-size:23px;font-weight:900;line-height:1.15}
.hl-sub{font-size:12px;color:#444;margin-top:4px}
.hl-tin{font-size:12.5px;font-weight:700;margin-top:4px}
.hr{text-align:right;flex-shrink:0}
.hr-badge{display:inline-block;border:3px solid #000;padding:8px 20px;
          font-size:24px;font-weight:900;letter-spacing:2.5px;line-height:1.2}
.hr-sno{font-size:12px;font-weight:700;margin-top:8px;
        font-family:'Courier New',monospace;letter-spacing:.4px}
/* ─── Unified info box (parties + dates) ─────────────────── */
.ibox{border:1.5px solid #000;margin-bottom:14px}
/* flex (not fixed 2-col grid): rows hold 1–3 cells — full-width purchaser,
   and dates row fits Vehicle No when present */
.irow{display:flex}
.irow+.irow{border-top:1px solid #000}
.ic{flex:1;padding:10px 14px}
.ic+.ic{border-left:1px solid #000}
.ic-lbl{font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;
        color:#666;border-bottom:1px solid #e0e0e0;padding-bottom:4px;margin-bottom:6px}
.ic-name{font-size:16px;font-weight:700}
.ic-sub{font-size:12.5px;color:#333;margin-top:3px;line-height:1.45}
.ic-tin{font-size:12.5px;font-weight:700;margin-top:4px}
.ic-tinna{font-size:12px;color:#bbb;margin-top:4px}
.ic-dlbl{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#666}
.ic-dval{font-size:15px;font-weight:700;font-family:'Courier New',monospace;margin-top:4px}
/* ─── Line-items table ───────────────────────────────────── */
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
   padding:8px 8px;text-align:left;
   border-top:2px solid #000;border-bottom:2px solid #000}
td{font-size:13.5px;padding:10px 8px;border-bottom:1px solid #e8e8e8;vertical-align:top}
.c-no{width:30px;text-align:center}
.c-qty{width:48px;text-align:center}
.c-price{width:120px;text-align:right;white-space:nowrap}
.c-amt{width:120px;text-align:right;font-weight:700;white-space:nowrap}
tbody tr:last-child td{border-bottom:2px solid #000}
/* ─── Totals — right-aligned bordered table ──────────────── */
.twrap{display:flex;justify-content:flex-end;margin-bottom:12px}
.ttbl{width:56%;border:1.5px solid #000;border-collapse:collapse;margin-bottom:0}
.ttbl td{font-size:13.5px;padding:9px 12px;border-bottom:1px solid #e8e8e8;vertical-align:middle}
.ttbl tbody tr:last-child td{border-bottom:none}
.tlbl{color:#333;border-right:1px solid #e8e8e8;white-space:nowrap}
.tval{text-align:right;font-weight:700;white-space:nowrap}
.ttbl .grand td{border-top:2px double #000;font-size:18px;font-weight:900;padding:11px 12px}
.ttbl .grand .tlbl{border-right:1px solid #bbb}
/* ─── Amount in words ─────────────────────────────────────── */
.words{border:1.5px solid #000;padding:10px 14px;margin-bottom:10px}
.wlbl{font-size:9px;font-weight:900;text-transform:uppercase;
      letter-spacing:1.2px;color:#666;margin-bottom:4px}
.wval{font-size:14px;font-weight:700}
/* ─── Payment ────────────────────────────────────────────── */
.pmt{border:1px solid #ddd;padding:8px 14px;margin-bottom:0}
.pmt-lbl{font-size:9px;font-weight:900;text-transform:uppercase;
         letter-spacing:1.2px;color:#666;margin-bottom:4px}
.pmt-val{font-size:13.5px;font-weight:700}
/* ─── Flexible spacer + signatures + footer ──────────────── */
.push{flex:1;min-height:18mm}
.sigs{display:flex;justify-content:space-between;gap:48px}
.sig{flex:1;text-align:center}
.sig-line{border-top:1px solid #000;padding-top:7px;
          font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#555}
.footer{text-align:center;font-size:10.5px;color:#888;
        margin-top:12px;padding-top:8px;border-top:1px dashed #ccc}
</style></head><body>

<!-- Header -->
<div class="hdr">
  <div class="hl">
    ${logoHtml ? `<div style="margin-bottom:5px">${logoHtml}</div>` : ''}
    <div class="hl-name">${supplierName}</div>
    <div class="hl-sub">${supplierAddress}</div>
    <div class="hl-tin">TIN: ${supplierTin}</div>
  </div>
  <div class="hr">
    <div class="hr-badge">TAX INVOICE</div>
    <div class="hr-sno">${serial}</div>
  </div>
</div>

<!-- Purchaser / Dates (supplier appears once, in the letterhead — gazette: top-left) -->
<div class="ibox">
  <div class="irow">
    <div class="ic">
      <div class="ic-lbl">Bill To (Purchaser)</div>
      <div class="ic-name">${purchaserName || '&mdash;'}</div>
      ${purchaserAddress ? `<div class="ic-sub">${purchaserAddress}</div>` : ''}
      ${purchaserPhone   ? `<div class="ic-sub">${purchaserPhone}</div>`   : ''}
      ${purchaserTin
        ? `<div class="ic-tin">TIN: ${purchaserTin}</div>`
        : `<div class="ic-tinna">TIN: Not Registered</div>`}
    </div>
  </div>
  <div class="irow">
    <div class="ic">
      <div class="ic-dlbl">Date of Invoice</div>
      <div class="ic-dval">${invoiceDate}</div>
    </div>
    <div class="ic">
      <div class="ic-dlbl">Date of Supply</div>
      <div class="ic-dval">${supplyDate}</div>
    </div>
    ${vehicleNo ? `
    <div class="ic">
      <div class="ic-dlbl">Vehicle No</div>
      <div class="ic-dval">${vehicleNo}</div>
    </div>` : ''}
  </div>
</div>

<!-- Line items -->
<table>
  <thead>
    <tr>
      <th class="c-no">#</th>
      <th>Description of Goods / Services</th>
      <th class="c-qty" style="text-align:center">Qty</th>
      <th class="c-price" style="text-align:right">Unit Price (Rs.)</th>
      <th class="c-amt"  style="text-align:right">Amount (Rs.)</th>
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<!-- Totals -->
<div class="twrap">
  <table class="ttbl">
    ${discount > 0
      ? `<tr><td class="tlbl">Discount</td><td class="tval">&#8722;&nbsp;${discount.toLocaleString()}</td></tr>`
      : ''}
    <tr><td class="tlbl">Net Amount (excl. VAT)</td><td class="tval">${netAmount.toLocaleString()}</td></tr>
    <tr><td class="tlbl">VAT @ ${vatRate}%</td><td class="tval">${vatAmount.toLocaleString()}</td></tr>
    <tr class="grand"><td class="tlbl">TOTAL (Rs.)</td><td class="tval">${total.toLocaleString()}</td></tr>
  </table>
</div>

<!-- Amount in words -->
<div class="words">
  <div class="wlbl">Amount in Words</div>
  <div class="wval">${totalWords}</div>
</div>

${paymentHtml}

<!-- Push spacer → signatures always at page bottom -->
<div class="push"></div>

<div class="sigs">
  <div class="sig"><div class="sig-line">Received By</div></div>
  <div class="sig"><div class="sig-line">Authorised Signatory</div></div>
</div>

<div class="footer">${escapeHtml(s.invoice_footer) || 'Thank you for your business!'}</div>

</body></html>`
  const win = window.open('', '_blank', 'width=960,height=1100')
  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 400) }
}

function printInvoice(sale: any, vendor: any, format: 'a4' | 'thermal', settings?: any) {
  if (sale.document_type === 'tax_invoice') return printTaxInvoice(sale, vendor, settings)
  const items = (sale.items || [])
    .filter((i: any) => (i.returned_quantity || 0) < i.quantity)
    .map((i: any) => {
      const displayQty = i.quantity - (i.returned_quantity || 0)
      return { ...i, quantity: displayQty, total: displayQty * parseFloat(i.unit_price) }
    })
  const payments = (sale.payments || []).filter((p: any) => p.payment_method !== 'credit_return')
  const isThermal = format === 'thermal'
  const s = settings || {}
  const shopName = escapeHtml(s.invoice_title || vendor?.name) || 'kuruma.lk'
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false && !isThermal) ? `<img src="${escapeHtml(s.logo_url)}" style="height:60px;max-width:120px;object-fit:contain;margin-bottom:4px" />` : ''
  const thermalLogoHtml = (s.logo_url && s.invoice_show_logo !== false && isThermal) ? `<img src="${escapeHtml(s.logo_url)}" style="height:30px;max-width:60px;object-fit:contain;margin-bottom:2px" />` : ''
  const footerText = escapeHtml(s.invoice_footer) || 'Thank you for your business!'
  const termsHtml = (!isThermal && s.invoice_terms) ? `<div style="margin-top:12px;padding:10px;border:2px solid #000;border-radius:6px;font-size:13px;color:#000;font-weight:600;line-height:1.5"><strong>Terms & Conditions:</strong><br/>${escapeHtml(s.invoice_terms).replace(/\n/g, '<br/>')}</div>` : ''
  const paymentLines = payments.map((p: any) => `<div style="display:flex;justify-content:space-between;font-size:${isThermal ? '10px' : '13px'};font-weight:${isThermal ? '700' : '600'};color:#000;padding:3px 0"><span>${escapeHtml((p.payment_method || 'cash').toUpperCase())}${p.cheque_number ? ' #' + escapeHtml(p.cheque_number) : ''}</span><span>Rs.${parseFloat(p.amount).toLocaleString()}</span></div>`).join('')
  const a4Style = `@page{size:A4;margin:15mm 18mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:13px;color:#222;font-weight:400;max-width:720px;margin:0 auto;padding:25px 30px}@media print{body{padding:0;max-width:100%}}.header{text-align:center;padding:20px 0 15px;margin-bottom:0}.shop-name{font-size:24px;font-weight:700;color:#000;letter-spacing:-0.5px}.header-sub{font-size:11px;color:#444;margin-top:2px;line-height:1.6}.invoice-title{display:flex;justify-content:space-between;align-items:center;padding:10px 0;margin-top:15px;border-top:2px solid #000;border-bottom:1px solid #aaa}.invoice-title h2{font-size:18px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:2px}.invoice-no{font-size:18px;font-weight:700;color:#000;font-family:'Courier New',monospace}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:12px 0}.info-cell{padding:8px 0;font-size:12px;border-bottom:1px solid #ccc}.info-cell:nth-child(even){text-align:right}.info-label{color:#555;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}.info-value{font-weight:600;color:#000;font-size:13px}table{width:100%;border-collapse:collapse;margin:15px 0}thead{background:#eee}th{text-align:left;font-size:10px;font-weight:700;padding:8px 10px;color:#222;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #aaa}td{padding:10px;font-size:13px;font-weight:500;color:#111;border-bottom:1px solid #ddd}.text-right{text-align:right}.totals{margin-top:10px;border-top:1px solid #aaa;padding-top:5px}.total-row{display:flex;justify-content:space-between;padding:4px 10px;font-size:13px;font-weight:600;color:#222}.grand-total{display:flex;justify-content:space-between;font-weight:800;font-size:20px;color:#000;padding:12px 10px;margin-top:5px;background:#eee;border-radius:4px}.balance-due{font-weight:700;font-size:16px;text-align:right;margin-top:15px;padding:12px 15px;border:2px solid #000;color:#000;border-radius:4px}.payments-section{margin-top:10px;padding:8px 10px;background:#f0f0f0;border-radius:4px}.payments-label{font-size:9px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.note-section{margin-top:10px;padding:8px 12px;font-size:12px;font-style:italic;color:#333;border-left:3px solid #999}.footer{text-align:center;padding:25px 0 10px;font-size:10px;color:#888;margin-top:30px;border-top:1px solid #ccc}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{background:#eee !important}.grand-total{background:#eee !important}}`
  const thermalStyle = `@page{size:80mm auto;margin:2mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;color:#000;width:300px;max-width:100%;margin:0 auto}.header{text-align:center;padding:5px 0;border-bottom:1px dashed #000}.shop-name{font-size:16px;font-weight:900}table{width:100%;border-collapse:collapse;margin:5px 0}th{text-align:left;font-size:10px;font-weight:900;padding:3px 2px;border-bottom:1px dashed #000}td{padding:3px 2px;font-size:11px;border-bottom:1px solid #ddd}.text-right{text-align:right}.totals{border-top:1px dashed #000;padding-top:5px}.total-row{display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:700}.grand-total{font-weight:900;font-size:16px;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:5px 0;margin-top:5px}.footer{text-align:center;padding:8px 0 5px;font-size:10px;border-top:1px dashed #000;margin-top:5px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(sale.invoice_no)}</title>
<style>${isThermal ? thermalStyle : a4Style}</style></head><body>
<div class="header">${isThermal ? thermalLogoHtml : logoHtml}<div class="shop-name">${shopName}</div><div class="header-sub">${escapeHtml([vendor?.location, vendor?.address].filter(Boolean).join(', '))}${vendor?.phone ? `<br/>Tel: ${escapeHtml(vendor.phone)}${vendor?.whatsapp && vendor.whatsapp !== vendor.phone ? ' | WhatsApp: ' + escapeHtml(vendor.whatsapp) : ''}` : ''}${s.tax_id ? `<br/>Tax/VAT: ${escapeHtml(s.tax_id)}` : ''}${s.email ? `<br/>${escapeHtml(s.email)}` : ''}</div></div>
${isThermal ? `<div style="padding:5px 0;font-size:11px"><div><strong>${sale.payment_status === 'draft' ? 'On Approval: ' : 'Invoice: '}</strong><strong style="font-size:12px">${escapeHtml(sale.invoice_no)}</strong></div><div><strong>Date: </strong><strong>${formatDate(sale.created_at)}</strong></div><div><strong>Customer: </strong><strong>${escapeHtml(sale.customer_name)}${sale.customer_phone ? ' (' + escapeHtml(sale.customer_phone) + ')' : ''}</strong></div>${sale.vehicle_no ? `<div><strong>Vehicle: </strong><strong style="font-size:12px;letter-spacing:2px">${escapeHtml(sale.vehicle_no)}</strong></div>` : ''}</div>` : `<div class="invoice-title"><h2>${sale.payment_status === 'draft' ? 'On Approval' : 'Invoice'}</h2><span class="invoice-no">${escapeHtml(sale.invoice_no)}</span></div><div class="info-grid"><div class="info-cell"><span class="info-label">Date</span><span class="info-value">${formatDate(sale.created_at)}</span></div><div class="info-cell"><span class="info-label">Vehicle No</span><span class="info-value" style="font-size:14px;letter-spacing:2px;font-family:'Courier New',monospace">${escapeHtml(sale.vehicle_no) || '—'}</span></div><div class="info-cell"><span class="info-label">Customer</span><span class="info-value">${escapeHtml(sale.customer_name)}${sale.customer_phone ? ' (' + escapeHtml(sale.customer_phone) + ')' : ''}</span></div><div class="info-cell"><span class="info-label">Payment Status</span><span class="info-value">${sale.payment_status === 'draft' ? 'PENDING' : sale.payment_status === 'paid' ? 'PAID' : sale.payment_status === 'voided' ? 'VOID' : parseFloat(sale.balance_due) > 0 ? 'CREDIT' : 'PAID'}</span></div></div>`}
<table><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead><tbody>${items.map((i: any) => `<tr><td>${i.product_sku ? escapeHtml(i.product_sku) + ' - ' : ''}${escapeHtml(i.product_name)}</td><td class="text-right">${i.quantity}</td><td class="text-right">Rs.${parseFloat(i.unit_price).toLocaleString()}</td><td class="text-right">Rs.${parseFloat(i.total).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<div class="totals">${parseFloat(sale.discount) > 0 ? `<div class="total-row"><span>Subtotal</span><span>Rs.${parseFloat(sale.subtotal).toLocaleString()}</span></div><div class="total-row" style="color:#000"><span>Discount</span><span>-Rs.${parseFloat(sale.discount).toLocaleString()}</span></div>` : ''}<div class="total-row grand-total"><span>TOTAL</span><span>Rs.${parseFloat(sale.total).toLocaleString()}</span></div></div>
${paymentLines ? (isThermal ? `<div style="margin-top:6px"><div style="font-size:10px;font-weight:600;margin-bottom:3px">Payments</div>${paymentLines}</div>` : `<div class="payments-section"><div class="payments-label">Payments</div>${paymentLines}</div>`) : ''}
${cleanPrintNotes(sale.notes) ? (isThermal ? `<div style="margin-top:5px;padding:4px;font-size:10px;font-style:italic">Note: ${escapeHtml(cleanPrintNotes(sale.notes))}</div>` : `<div class="note-section">Note: ${escapeHtml(cleanPrintNotes(sale.notes))}</div>`) : ''}
${(() => {
  const totalDue = parseFloat(sale.total_amount_due || sale.totalAmountDue || 0)
  const currentInvoiceDue = parseFloat(sale.balance_due || 0)
  if (totalDue > 0) {
    const showBreakdown = currentInvoiceDue > 0 && totalDue > currentInvoiceDue
    const paidNote = currentInvoiceDue === 0 ? '<div style="font-size:13px;font-weight:600;color:#000;margin-bottom:4px">This Invoice: PAID</div>' : ''
    return isThermal
      ? `<div style="text-align:center;font-weight:900;font-size:14px;margin-top:8px;padding:5px;border-top:1px dashed #000;border-bottom:1px dashed #000">${showBreakdown ? `This Invoice Due: Rs.${currentInvoiceDue.toLocaleString()}<br/>` : ''}${currentInvoiceDue === 0 ? 'This Invoice: PAID<br/>' : ''}TOTAL AMOUNT DUE: Rs.${totalDue.toLocaleString()}</div>`
      : `<div class="balance-due">${paidNote}${showBreakdown ? `<div style="font-size:14px;font-weight:700;margin-bottom:4px">This Invoice Due: Rs.${currentInvoiceDue.toLocaleString()}</div>` : ''}TOTAL AMOUNT DUE: Rs.${totalDue.toLocaleString()}</div>`
  }
  if (currentInvoiceDue > 0) {
    return isThermal
      ? `<div style="text-align:center;font-weight:900;font-size:14px;margin-top:8px;padding:5px;border-top:1px dashed #000;border-bottom:1px dashed #000">BALANCE DUE: Rs.${currentInvoiceDue.toLocaleString()}</div>`
      : `<div class="balance-due">BALANCE DUE: Rs.${currentInvoiceDue.toLocaleString()}</div>`
  }
  return ''
})()}
${termsHtml}
<div class="footer"><p style="color:${isThermal ? '#000' : '#999'}">${footerText}</p><p style="margin-top:3px;font-size:${isThermal ? '8px' : '9px'};color:#ccc">Powered by kuruma.lk</p></div></body></html>`
  const win = window.open('', '_blank', `width=${isThermal ? 350 : 900},height=700`)
  if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
}

function sendWhatsAppBill(sale: any, vendor: any, phone: string) {
  const waPhone = toWhatsAppNumber(phone)
  const items = (sale.items || []).map((i: any) => `• ${i.product_sku || ''} ${i.product_name} x${i.quantity} = Rs.${parseFloat(i.total).toLocaleString()}`).join('%0A')
  const payments = (sale.payments || []).map((p: any) => `  ${(p.payment_method || 'cash').toUpperCase()}: Rs.${parseFloat(p.amount).toLocaleString()}`).join('%0A')
  let msg = `*Invoice: ${sale.invoice_no}*%0A${vendor?.name || 'kuruma.lk'}%0A${formatDate(sale.created_at)}${sale.vehicle_no ? '%0AVehicle: ' + sale.vehicle_no : ''}%0A%0A${items}%0A%0ASubtotal: Rs.${parseFloat(sale.subtotal).toLocaleString()}`
  if (parseFloat(sale.discount) > 0) msg += `%0ADiscount: -Rs.${parseFloat(sale.discount).toLocaleString()}`
  msg += `%0A*TOTAL: Rs.${parseFloat(sale.total).toLocaleString()}*`
  if (payments) msg += `%0A%0APayments:%0A${payments}`
  if (parseFloat(sale.balance_due) > 0) msg += `%0A%0A⚠️ *TOTAL AMOUNT DUE: Rs.${parseFloat(sale.balance_due).toLocaleString()}*`
  msg += `%0A%0AThank you! - ${vendor?.name || 'kuruma.lk'}`
  window.open(`https://wa.me/${waPhone}?text=${msg}`, '_blank')
}

export interface PendingDraft {
  cart: any[]
  customer: any
  vehicleNo: string
  draftId: string
  draftInvoiceNo: string
}

export interface TabPOSLkTaxProps {
  vendor: any
  products: any[]
  vendorSettings: any
  showToast: (msg: string) => void
  onDataChanged: () => void
  /** When set, TabPOS will pre-populate its state from this draft and clear it once loaded. */
  pendingDraft?: PendingDraft | null
  onDraftLoaded?: () => void
  pendingAddItems?: any[] | null
  onItemsAdded?: () => void
}

export default function TabPOSLkTax({ vendor, products, vendorSettings, showToast, onDataChanged, pendingDraft, onDraftLoaded, pendingAddItems, onItemsAdded }: TabPOSLkTaxProps) {
  const isLkTax = vendorSettings?.invoice_mode === 'lk_tax'

  // ── POS state ──────────────────────────────────────────────────────────
  const [posCart, setPosCart] = useState<any[]>([])
  // Price-entry mode: 'incl' (default — operator types the customer-pays price)
  // or 'excl' (insurance jobs — operator types the approved ex-VAT figure and
  // VAT is added on top). The cart ALWAYS stores VAT-inclusive unit prices;
  // this only changes what the price inputs mean.
  const [posPriceMode, setPosPriceMode] = useState<'incl' | 'excl'>('incl')
  const [posSearch, setPosSearch] = useState('')
  const [posCustomer, setPosCustomer] = useState<any>({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false })
  const [customerSuggestions, setCustomerSuggestions] = useState<any[]>([])
  const [posDiscount, setPosDiscount] = useState('')
  const [posPayments, setPosPayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [posNotes, setPosNotes] = useState('')
  const [posDate, setPosDate] = useState(colomboToday())
  const [posVehicleNo, setPosVehicleNo] = useState('')
  // Explicit operator acknowledgement that the customer has no vehicle number —
  // the only way past the vehicle requirement on insurance bills.
  const [posNoVehicle, setPosNoVehicle] = useState(false)
  const [posLoading, setPosLoading] = useState(false)
  const [posErrors, setPosErrors] = useState<{ name?: boolean; phone?: boolean; vehicle?: boolean; address?: boolean; tin?: boolean }>({})
  const [posReceipt, setPosReceipt] = useState<any>(null)
  const [posPreview, setPosPreview] = useState(false)
  const [useAdvance, setUseAdvance] = useState(false)

  // Draft / On Approval
  const [draftReturning, setDraftReturning] = useState<string | null>(null)
  const [returningItem, setReturningItem] = useState<string | null>(null)
  const [posDraftId, setPosDraftId] = useState<string | null>(null)
  const [posDraftInvoiceNo, setPosDraftInvoiceNo] = useState('')
  const [allDrafts, setAllDrafts] = useState<any[]>([])

  // ── lk_tax POS state ───────────────────────────────────────────────────
  const [posInvoiceEntities, setPosInvoiceEntities] = useState<any[]>([])
  const [posEntityId, setPosEntityId] = useState<string | null>(null)
  const [posCustomerAddress, setPosCustomerAddress] = useState('')
  const [posCustomerTin, setPosCustomerTin] = useState('')
  const [posCustomerVatReg, setPosCustomerVatReg] = useState(false)
  const [posCustomerIsInsurance, setPosCustomerIsInsurance] = useState(false)
  const [showManualLine, setShowManualLine] = useState(false)
  const [manualLine, setManualLine] = useState({ name: '', qty: '1', price: '' })
  // Typed wording drifts ("alignment", "Wheel align", "W/A") and makes the
  // invoice and the service report inconsistent. These are the shop's list.
  const SERVICE_TYPES = [
    'Wheel Alignment',
    'Camber Adjustment',
    'Caster Adjustment',
    'Steering Adjustment',
    'Body Balancing',
    'Wheel Balancing (clip)',
    'Wheel Balancing (sticker)',
    'Thrust Angle',
    'Tyre Repair',
  ]
  const [serviceOther, setServiceOther] = useState(false)

  // ── lk_tax computed values ─────────────────────────────────────────────
  const posCurrentEntity = posInvoiceEntities.find((e: any) => e.id === posEntityId) || null
  const posIsVatEntity = posCurrentEntity?.invoice_mode === 'lk_tax'
  // Pvt Ltd (lk_tax) entity always issues tax invoices; other entities issue receipts
  const posDocType: 'receipt' | 'tax_invoice' = posIsVatEntity ? 'tax_invoice' : 'receipt'

  // ── On mount: load entities ────────────────────────────────────────────
  useEffect(() => {
    fetchInvoiceEntities()
    fetchAllDrafts()
  }, [])

  // ── Consume pendingDraft from page.tsx (Finalise → from Sales tab) ─────
  useEffect(() => {
    if (!pendingDraft) return
    setPosCart(pendingDraft.cart)
    setPosCustomer(pendingDraft.customer)
    setPosVehicleNo(pendingDraft.vehicleNo)
    setPosDraftId(pendingDraft.draftId)
    setPosDraftInvoiceNo(pendingDraft.draftInvoiceNo)
    setPosPayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
    setPosDiscount(''); setPosNotes(''); setPosPreview(false)
    setPosDate(colomboToday())
    onDraftLoaded?.()
  }, [pendingDraft])

  // ── Append items handed from the Products tab (Send to POS) — merge into the
  // current cart instead of replacing, so an in-progress sale isn't clobbered.
  useEffect(() => {
    if (!pendingAddItems || pendingAddItems.length === 0) return
    setPosCart(prev => {
      const next = [...prev]
      for (const it of pendingAddItems) {
        const idx = it.productId ? next.findIndex(c => c.productId === it.productId) : -1
        if (idx >= 0) {
          const cur = next[idx]
          const max = it.maxStock ?? cur.maxStock
          next[idx] = { ...cur, quantity: max ? Math.min(cur.quantity + it.quantity, max) : cur.quantity + it.quantity }
        } else {
          next.push({ ...it })
        }
      }
      return next
    })
    onItemsAdded?.()
  }, [pendingAddItems])

  async function fetchInvoiceEntities() {
    try {
      const res = await fetch('/api/vendor/invoice-entities')
      if (!res.ok) return
      const j = await res.json()
      const entities: any[] = j.entities || []
      setPosInvoiceEntities(entities)
      if (entities.length > 0) {
        setPosEntityId(prev => prev || (entities.find((e: any) => e.is_default) || entities[0]).id)
      }
    } catch {}
  }

  async function fetchAllDrafts() {
    try {
      const r = await fetch('/api/vendor/sales?period=all')
      if (r.ok) {
        const j = await r.json()
        setAllDrafts(
          (j.sales || [])
            .filter((s: any) => s.payment_status === 'draft')
            .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        )
      }
    } catch {}
  }

  async function sendEODReport() {
    const today = colomboToday()
    showToast('Fetching today\'s sales...')
    try {
      const r = await fetch(`/api/vendor/sales?from=${today}&to=${today}`)
      const j = await r.json()
      const sales = j.sales || []
      const vendorInfo = j.vendor || vendor
      if (!sales.length) { showToast('No sales today yet'); return }
      const phone = vendorInfo?.whatsapp || vendorInfo?.phone
      if (!phone) { showToast('No manager phone set'); return }
      // Build WhatsApp daily report message
      const filtered = sales.filter((s: any) => s.payment_status !== 'voided')
      const total = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.total || 0), 0)
      const paid = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.paid_amount || 0), 0)
      const credit = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)
      const methods: Record<string, number> = {}
      filtered.forEach((sale: any) => {
        if (sale.payments && sale.payments.length > 0) {
          sale.payments.forEach((p: any) => { const m = p.payment_method || 'cash'; methods[m] = (methods[m] || 0) + parseFloat(p.amount || 0) })
        } else if (parseFloat(sale.paid_amount || 0) > 0) {
          const m = sale.payment_method || 'cash'; methods[m] = (methods[m] || 0) + parseFloat(sale.paid_amount || 0)
        }
      })
      const dateStr = new Date(today).toLocaleDateString('en-LK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
      const lines: string[] = []
      lines.push(`📊 *Daily Sales Report*`)
      lines.push(`${vendorInfo?.name || 'kuruma.lk'}`)
      lines.push(`${dateStr}`)
      lines.push(`━━━━━━━━━━━━━━━━━━`)
      lines.push(`💰 *Total: Rs.${total.toLocaleString()}*`)
      lines.push(`✅ Collected: Rs.${paid.toLocaleString()}`)
      if (credit > 0) lines.push(`⚠️ Outstanding: Rs.${credit.toLocaleString()}`)
      lines.push(`📋 Invoices: ${filtered.length}`)
      if (Object.keys(methods).length > 0) {
        lines.push(``)
        lines.push(`*Payment Breakdown:*`)
        if (methods.cash) lines.push(`  💵 Cash: Rs.${methods.cash.toLocaleString()}`)
        if (methods.cheque) lines.push(`  📝 Cheque: Rs.${methods.cheque.toLocaleString()}`)
        if (methods.bank) lines.push(`  🏦 Bank: Rs.${methods.bank.toLocaleString()}`)
        if (methods.card) lines.push(`  💳 Card: Rs.${methods.card.toLocaleString()}`)
        if (methods.advance) lines.push(`  🔄 Advance: Rs.${methods.advance.toLocaleString()}`)
      }
      lines.push(``)
      lines.push(`— ${vendorInfo?.name || 'kuruma.lk'}`)
      const msg = encodeURIComponent(lines.join('\n'))
      const waNum = phone.replace(/\D/g, '').replace(/^0/, '94')
      window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank')
    } catch { showToast('Failed to fetch sales') }
  }

  // ── Customer search ────────────────────────────────────────────────────
  async function searchCustomers(query: string) {
    if (query.length < 2) { setCustomerSuggestions([]); return }
    try {
      const r = await fetch(`/api/vendor/customers?search=${encodeURIComponent(query)}`)
      if (r.ok) { const j = await r.json(); setCustomerSuggestions(j.customers || []) }
    } catch {}
  }

  function selectCustomer(customer: any) {
    const advance = parseFloat(customer.advance_balance || 0)
    setPosCustomer({ id: customer.id, name: customer.name, phone: customer.phone || '', advance, outstanding: 0, require_vehicle_no: customer.require_vehicle_no || false })
    // Auto-fill the saved tax details so a VAT-registered customer doesn't have
    // to be re-entered each visit (the sale already persists these back).
    setPosCustomerAddress(customer.address || '')
    setPosCustomerVatReg(!!customer.vat_registered)
    setPosCustomerTin(customer.vat_registered ? (customer.tin || '') : '')
    // Insurance companies quote ex-VAT: auto-switch the price-entry mode so the
    // operator types the approved figure and VAT is added on the bill.
    const isInsurance = !!customer.is_insurance
    setPosCustomerIsInsurance(isInsurance)
    setPosNoVehicle(false) // "no vehicle" acknowledgement never carries across customers
    if (posIsVatEntity) {
      setPosPriceMode(isInsurance ? 'excl' : 'incl')
      if (isInsurance) showToast('🏢 Insurance customer — enter prices EXCLUDING VAT (+' + posVatRate + '% added)')
    }
    setPosErrors(prev => ({ ...prev, name: false, phone: false, address: false, tin: false }))
    setCustomerSuggestions([])
    if (advance > 0) setUseAdvance(true)
    fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_outstanding', customerId: customer.id }) })
      .then(r => r.json()).then(j => {
        const outstanding = (j.sales || []).reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)
        setPosCustomer((prev: any) => ({ ...prev, outstanding }))
      }).catch(() => {})
  }

  // ── Cart ───────────────────────────────────────────────────────────────
  function addToCart(product: any) {
    setPosCart(prev => {
      const ex = prev.find(i => i.productId === product.id)
      if (ex) return prev.map(i => i.productId === product.id ? { ...i, quantity: Math.min(i.quantity + 1, product.quantity) } : i)
      return [...prev, { productId: product.id, productName: product.name, productSku: product.sku, unitPrice: product.price || 0, quantity: 1, maxStock: product.quantity, cost: product.cost ?? null }]
    })
    setPosSearch('')
  }
  function updateCartQty(i: number, q: number) { setPosCart(p => p.map((item, x) => x === i ? { ...item, quantity: Math.max(1, item.maxStock == null ? q : Math.min(q, item.maxStock)) } : item)) }
  function updateCartPrice(i: number, price: number) { setPosCart(p => p.map((item, x) => x === i ? { ...item, unitPrice: price } : item)) }
  function removeFromCart(i: number) { setPosCart(p => p.filter((_, x) => x !== i)) }
  // Empty the whole sale and start fresh (cart, customer, vehicle, payments, draft)
  function clearPos() {
    if (posCart.length > 0 && !confirm('Clear the current sale and start a new one?')) return
    setPosCart([]); setPosDraftId(null); setPosDraftInvoiceNo('')
    setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false })
    setPosVehicleNo(''); setPosNoVehicle(false); setPosCustomerAddress(''); setPosCustomerTin(''); setPosCustomerVatReg(false); setPosCustomerIsInsurance(false)
    setPosDiscount(''); setPosNotes(''); setPosErrors({}); setUseAdvance(false)
    setPosPriceMode('incl') // ex-VAT entry is per-job (insurance) — never carry into the next sale
    setPosPayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  }

  function addManualLine() {
    const name = manualLine.name.trim()
    const qty = Math.max(1, parseInt(manualLine.qty) || 1)
    const entered = parseInt(manualLine.price) || 0
    const price = posEntryExcl ? grossOfNet(entered) : entered // cart stores VAT-inclusive
    if (!name) return
    setPosCart(prev => [...prev, {
      productId: null, productName: name, productSku: '', unitPrice: price,
      quantity: qty, maxStock: null, ssclStream: 'SVC',
    }])
    setManualLine({ name: '', qty: '1', price: '' })
    setServiceOther(false)
    // Stay open: a tyre job is usually several services in a row
    // (alignment + balancing + repair), so the next one is one tap away.
  }

  // ── Payment lines ──────────────────────────────────────────────────────
  function addPaymentLine() { setPosPayments(p => [...p, { method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]) }
  function updatePaymentLine(i: number, field: string, value: string) { setPosPayments(p => p.map((line, x) => x === i ? { ...line, [field]: value } : line)) }
  function removePaymentLine(i: number) { setPosPayments(p => p.filter((_, x) => x !== i)) }

  const [cardFeePct, setCardFeePct] = useState(3.5)
  useEffect(() => {
    fetch('/api/vendor/tax-config').then(r => r.json())
      .then(j => { if (j.config?.card_fee_pct != null) setCardFeePct(parseFloat(j.config.card_fee_pct)) })
      .catch(() => {})
  }, [])
  // ── Card pricing ───────────────────────────────────────────────────────
  // A card sale is priced higher, it does not carry a fee. The uplift is
  // DERIVED from the payment lines and applied at display/submit time; the
  // cart keeps the base price, so switching card → cash reverts exactly and
  // switching back cannot compound.
  //
  // Any card line puts the WHOLE bill on card prices: one line cannot have two
  // prices, and "part of your bill is priced differently" is not explainable
  // at a counter.
  const posCardPricing = posPayments.some((p: any) => p.method === 'card')
  const cardPrice = (base: number) =>
    posCardPricing ? Math.round((Number(base) || 0) * (100 + cardFeePct) / 100) : Math.round(Number(base) || 0)

  // ── Computed totals ────────────────────────────────────────────────────
  const { posSubtotal, posDiscountAmt, posTotal, posPaidAmount, posAdvanceApplied, posTotalPaid, posBalance, posOverpayment } = useMemo(() => {
    // Sum the prices actually shown, so a customer adding up the printed
    // lines reaches the same total.
    const posSubtotal = posCart.reduce((s, i) => s + i.quantity * cardPrice(i.unitPrice), 0)
    const posDiscountAmt = Math.min(posSubtotal, Math.max(0, Math.round(parseFloat(posDiscount) || 0)))
    const posTotal = Math.max(0, posSubtotal - posDiscountAmt)
    const posPaidAmount = posPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    const posAdvanceApplied = useAdvance && posCustomer.advance > 0 ? Math.min(posCustomer.advance, Math.max(0, posTotal - posPaidAmount)) : 0
    const posTotalPaid = posPaidAmount + posAdvanceApplied
    const posBalance = Math.max(0, posTotal - posTotalPaid)
    const posOverpayment = Math.max(0, posTotalPaid - posTotal)
    return { posSubtotal, posDiscountAmt, posTotal, posPaidAmount, posAdvanceApplied, posTotalPaid, posBalance, posOverpayment }
  }, [posCart, posDiscount, posPayments, useAdvance, posCustomer, posCardPricing, cardFeePct])

  const posVatRate = Number(vendorSettings?.vat_rate) || 18
  // The bank's card-machine fee. When the shop passes it to the customer it
  // must be a LINE on the invoice (revenue, VAT applies, SVC stream) — extra
  // money on the card machine that isn't invoiced would never reconcile with
  // the bank settlement, and the VAT return would understate.

  const posVatAmount = posIsVatEntity ? Math.round(posTotal * posVatRate / (100 + posVatRate)) : 0
  const posNetAmount = posIsVatEntity ? posTotal - posVatAmount : posTotal
  // Entered prices are VAT-inclusive. For the VAT entity the shop only keeps the
  // ex-VAT slice, so GP%/below-cost must compare cost against that, not the
  // sticker price — otherwise a loss-making sale can pass the warning.
  const posMarginBase = (p: number | null | undefined) => posIsVatEntity ? netOfVat(p, posVatRate) : (Number(p) || 0)
  // What the goods actually cost, in the same currency as the price being
  // compared against them.
  //
  // Cost is stored net because the Pvt Ltd reclaims the input VAT. Sell through
  // the PROPRIETORSHIP and no VAT is remitted on the sale, so the price is not
  // reduced either — which means the cost it must clear is the full amount paid
  // for the goods, VAT included. Comparing a gross price against a net cost
  // would let a tube go out Rs.184 light and call it profit.
  const posCostBasis = (c: number | null | undefined) =>
    isLkTax && !posIsVatEntity ? costIncVat(c, posVatRate) : (Number(c) || 0)

  // The floor comes out the SAME on both entities, which is the point: Rs.1,207
  // either way for a tube that cost Rs.1,207. On the VAT entity the price is
  // taken net and compared to the net cost; on the proprietorship both sides
  // stay gross. One number for the operator to remember.
  const posCostFloor = (c: number | null | undefined) =>
    isLkTax ? costIncVat(c, posVatRate) : (Number(c) || 0)
  // Ex-VAT price entry (insurance quotes): only meaningful on the VAT entity.
  const posEntryExcl = posIsVatEntity && posPriceMode === 'excl'
  const grossOfNet = (p: number) => Math.round((Number(p) || 0) * (100 + posVatRate) / 100)

  // ── Parse tyre size from a search string ─────────────────────────────
  function parseTyreSize(q: string): { width: number; profile: number; rim: number } | null {
    // Handles: 185/65R15, 185/65/15, 185 65 15, 18565R15, 18565/15
    const m = q.trim().match(/^(\d{3})[/\s]?(\d{2,3})[Rr/\s]?(\d{2})$/)
    if (!m) return null
    const [, w, pr, ri] = m
    return { width: parseInt(w), profile: parseInt(pr), rim: parseInt(ri) }
  }

  // ── Filtered products for search ───────────────────────────────────────
  const posFilteredProducts = useMemo(() => {
    if (!posSearch || posSearch.length < 2) return []
    const s = posSearch.toLowerCase()
    const tyreSize = parseTyreSize(posSearch.trim())
    return (products || []).filter((p: any) => {
      if (p.quantity <= 0) return false
      // Tyre-size match takes priority when a size pattern is detected
      if (tyreSize && p.product_type === 'tyre') {
        return p.tyre_width === tyreSize.width &&
               p.tyre_profile === tyreSize.profile &&
               p.tyre_rim === tyreSize.rim
      }
      // Normal text search — also match tyre sizes like "185/65R15" in name
      return p.name.toLowerCase().includes(s) ||
             (p.sku || '').toLowerCase().includes(s) ||
             (p.make || '').toLowerCase().includes(s) ||
             // e.g. searching "185" matches tyres with width 185
             (p.product_type === 'tyre' && (
               String(p.tyre_width  || '').includes(s) ||
               `${p.tyre_width}/${p.tyre_profile}r${p.tyre_rim}`.includes(s)
             ))
    })
  }, [products, posSearch])

  // ── Quick picks: most recently sold products (per-vendor, this device) ──
  const quickPickKey = 'kuruma-pos-recents-' + (vendor?.id || '')
  const [quickPickIds, setQuickPickIds] = useState<string[]>([])
  useEffect(() => {
    try { setQuickPickIds(JSON.parse(localStorage.getItem(quickPickKey) || '[]')) } catch {}
  }, [quickPickKey])
  const quickPicks = useMemo(() =>
    quickPickIds
      .map(id => (products || []).find((p: any) => p.id === id && p.quantity > 0))
      .filter(Boolean)
      .slice(0, 10),
  [quickPickIds, products])
  function recordQuickPicks(cart: any[]) {
    try {
      const ids = cart.map(i => i.productId).filter(Boolean)
      if (!ids.length) return
      const next = [...ids, ...quickPickIds.filter(id => !ids.includes(id))].slice(0, 12)
      setQuickPickIds(next)
      localStorage.setItem(quickPickKey, JSON.stringify(next))
    } catch {}
  }

  // ── Create sale ────────────────────────────────────────────────────────
  function handleCreateSale() {
    if (posCart.length === 0) { showToast('Add items to cart'); return }
    const errors: { name?: boolean; phone?: boolean; vehicle?: boolean; address?: boolean; tin?: boolean } = {}
    if (!posCustomer.name.trim()) errors.name = true
    // Phone must be a valid SL number: 10 digits starting with 0
    if (!isValidSLPhone(posCustomer.phone)) errors.phone = true
    // Insurance bills are per-vehicle claims — vehicle number is compulsory
    // unless the operator explicitly ticked "vehicle number not available".
    if ((posCustomer.require_vehicle_no || posCustomerIsInsurance) && !posVehicleNo.trim() && !posNoVehicle) errors.vehicle = true
    // Address is optional for walk-in customers (gazette allows blank for unregistered purchasers)
    // TIN is required only if purchaser is VAT-registered
    if (isLkTax && posDocType === 'tax_invoice' && posCustomerVatReg) {
      if (posCustomerTin.trim().length !== 9) errors.tin = true
      if (!posCustomerAddress.trim()) errors.address = true
    }
    if (errors.name || errors.phone || errors.vehicle || errors.tin || errors.address) {
      setPosErrors(errors)
      if (errors.phone) showToast('⚠️ ' + PHONE_FORMAT_MSG)
      if (errors.tin) showToast('⚠️ 9-digit customer TIN required (VAT-registered purchaser)')
      if (errors.address) showToast('⚠️ Customer address required (VAT-registered purchaser)')
      if (errors.vehicle) showToast(posCustomerIsInsurance ? '⚠️ Vehicle number required for insurance bills — or tick "not available"' : '⚠️ Vehicle number required for this customer')
      setTimeout(() => setPosErrors({}), 4000)
      return
    }
    setPosErrors({})
    // A cheque with no number cannot be chased, matched to the bank, or proved
    // if it bounces — the number is the only handle on it.
    const chequeNoNumber = posPayments.filter(p =>
      p.method === 'cheque' && parseFloat(p.amount) > 0 && !String(p.chequeNumber || '').trim())
    if (chequeNoNumber.length > 0) {
      showToast('⚠️ Enter the cheque number — a cheque without one cannot be traced')
      return
    }
    // Below-cost warning — ONLY for items that have a cost (real or rough).
    // Items without any cost sell silently (owner rule): no errors, no noise.
    const belowCost = posCart.filter(it => Number(it.cost) > 0 && isBelowCost(posMarginBase(it.unitPrice), posCostBasis(it.cost)))
    if (belowCost.length > 0) {
      const lines = belowCost.map(it => `• ${it.productName}: Rs.${Number(it.unitPrice).toLocaleString()} — needs Rs.${posCostFloor(it.cost).toLocaleString()} or more`).join('\n')
      if (!confirm(`⚠️ SELLING BELOW COST:\n\n${lines}\n\nContinue with this sale?`)) return
    }
    setPosPreview(true)
  }

  async function confirmCreateSale() {
    if (posLoading) return
    setPosLoading(true)
    try {
      const action = posDraftId ? 'finalize_draft' : 'create_sale'
      const body = posDraftId
        ? {
            action,
            saleId: posDraftId,
            customerId: posCustomer.id || null,
            useAdvance,
            // productId/Name/Sku let the API insert rows for items added during finalize
            items: posCart.map(i => ({ id: i.saleItemId, unitPrice: cardPrice(i.unitPrice), quantity: i.quantity, productId: i.productId || null, productName: i.productName, productSku: i.productSku || null, ssclStream: i.ssclStream || (i.productId ? 'PART' : 'SVC') })),
            payments: posPayments.filter(p => parseFloat(p.amount) > 0).map(p => ({ method: p.method, amount: parseFloat(p.amount), chequeNumber: p.chequeNumber || null, chequeDate: p.chequeDate || null, bankRef: p.bankRef || null })),
            discount: posDiscountAmt,
            vehicleNo: posVehicleNo || null,
            notes: posNotes || null,
            saleDate: posDate,
            customerName: posCustomer.name,
            customerPhone: posCustomer.phone,
            ...(isLkTax && posEntityId ? {
              invoiceEntityId: posEntityId,
              documentType: posDocType,
              customerAddress: posCustomerAddress.trim() || null,
              customerVatRegistered: posCustomerVatReg,
              customerIsInsurance: posCustomerIsInsurance,
              customerTin: posCustomerVatReg ? posCustomerTin.trim() || null : null,
            } : {}),
          }
        : {
            action,
            customerId: posCustomer.id, customerName: posCustomer.name || 'Walk-in Customer', customerPhone: posCustomer.phone,
            items: posCart.map(i => ({
              productId: i.productId || null,
              productName: i.productName,
              productSku: i.productSku || null,
              quantity: i.quantity,
              unitPrice: i.unitPrice,
              ssclStream: i.ssclStream || (i.productId ? 'PART' : 'SVC'),
            })),
            discount: posDiscountAmt, payments: posPayments.filter(p => parseFloat(p.amount) > 0),
            notes: posNotes || null, useAdvance, saleDate: posDate, vehicleNo: posVehicleNo || null,
            ...(isLkTax && posEntityId ? {
              invoiceEntityId: posEntityId,
              documentType: posDocType,
              customerAddress: posCustomerAddress.trim() || null,
              customerVatRegistered: posCustomerVatReg,
              customerIsInsurance: posCustomerIsInsurance,
              customerTin: posCustomerVatReg ? posCustomerTin.trim() || null : null,
            } : {}),
          }

      const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (j.success) {
        recordQuickPicks(posCart)
        setPosReceipt({ sale: { ...j.sale, totalAmountDue: j.totalAmountDue || 0 }, vendor, advanceUsed: j.advanceUsed || 0, appliedToOutstanding: j.appliedToOutstanding || 0, settledInvoices: j.settledInvoices || [], newAdvance: j.newAdvance || 0 })
        showToast(j.message)
        setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false })
        setPosDiscount(''); setPosPayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
        setPosNotes(''); setPosDate(colomboToday()); setPosVehicleNo(''); setPosNoVehicle(false); setUseAdvance(false)
        setPosDraftId(null); setPosDraftInvoiceNo('')
        setPosCustomerAddress(''); setPosCustomerTin(''); setPosCustomerVatReg(false); setPosCustomerIsInsurance(false)
        setShowManualLine(false); setManualLine({ name: '', qty: '1', price: '' })
        setPosPriceMode('incl')
        setPosPreview(false)
        await onDataChanged()
        fetchAllDrafts()
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setPosLoading(false)
  }

  async function handleCreateDraft() {
    if (posLoading) return
    if (posCart.length === 0) { showToast('Add items to cart'); return }
    if (!posCustomer.name.trim()) { setPosErrors(prev => ({ ...prev, name: true })); return }
    setPosLoading(true)
    try {
      const res = await fetch('/api/vendor/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_draft',
          customerId: posCustomer.id || null,
          customerName: posCustomer.name,
          customerPhone: posCustomer.phone,
          items: posCart.map(i => ({ productId: i.productId, productName: i.productName, productSku: i.productSku, quantity: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost })),
          vehicleNo: posVehicleNo || null,
        })
      })
      const j = await res.json()
      if (j.success) {
        showToast('📦 ' + j.invoiceNo + ' sent on approval')
        setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0 }); setPosVehicleNo(''); setPosNoVehicle(false); setPosPriceMode('incl'); setPosCustomerIsInsurance(false)
        await onDataChanged()
        fetchAllDrafts()
      } else showToast(j.error || 'Error')
    } catch { showToast('Network error') }
    setPosLoading(false)
  }

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Invoice Preview Modal */}
      {posPreview && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
            <div className="bg-slate-800 text-white px-5 py-4 rounded-t-2xl sm:rounded-t-2xl">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-0.5">Invoice Preview</p>
              <p className="font-black text-xl">{vendor?.name}</p>
              <p className="text-sm text-slate-300 mt-1">{new Date(posDate).toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })}</p>
            </div>
            {/* Entity + document-type banner — colour-coded so VAT (Pvt Ltd) and
                no-VAT (Proprietorship) can't be confused at the confirm step */}
            <div className={`px-5 py-3 flex items-center gap-3 text-white ${posIsVatEntity ? 'bg-indigo-600' : 'bg-amber-500'}`}>
              <span className="text-2xl shrink-0">🧾</span>
              <div className="min-w-0">
                <p className="font-black text-sm tracking-wide leading-tight">{posIsVatEntity ? `TAX INVOICE · VAT ${posVatRate}%` : 'SALES RECEIPT · NO VAT'}</p>
                <p className="text-xs opacity-90 truncate">{posCurrentEntity?.name || vendor?.name}</p>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-slate-50 rounded-xl p-3 space-y-0.5">
                <p className="font-black text-slate-800">{posCustomer.name || 'Walk-in Customer'}</p>
                {posCustomer.phone && <p className="text-xs text-slate-500">📞 {posCustomer.phone}</p>}
                {posVehicleNo && <p className="text-xs font-mono font-bold text-slate-700">🚗 {posVehicleNo}</p>}
                {posNotes && <p className="text-xs text-slate-400 italic mt-1">{posNotes}</p>}
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Items</p>
                <div className="space-y-1.5">
                  {posCart.map((item, i) => (
                    <div key={i} className="flex justify-between items-start text-sm">
                      <div className="flex-1 min-w-0 pr-3">
                        <p className="font-semibold text-slate-800 truncate">{item.productName}</p>
                        <p className="text-xs text-slate-400">{item.productSku} · Rs.{item.unitPrice.toLocaleString()} × {item.quantity}</p>
                      </div>
                      <p className="font-bold text-slate-800 shrink-0">Rs.{(item.unitPrice * item.quantity).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-slate-100 pt-3 space-y-1.5">
                <div className="flex justify-between text-sm text-slate-500"><span>Subtotal</span><span>Rs.{posSubtotal.toLocaleString()}</span></div>
                {posDiscountAmt > 0 && <div className="flex justify-between text-sm text-emerald-600"><span>Discount</span><span>−Rs.{posDiscountAmt.toLocaleString()}</span></div>}
                {posIsVatEntity ? (<>
                  <div className="flex justify-between text-sm text-slate-500"><span>NET (excl. VAT)</span><span>Rs.{posNetAmount.toLocaleString()}</span></div>
                  <div className="flex justify-between items-center bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 my-1"><span className="text-sm font-bold text-indigo-700">VAT @ {posVatRate}%</span><span className="text-lg font-black text-indigo-700">Rs.{posVatAmount.toLocaleString()}</span></div>
                  <div className="flex justify-between font-black text-base text-slate-800 pt-1 border-t border-slate-200"><span>TOTAL (incl. VAT)</span><span>Rs.{posTotal.toLocaleString()}</span></div>
                </>) : (<>
                  <div className="flex justify-between font-black text-base text-slate-800 pt-1 border-t border-slate-200"><span>Total</span><span>Rs.{posTotal.toLocaleString()}</span></div>
                  <p className="text-[11px] font-bold text-amber-600">No VAT charged (Proprietorship)</p>
                </>)}
              </div>
              {posPayments.filter(p => parseFloat(p.amount) > 0).length > 0 && (
                <div className="bg-emerald-50 rounded-xl p-3 space-y-1">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-wider mb-1.5">Payment</p>
                  {posPayments.filter(p => parseFloat(p.amount) > 0).map((p, i) => (
                    <div key={i} className="flex justify-between text-sm text-emerald-800">
                      <span>{PAY_LABELS[p.method] || p.method}{p.chequeNumber ? ` #${p.chequeNumber}` : ''}{p.bankRef ? ` ref:${p.bankRef}` : ''}</span>
                      <span className="font-bold">Rs.{parseFloat(p.amount).toLocaleString()}</span>
                    </div>
                  ))}
                  {useAdvance && posAdvanceApplied > 0 && <div className="flex justify-between text-sm text-cyan-700"><span>Advance Applied</span><span className="font-bold">Rs.{posAdvanceApplied.toLocaleString()}</span></div>}
                </div>
              )}
              {posBalance > 0 && <div className="flex justify-between font-black text-red-600 bg-red-50 rounded-xl px-3 py-2"><span>Balance Due (Credit)</span><span>Rs.{posBalance.toLocaleString()}</span></div>}
              {posOverpayment > 0 && <div className="flex justify-between font-bold text-cyan-700 bg-cyan-50 rounded-xl px-3 py-2"><span>{posCustomer.outstanding > 0 ? 'Excess → applied to outstanding' : 'Excess → advance'}</span><span>Rs.{posOverpayment.toLocaleString()}</span></div>}
            </div>
            <div className="flex gap-3 px-5 pb-6">
              <button onClick={() => setPosPreview(false)} className="flex-1 border-2 border-slate-300 text-slate-700 font-bold py-3.5 rounded-xl hover:bg-slate-50 text-sm">← Back to Edit</button>
              <button onClick={confirmCreateSale} disabled={posLoading} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black py-3.5 rounded-xl text-sm disabled:opacity-50">
                {posLoading ? 'Creating…' : '✅ Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {posReceipt ? (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-black">Invoice Created!</h1>
            <button onClick={() => setPosReceipt(null)} className="text-sm text-slate-500 px-3 py-1.5 rounded-lg border border-slate-200">+ New Sale</button>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
            <div className="text-center mb-4">
              <p className="text-4xl mb-2">✅</p>
              <p className="text-2xl font-black">{posReceipt.sale.invoice_no}</p>
              <p className="text-sm text-slate-500">{posReceipt.sale.customer_name}</p>
              <p className="text-3xl font-black text-orange-600 mt-2">Rs.{parseFloat(posReceipt.sale.total).toLocaleString()}</p>
              {parseFloat(posReceipt.sale.balance_due) > 0 && <p className="text-lg font-bold text-red-600 mt-1">Balance Due: Rs.{parseFloat(posReceipt.sale.balance_due).toLocaleString()}</p>}
              {posReceipt.advanceUsed > 0 && <p className="text-sm font-bold text-cyan-600 mt-1">Rs.{posReceipt.advanceUsed.toLocaleString()} used from advance</p>}
              {posReceipt.appliedToOutstanding > 0 && <p className="text-sm font-bold text-amber-600 mt-1">Rs.{posReceipt.appliedToOutstanding.toLocaleString()} applied to old invoices{posReceipt.settledInvoices?.length > 0 ? ` (cleared: ${posReceipt.settledInvoices.join(', ')})` : ''}</p>}
              {posReceipt.newAdvance > 0 && <p className="text-sm font-bold text-emerald-600 mt-1">Rs.{posReceipt.newAdvance.toLocaleString()} added to advance</p>}
            </div>
            <div className="flex gap-2 flex-wrap justify-center">
              {posReceipt.sale.document_type !== 'tax_invoice' && <button onClick={() => printInvoice(posReceipt.sale, posReceipt.vendor, 'thermal', vendorSettings)} className="bg-slate-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl">🖨️ Thermal</button>}
              <button onClick={() => printInvoice(posReceipt.sale, posReceipt.vendor, 'a4', vendorSettings)} className="bg-blue-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">📄 A4</button>
              {posReceipt.sale.customer_phone && <button onClick={() => sendWhatsAppBill(posReceipt.sale, posReceipt.vendor, posReceipt.sale.customer_phone)} className="bg-green-500 text-white text-sm font-bold px-5 py-2.5 rounded-xl">💬 WhatsApp</button>}
              {vendor?.whatsapp && <button onClick={sendEODReport} className="bg-purple-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">📊 End of Day → Manager</button>}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-black text-slate-900">🧾 POS</h1>
            {vendor?.whatsapp && (
              <button onClick={sendEODReport} className="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100">
                📊 End of Day → Manager
              </button>
            )}
          </div>

          {/* Draft mode banner */}
          {posDraftId && (
            <div className="mb-4 bg-amber-50 border-2 border-amber-400 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black text-amber-600 uppercase tracking-widest mb-0.5">Finalising On-Approval Draft</p>
                <p className="font-black text-amber-900 text-base">{posCustomer.name}{posDraftInvoiceNo ? ' · ' + posDraftInvoiceNo : ''}</p>
                <p className="text-xs text-amber-600 mt-0.5">Edit prices, add vehicle number &amp; payment — then Complete Invoice</p>
              </div>
              <button onClick={() => { setPosDraftId(null); setPosDraftInvoiceNo(''); setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false }); setPosVehicleNo(''); setPosNoVehicle(false); setPosPriceMode('incl'); setPosCustomerIsInsurance(false) }} className="shrink-0 text-amber-400 hover:text-red-500 text-2xl font-bold leading-none">✕</button>
            </div>
          )}

          {/* lk_tax: Entity selector + document type toggle */}
          {isLkTax && posInvoiceEntities.length > 0 && (
            <div className="mb-3 bg-white rounded-xl border border-slate-200 p-3 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
              <div className="flex-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Invoicing Entity</p>
                <div className="flex gap-1.5 flex-wrap">
                  {posInvoiceEntities.map((e: any) => (
                    <button key={e.id}
                      onClick={() => { setPosEntityId(e.id) }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${posEntityId === e.id ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                      {e.is_default ? '★ ' : ''}{e.name.replace('MacForce Auto Engineering', 'MacForce')}{e.serial_qqqq === 'REPR' ? ' · Workshop' : e.serial_qqqq === 'PART' ? ' · Parts' : ''}
                    </button>
                  ))}
                </div>
              </div>
              {posCurrentEntity?.invoice_mode === 'lk_tax' && (
                <div className="shrink-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Document</p>
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 border-2 border-orange-200">
                    <span className="text-orange-600 text-sm">📋</span>
                    <span className="text-xs font-black text-orange-700 tracking-wide">TAX INVOICE</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-6 pb-36 lg:pb-0">
            <div className="lg:col-span-2 space-y-3 lg:space-y-4 order-last lg:order-none">
              {/* Product Search */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                {quickPicks.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">⚡ Quick Picks</p>
                    <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
                      {quickPicks.map((p: any) => (
                        <button key={p.id} onClick={() => addToCart(p)} className="shrink-0 max-w-[150px] px-3 py-2 rounded-xl border-2 border-slate-200 bg-white active:border-orange-400 active:bg-orange-50 hover:border-orange-300 text-left min-h-[44px]">
                          <p className="text-xs font-bold text-slate-800 truncate">{p.product_type === 'tyre' && p.tyre_width ? `${p.tyre_width}/${p.tyre_profile}R${p.tyre_rim} ` : ''}{p.name}</p>
                          <p className="text-[10px] text-slate-400">Rs.{(p.price || 0).toLocaleString()} · {p.quantity} left</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <label className="block text-xs font-bold text-slate-500 mb-2">Search Products</label>
                <input value={posSearch} onChange={e => setPosSearch(e.target.value)} className="w-full px-4 py-3.5 rounded-xl border-2 border-slate-200 text-base sm:text-sm outline-none focus:border-orange-400" placeholder="Part name, SKU, make — or tyre size e.g. 185/65R15" />
                {posFilteredProducts.length > 0 && (
                  <div className="mt-2 max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
                    {posFilteredProducts.slice(0, 12).map((p: any) => (
                      <button key={p.id} onClick={() => addToCart(p)} className="w-full text-left px-3 py-2.5 hover:bg-orange-50 active:bg-orange-100 border-b border-slate-100 last:border-0 flex items-center justify-between text-sm gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-[10px] text-slate-400">{p.sku}</span>
                            {p.product_type === 'tyre' && p.tyre_width && (
                              <span className="text-[10px] font-black text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded-full shrink-0">
                                {p.tyre_width}/{p.tyre_profile}R{p.tyre_rim}
                              </span>
                            )}
                            <span className="font-semibold truncate">{p.name}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            {p.make && <span className="text-[10px] text-slate-400">{p.make}</span>}
                            {p.origin_country && <span className="text-[10px] font-semibold text-slate-500">🌐 {p.origin_country}</span>}
                            <span className="text-[10px] text-slate-400">Qty: {p.quantity}</span>
                            <span className="text-[10px] font-semibold capitalize text-slate-400">{p.condition}</span>
                          </div>
                        </div>
                        <span className="font-bold text-orange-600 shrink-0">Rs.{p.price?.toLocaleString() || '–'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Card pricing is the one thing on this screen the customer will
          question, so say it plainly rather than letting the numbers change
          silently under the operator. */}
      {posCardPricing && posCart.length > 0 && (
        <div className="bg-purple-50 border-2 border-purple-300 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-3 flex-wrap">
          <span className="text-lg leading-none">💳</span>
          <span className="text-sm font-black text-purple-900">
            Card prices — every line +{cardFeePct}%
          </span>
          <span className="text-xs text-purple-700">
            Charge <strong>Rs.{posTotal.toLocaleString()}</strong> on the machine. Switch the payment to Cash and the prices drop back.
          </span>
        </div>
      )}

      {/* Cart */}
              {posCart.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center"><p className="text-3xl opacity-30">🛒</p><p className="text-slate-400 font-semibold">Add products above</p></div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-slate-100 flex-wrap">
                    <span className="text-xs font-bold text-slate-500">{posCart.length} item{posCart.length !== 1 ? 's' : ''} in cart</span>
                    <div className="flex items-center gap-2">
                      {posIsVatEntity && (
                        <div className="flex rounded-lg border border-slate-200 overflow-hidden" title="Insurance quotes are ex-VAT — switch to enter approved amounts and VAT is added on the bill">
                          <button onClick={() => setPosPriceMode('incl')} className={`px-2 py-1 text-[10px] font-bold transition-colors ${posPriceMode === 'incl' ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Incl. VAT</button>
                          <button onClick={() => setPosPriceMode('excl')} className={`px-2 py-1 text-[10px] font-bold border-l border-slate-200 transition-colors ${posPriceMode === 'excl' ? 'bg-amber-500 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>Excl. VAT +{posVatRate}%</button>
                        </div>
                      )}
                      <button onClick={clearPos} className="text-xs font-bold text-red-500 hover:text-red-700 active:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50">🗑 Clear / New Sale</button>
                    </div>
                  </div>
                  {posEntryExcl && (
                    <div className="px-3 sm:px-4 py-1.5 bg-amber-50 border-b border-amber-200 text-[11px] font-bold text-amber-800">
                      ⚠ Ex-VAT entry (insurance): type the approved amount WITHOUT VAT — {posVatRate}% is added to the bill automatically.
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50">
                      <th className="px-2 sm:px-4 py-2 text-left text-xs font-bold text-slate-500">Item</th>
                      <th className="px-2 sm:px-4 py-2 text-xs font-bold text-slate-500 w-28 sm:w-36">Qty</th>
                      <th className={`px-2 sm:px-4 py-2 text-xs font-bold w-20 sm:w-28 ${posEntryExcl ? 'text-amber-600' : 'text-slate-500'}`}>{posEntryExcl ? 'Price (excl. VAT)' : 'Price'}</th>
                      <th className="px-2 sm:px-4 py-2 text-right text-xs font-bold text-slate-500 w-20 sm:w-24">Total</th>
                      <th className="w-8"></th>
                    </tr></thead>
                    <tbody>
                      {posCart.map((item, i) => (
                        <tr key={i} className="border-t border-slate-100">
                          <td className="px-2 sm:px-4 py-2">
                            <span className="hidden sm:inline font-mono text-xs text-slate-400 mr-1">{item.productSku}</span>
                            <span className="font-semibold text-xs sm:text-sm">{item.productName}</span>
                            {item.ssclStream === 'SVC' && <span className="ml-1 text-[9px] font-black bg-blue-100 text-blue-700 px-1 rounded">SVC</span>}
                          </td>
                          <td className="px-2 sm:px-4 py-2">
                            <div className="flex items-center gap-1">
                              <button onClick={() => updateCartQty(i, item.quantity - 1)} className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-lg bg-slate-100 text-slate-700 font-bold text-xl flex items-center justify-center active:bg-slate-200 select-none">−</button>
                              <input type="number" min="1" max={item.maxStock} value={item.quantity} onChange={e => updateCartQty(i, parseInt(e.target.value) || 1)} className="w-10 sm:w-12 px-1 py-1 border border-slate-200 rounded text-center text-sm h-9 sm:h-11" />
                              <button onClick={() => updateCartQty(i, item.quantity + 1)} className="w-9 h-9 sm:w-11 sm:h-11 shrink-0 rounded-lg bg-slate-100 text-slate-700 font-bold text-xl flex items-center justify-center active:bg-slate-200 select-none">+</button>
                            </div>
                          </td>
                          <td className="px-2 sm:px-4 py-2">
                            <input type="text" inputMode="numeric" value={(posEntryExcl ? netOfVat(cardPrice(item.unitPrice), posVatRate) : cardPrice(item.unitPrice)) || ''} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); const n = v ? parseInt(v) : 0; updateCartPrice(i, posEntryExcl ? grossOfNet(n) : n) }} onFocus={e => { if (e.target.value === '0') e.target.value = '' }} className={'w-20 sm:w-24 px-1 sm:px-2 py-1 border rounded text-sm ' + (isBelowCost(posMarginBase(item.unitPrice), posCostBasis(item.cost))  /* base price: the 3.5% is the bank's, not margin */ ? 'border-red-400 bg-red-50' : posEntryExcl ? 'border-amber-400 bg-amber-50' : 'border-slate-200')} />
                            {posEntryExcl && Number(item.unitPrice) > 0 && <p className="text-[9px] font-bold text-amber-700 mt-0.5 leading-none">= Rs.{Number(item.unitPrice).toLocaleString()} with VAT</p>}
                            {Number(item.cost) > 0 && (isBelowCost(posMarginBase(item.unitPrice), item.cost)
                              ? <p className="text-[9px] font-bold text-red-600 mt-0.5 leading-none">⚠ below cost — ask Rs.{posCostFloor(item.cost).toLocaleString()} or more{posIsVatEntity ? ` (cost Rs.${Number(item.cost).toLocaleString()} excl VAT)` : ''}</p>
                              : Number(item.unitPrice) > 0
                                ? <p className="text-[9px] text-slate-400 mt-0.5 leading-none">GP {gpPercent(posMarginBase(item.unitPrice), posCostBasis(item.cost))}%{posIsVatEntity ? ' net' : ''}</p>
                                : <p className="text-[9px] text-slate-400 mt-0.5 leading-none">min Rs.{posCostFloor(item.cost).toLocaleString()}</p>)}
                          </td>
                          <td className="px-2 sm:px-4 py-2 text-right font-bold text-xs sm:text-sm">Rs.{(item.quantity * item.unitPrice).toLocaleString()}</td>
                          <td className="px-1 sm:px-2"><button onClick={() => removeFromCart(i)} className="text-red-400 hover:text-red-600">✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* lk_tax: Manual / service line entry (SVC stream) */}
              {isLkTax && (
                <div className="mt-2">
                  {!showManualLine ? (
                    <button onClick={() => setShowManualLine(true)} className="text-xs font-bold text-blue-600 hover:text-blue-800 px-3 py-1.5 rounded-lg border border-blue-200 hover:border-blue-400 bg-blue-50">
                      + Add Service / Labour Line
                    </button>
                  ) : (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                      <p className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Service / Labour Line <span className="ml-1 bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded text-[9px]">SVC</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {SERVICE_TYPES.map(sv => (
                          <button
                            key={sv}
                            onClick={() => { setServiceOther(false); setManualLine(p => ({ ...p, name: sv })) }}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border-2 transition ${
                              !serviceOther && manualLine.name === sv
                                ? 'border-blue-500 bg-blue-600 text-white'
                                : 'border-blue-200 bg-white text-blue-700 hover:border-blue-400'
                            }`}
                          >
                            {sv}
                          </button>
                        ))}
                        <button
                          onClick={() => { setServiceOther(true); setManualLine(p => ({ ...p, name: '' })) }}
                          className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border-2 transition ${
                            serviceOther ? 'border-blue-500 bg-blue-600 text-white' : 'border-blue-200 bg-white text-blue-700 hover:border-blue-400'
                          }`}
                        >
                          ✏️ Other
                        </button>
                      </div>
                      {(serviceOther || (manualLine.name && !SERVICE_TYPES.includes(manualLine.name))) && (
                        <input autoFocus value={manualLine.name} onChange={e => setManualLine(p => ({ ...p, name: e.target.value }))} placeholder="Type the service — appears on the invoice exactly as written" className="w-full px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none focus:border-blue-400" />
                      )}
                      <div className="flex gap-2">
                        <input type="text" inputMode="numeric" value={manualLine.qty} onChange={e => setManualLine(p => ({ ...p, qty: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="Qty" className="w-20 px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none text-center" />
                        <input type="text" inputMode="numeric" value={manualLine.price} onChange={e => setManualLine(p => ({ ...p, price: e.target.value.replace(/[^0-9]/g, '') }))} placeholder={posEntryExcl ? `Price excl. VAT (+${posVatRate}% added)` : 'Price (Rs.)'} className={`flex-1 px-3 py-2 rounded-lg border-2 text-sm outline-none ${posEntryExcl ? 'border-amber-300 bg-amber-50' : 'border-blue-200'}`} />
                        <button onClick={addManualLine} className="bg-blue-600 text-white font-bold px-3 py-2 rounded-lg text-sm">Add</button>
                        <button onClick={() => { setShowManualLine(false); setServiceOther(false); setManualLine({ name: '', qty: '1', price: '' }) }} className="text-slate-400 hover:text-red-500 font-bold px-2">✕</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              <div className="bg-white rounded-xl border border-red-200 mt-3">
                <textarea value={posNotes} onChange={e => setPosNotes(e.target.value)} placeholder="Notes (printed on invoice)..." rows={2} className="w-full px-4 py-3 text-sm outline-none resize-none rounded-xl" />
              </div>

              {/* Total + action buttons — desktop only */}
              <div className="hidden lg:block rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 p-4 text-white">
                {posDiscountAmt > 0 && <div className="flex justify-between text-sm mb-1"><span className="text-red-300">Discount</span><span>-Rs.{posDiscountAmt.toLocaleString()}</span></div>}
                {posIsVatEntity && posTotal > 0 && (
                  <div className="mb-2 pb-2 border-b border-slate-600 space-y-0.5">
                    <div className="flex justify-between text-sm"><span className="text-slate-300">NET (excl. VAT)</span><span>Rs.{posNetAmount.toLocaleString()}</span></div>
                    <div className="flex justify-between text-sm"><span className="text-slate-300">VAT {posVatRate}%</span><span>Rs.{posVatAmount.toLocaleString()}</span></div>
                  </div>
                )}
                <div className="flex justify-between items-baseline font-black"><span className="text-xl">TOTAL</span><span className="text-4xl tracking-tight">Rs.{posTotal.toLocaleString()}</span></div>
                {posAdvanceApplied > 0 && <div className="flex justify-between text-sm mt-1"><span className="text-cyan-300">From Advance</span><span className="text-cyan-300">Rs.{posAdvanceApplied.toLocaleString()}</span></div>}
                {posOverpayment > 0 && posCustomer.outstanding > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-600">
                    <div className="flex justify-between text-sm"><span className="text-amber-300">→ To Outstanding</span><span className="text-amber-300">Rs.{Math.min(posOverpayment, posCustomer.outstanding).toLocaleString()}</span></div>
                    {posOverpayment > posCustomer.outstanding && <div className="flex justify-between text-sm"><span className="text-emerald-300">→ To Advance</span><span className="text-emerald-300">Rs.{(posOverpayment - posCustomer.outstanding).toLocaleString()}</span></div>}
                  </div>
                )}
                {posOverpayment > 0 && posCustomer.outstanding <= 0 && <div className="flex justify-between text-sm font-bold mt-1"><span className="text-emerald-300">→ To Advance</span><span className="text-emerald-300">+Rs.{posOverpayment.toLocaleString()}</span></div>}
                {posBalance > 0 && <div className="flex justify-between text-sm font-bold mt-1"><span className="text-red-300">On Credit</span><span className="text-red-300">Rs.{posBalance.toLocaleString()}</span></div>}
              </div>
              {!posDraftId && (
                <button onClick={handleCreateDraft} disabled={posLoading || posCart.length === 0} className="hidden lg:block w-full bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white font-black text-base py-3.5 rounded-xl disabled:opacity-50">
                  {posLoading ? '…' : '📦 Send on Approval'}
                </button>
              )}
              <button onClick={handleCreateSale} disabled={posLoading || posCart.length === 0} className="hidden lg:block w-full bg-green-500 hover:bg-green-600 text-white font-black text-lg py-4 rounded-xl disabled:opacity-50">
                {posLoading ? 'Saving…' : posDraftId ? '✅ Complete Invoice' : posBalance > 0 ? '💳 Complete (Credit: Rs.' + posBalance.toLocaleString() + ')' : posOverpayment > 0 && posCustomer.outstanding > 0 ? '💰 Complete & Settle Outstanding' : posOverpayment > 0 ? '💰 Complete (+Rs.' + posOverpayment.toLocaleString() + ' advance)' : '💰 Complete Sale'}
              </button>
            </div>

            {/* Right sidebar */}
            <div className="space-y-3 lg:space-y-4 order-first lg:order-none lg:sticky lg:top-4 lg:self-start">
              {/* Customer */}
              <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
                <h3 className="font-bold text-slate-800 text-sm">Customer</h3>
                <div className="relative">
                  <input value={posCustomer.name} onChange={e => { setPosCustomer({ ...posCustomer, id: null, name: e.target.value }); searchCustomers(e.target.value); if (posErrors.name) setPosErrors(prev => ({ ...prev, name: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none transition-all duration-200 ${posErrors.name ? 'border-red-400 bg-red-50 animate-[shake_0.3s_ease-in-out]' : 'border-slate-200 focus:border-orange-400'}`} placeholder="Customer name (type to search)" />
                  {customerSuggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto mt-1">
                      {customerSuggestions.map((c: any) => (
                        <button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm border-b border-slate-100">
                          <span className="font-semibold">{c.name}</span>{c.phone && <span className="text-xs text-slate-400 ml-2">{c.phone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input value={posCustomer.phone} onChange={e => { setPosCustomer({...posCustomer, phone: e.target.value}); if (posErrors.phone) setPosErrors(prev => ({ ...prev, phone: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none transition-all duration-200 ${posErrors.phone ? 'border-red-400 bg-red-50 animate-[shake_0.3s_ease-in-out]' : 'border-slate-200 focus:border-orange-400'}`} placeholder="Phone / WhatsApp" />
                {posCustomer.id && <p className="text-[10px] text-green-600 font-semibold">✓ Existing customer selected</p>}

                {/* lk_tax: address + TIN — always shown (all Pvt Ltd sales are tax invoices) */}
                {isLkTax && posDocType === 'tax_invoice' && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-100 mt-1">
                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Purchaser Details <span className="font-normal text-slate-400 normal-case">(for tax invoice)</span></p>
                    <input value={posCustomerAddress} onChange={e => { setPosCustomerAddress(e.target.value); if (posErrors.address) setPosErrors(prev => ({ ...prev, address: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none ${posErrors.address ? 'border-red-400 bg-red-50' : 'border-slate-200 focus:border-orange-400'}`} placeholder={posCustomerVatReg ? 'Address (required) *' : 'Address (optional for walk-in)'} />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={posCustomerVatReg} onChange={e => { setPosCustomerVatReg(e.target.checked); if (!e.target.checked) setPosCustomerTin('') }} className="w-4 h-4 accent-orange-500" />
                      <span className="text-xs font-bold text-slate-600">VAT-Registered Purchaser</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={posCustomerIsInsurance} onChange={e => { const v = e.target.checked; setPosCustomerIsInsurance(v); if (posIsVatEntity) setPosPriceMode(v ? 'excl' : 'incl') }} className="w-4 h-4 accent-amber-500" />
                      <span className="text-xs font-bold text-slate-600">🏢 Insurance Company <span className="font-normal text-slate-400">(quotes excl. VAT — remembered for next time)</span></span>
                    </label>
                    {posCustomerVatReg && (
                      <input value={posCustomerTin} onChange={e => { setPosCustomerTin(e.target.value.replace(/[^0-9]/g, '').slice(0, 9)); if ((posErrors as any).tin) setPosErrors(prev => ({ ...prev, tin: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none font-mono ${(posErrors as any).tin ? 'border-red-400 bg-red-50' : 'border-slate-200 focus:border-orange-400'}`} placeholder="Purchaser TIN (9 digits) *" />
                    )}
                  </div>
                )}

                {posCustomer.outstanding > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 mt-1">
                    <span className="text-xs font-bold text-red-700">Outstanding: Rs.{posCustomer.outstanding.toLocaleString()}</span>
                    <p className="text-[10px] text-red-500 mt-0.5">Extra payment will auto-settle old invoices</p>
                  </div>
                )}
                {posCustomer.advance > 0 && (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 mt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-emerald-700">Advance: Rs.{posCustomer.advance.toLocaleString()}</span>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input type="checkbox" checked={useAdvance} onChange={e => setUseAdvance(e.target.checked)} className="w-4 h-4 accent-emerald-600" />
                        <span className="text-xs font-bold text-emerald-700">Use</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Vehicle & Date */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <input type="text" value={posVehicleNo} onChange={e => { let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); const m = v.match(/^([A-Z]{2,3})(\d{1,4})$/); if (m) v = m[1] + '-' + m[2]; setPosVehicleNo(v); if (v) setPosNoVehicle(false); if (posErrors.vehicle) setPosErrors(prev => ({...prev, vehicle: false})) }} placeholder={(posCustomer.require_vehicle_no || posCustomerIsInsurance) ? 'ABC-1234 (required)' : 'ABC-1234'} maxLength={8} className={'w-full px-3 py-2 rounded-lg border-2 text-sm outline-none font-mono font-bold tracking-wider transition-all ' + (posErrors.vehicle ? 'border-red-400 bg-red-50 animate-[shake_0.3s_ease-in-out]' : 'border-slate-200 focus:border-orange-400')} />
                  {(posCustomer.require_vehicle_no || posCustomerIsInsurance) && !posNoVehicle && !posVehicleNo.trim() && <span className="absolute right-2 top-2 text-[9px] font-black text-red-500">REQ</span>}
                  {(posCustomer.require_vehicle_no || posCustomerIsInsurance) && !posVehicleNo.trim() && (
                    <label className="flex items-center gap-1.5 cursor-pointer mt-1">
                      <input type="checkbox" checked={posNoVehicle} onChange={e => { setPosNoVehicle(e.target.checked); if (e.target.checked) setPosErrors(prev => ({ ...prev, vehicle: false })) }} className="w-3.5 h-3.5 accent-amber-500" />
                      <span className="text-[10px] font-semibold text-slate-500">Vehicle number not available</span>
                    </label>
                  )}
                </div>
                <input type="date" value={posDate} onChange={e => setPosDate(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
              </div>

              {/* Payments */}
              <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                <h3 className="font-bold text-slate-800 text-xs">Payment</h3>
                <div className="space-y-2">
                  {posPayments.map((line, i) => (
                    <div key={`pos-pay-${i}`} className="flex gap-2 items-start flex-wrap">
                      <select value={line.method} onChange={e => { const u = [...posPayments]; u[i] = { ...u[i], method: e.target.value }; setPosPayments(u) }} className="px-2 py-2 rounded-lg border-2 border-slate-200 text-xs font-bold outline-none flex-shrink-0">
                        {PAY_METHODS.map(m => <option key={m} value={m}>{PAY_LABELS[m]}</option>)}
                      </select>
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={line.amount} onChange={e => { const val = e.target.value.replace(/[^0-9]/g, ''); const u = [...posPayments]; u[i] = { ...u[i], amount: val }; setPosPayments(u) }} className="flex-1 sm:w-28 sm:flex-none min-w-0 px-2 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Amount" />
                      {line.method === 'cheque' && (<>
                        <input type="text" value={line.chequeNumber} onChange={e => { const u = [...posPayments]; u[i] = { ...u[i], chequeNumber: e.target.value }; setPosPayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Cheque # *" />
                        <input type="date" value={line.chequeDate} onChange={e => { const u = [...posPayments]; u[i] = { ...u[i], chequeDate: e.target.value }; setPosPayments(u) }} className="px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" />
                      </>)}
                      {line.method === 'bank' && <input type="text" value={line.bankRef} onChange={e => { const u = [...posPayments]; u[i] = { ...u[i], bankRef: e.target.value }; setPosPayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Ref #" />}
                      {posPayments.length > 1 && <button onClick={() => setPosPayments(posPayments.filter((_, x) => x !== i))} className="text-red-400 hover:text-red-600 text-sm font-bold px-1">✕</button>}
                    </div>
                  ))}
                  <div className="flex gap-3">
                    <button onClick={() => setPosPayments([...posPayments, { method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])} className="text-xs font-bold text-blue-600">+ Add Payment Method</button>
                    {posTotal - posPaidAmount > 0 && <button onClick={() => { const u = [...posPayments]; u[u.length - 1] = { ...u[u.length - 1], amount: String(posTotal - posPaidAmount) }; setPosPayments(u) }} className="text-xs font-bold text-orange-600">Fill remaining (Rs.{(posTotal - posPaidAmount).toLocaleString()})</button>}
                  </div>
                </div>
                <input value={posDiscount} onChange={e => setPosDiscount(e.target.value.replace(/[^0-9]/g, ''))} type="text" inputMode="numeric" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Discount (Rs.)" />
              </div>
            </div>
          </div>

          {/* Mobile bottom bar */}
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex flex-col shadow-[0_-4px_20px_rgba(0,0,0,0.18)]">
            <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-4 py-2.5 text-white flex items-center justify-between">
              <div className="flex items-center gap-3 text-sm">
                {posDiscountAmt > 0 && <span className="text-red-300">-Rs.{posDiscountAmt.toLocaleString()}</span>}
                {posBalance > 0 && <span className="text-red-300">Credit Rs.{posBalance.toLocaleString()}</span>}
                {posAdvanceApplied > 0 && <span className="text-cyan-300">Adv Rs.{posAdvanceApplied.toLocaleString()}</span>}
              </div>
              <span className="text-3xl font-black tracking-tight">Rs.{posTotal.toLocaleString()}</span>
            </div>
            <div className="flex">
              {!posDraftId && (
                <button onClick={handleCreateDraft} disabled={posLoading || posCart.length === 0} className="flex-1 bg-amber-500 active:bg-amber-600 text-white font-black text-sm py-4 disabled:opacity-40">
                  {posLoading ? '…' : '📦 Approval'}
                </button>
              )}
              <button onClick={handleCreateSale} disabled={posLoading || posCart.length === 0} className="flex-[2] bg-green-500 active:bg-green-600 text-white font-black text-sm py-4 disabled:opacity-40">
                {posLoading ? '…' : posDraftId ? '✅ Complete Invoice' : posBalance > 0 ? '💳 Complete (Credit Rs.' + posBalance.toLocaleString() + ')' : '💰 Complete Sale'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
