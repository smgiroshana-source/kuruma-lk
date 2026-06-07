'use client'
import { toWhatsAppNumber } from '@/lib/constants'
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
  const total        = parseFloat(sale.total) || 0
  const vatAmount    = parseInt(sale.vat_amount) || Math.round(total * 18 / 118)
  const netAmount    = parseInt(sale.net_amount) || (total - vatAmount)
  const discount     = parseFloat(sale.discount || 0)
  const serial       = sale.tax_serial || sale.invoice_no || ''
  const invoiceDate  = fmtDate(sale.created_at)
  const supplyDate   = fmtDate(sale.date_supply || sale.created_at)
  const totalWords   = numberToWords(total) + ' Rupees Only'
  const supplierName    = 'MacForce Auto Engineering (Pvt) Ltd'
  const supplierAddress = s.supplier_address || 'No. 351/T, Pannipitiya Road, Thalawathugoda'
  const supplierTin     = s.supplier_tin     || '101969738'
  const purchaserName    = sale.customer_name    || ''
  const purchaserAddress = sale.customer_address || ''
  const purchaserTin     = sale.customer_tin     || ''
  const purchaserPhone   = sale.customer_phone   || ''
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false)
    ? `<img src="${s.logo_url}" style="height:52px;max-width:120px;object-fit:contain;display:block;margin-bottom:4px">`
    : ''
  const lineRows = items.map((i: any, idx: number) => `
    <tr>
      <td class="c-no">${idx + 1}</td>
      <td class="c-desc">${i.product_name}</td>
      <td class="c-qty">${i.quantity}</td>
      <td class="c-price">${parseFloat(i.unit_price).toLocaleString()}</td>
      <td class="c-amt">${parseFloat(i.total).toLocaleString()}</td>
    </tr>`).join('')
  const paymentHtml = (() => {
    const pmts = (sale.payments || []).filter((p: any) => p.payment_method !== 'credit_return')
    if (!pmts.length) return ''
    const lines = pmts.map((p: any) =>
      `<span style="margin-right:16px"><strong>${(p.payment_method || 'cash').toUpperCase()}${p.cheque_number ? ' #' + p.cheque_number : ''}</strong>: Rs.&nbsp;${parseFloat(p.amount).toLocaleString()}</span>`
    ).join('')
    return `<div class="pmt"><div class="pmt-lbl">Payment Method</div><div class="pmt-val">${lines}</div></div>`
  })()
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TAX INVOICE ${serial}</title>
<style>
/* ── Print: zero page margins; body padding handles whitespace ── */
@page{size:A4 portrait;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
/* ── Screen: grey "desk" so the A4 sheet is clearly visible ── */
html{background:#9ca3af;min-height:100%;padding:12mm 0 20mm}
body{
  font-family:Arial,'Helvetica Neue',sans-serif;
  font-size:11px;color:#000;line-height:1.5;
  width:210mm;min-height:277mm;
  margin:0 auto;
  padding:14mm 18mm 16mm;
  background:#fff;
  box-shadow:0 6px 32px rgba(0,0,0,.35);
}
@media print{
  html{background:#fff;padding:0}
  body{width:100%;min-height:0;margin:0;padding:14mm 18mm 16mm;box-shadow:none}
}
/* ── Header ── */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:9px;border-bottom:2px solid #000;margin-bottom:10px}
.hdr-left{flex:1;min-width:0;padding-right:12px}
.hdr-logo{margin-bottom:5px}
.hdr-name{font-size:15px;font-weight:900;line-height:1.2}
.hdr-addr{font-size:9.5px;margin-top:2px;color:#333}
.hdr-tin{font-size:9.5px;font-weight:700;margin-top:3px}
.hdr-right{text-align:right;flex-shrink:0}
.hdr-title{font-size:20px;font-weight:900;letter-spacing:2px;border:2.5px solid #000;padding:4px 12px;display:inline-block;line-height:1.2}
.hdr-serial{font-family:'Courier New',monospace;font-size:10px;font-weight:700;margin-top:6px;word-break:break-all}
/* ── Parties ── */
.parties{display:grid;grid-template-columns:1fr 1fr;border:1px solid #000}
.p-col{padding:7px 10px}
.p-col+.p-col{border-left:1px solid #000}
.p-lbl{font-size:7.5px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:5px;color:#333}
.p-name{font-size:11.5px;font-weight:700}
.p-info{font-size:9.5px;margin-top:2px;color:#222}
.p-tin{font-size:9.5px;font-weight:700;margin-top:3px}
/* ── Dates ── */
.dates{display:grid;grid-template-columns:1fr 1fr;border:1px solid #000;border-top:none;margin-bottom:12px}
.d-col{padding:5px 10px;display:flex;align-items:baseline;gap:6px}
.d-col+.d-col{border-left:1px solid #000}
.d-lbl{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;white-space:nowrap;color:#333}
.d-val{font-size:10.5px;font-weight:700;font-family:'Courier New',monospace}
/* ── Items table ── */
table{width:100%;border-collapse:collapse;margin-bottom:4px}
thead tr th{font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:6px 5px 5px;text-align:left;border-top:1.5px solid #000;border-bottom:1.5px solid #000}
td{font-size:11px;padding:5px 5px;border-bottom:1px solid #ddd;vertical-align:top}
.c-no{width:26px;text-align:center}
.c-qty{width:38px;text-align:center}
.c-price{width:108px;text-align:right;white-space:nowrap}
.c-amt{width:108px;text-align:right;font-weight:700;white-space:nowrap}
tbody tr:last-child td{border-bottom:1.5px solid #000}
/* ── Totals ── */
.tot-outer{display:flex;justify-content:flex-end;margin-bottom:10px}
.tot-inner{width:46%}
.tot-row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px}
.tot-lbl{color:#333}
.tot-val{font-weight:600;font-family:'Courier New',monospace;text-align:right;min-width:80px}
.tot-div{border-top:1px solid #aaa;margin:4px 0}
.tot-grand{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;font-size:13.5px;font-weight:900;border-top:2px double #000;border-bottom:2px double #000;margin-top:4px}
.tot-grand-val{font-family:'Courier New',monospace}
/* ── Amount in words ── */
.words{border:1px solid #000;padding:6px 10px;margin-bottom:8px}
.w-lbl{font-size:7.5px;font-weight:900;text-transform:uppercase;letter-spacing:1.2px;color:#444;margin-bottom:2px}
.w-val{font-size:11px;font-weight:700}
/* ── Payment ── */
.pmt{border:1px solid #ccc;padding:5px 10px;margin-bottom:10px}
.pmt-lbl{font-size:7.5px;font-weight:900;text-transform:uppercase;letter-spacing:1.2px;color:#444;margin-bottom:3px}
.pmt-val{font-size:11px;font-weight:700}
/* ── Signatures ── */
.sigs{display:flex;justify-content:space-between;margin-top:32px;gap:40px}
.sig{flex:1;text-align:center}
.sig-line{border-top:1px solid #000;padding-top:4px;font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#333}
/* ── Footer ── */
.footer{text-align:center;font-size:9px;color:#555;margin-top:12px;padding-top:7px;border-top:1px dashed #999}
</style></head><body>

<div class="hdr">
  <div class="hdr-left">
    ${logoHtml ? `<div class="hdr-logo">${logoHtml}</div>` : ''}
    <div class="hdr-name">${supplierName}</div>
    <div class="hdr-addr">${supplierAddress}</div>
    <div class="hdr-tin">TIN: ${supplierTin}</div>
  </div>
  <div class="hdr-right">
    <div class="hdr-title">TAX INVOICE</div>
    <div class="hdr-serial">${serial}</div>
  </div>
</div>

<div class="parties">
  <div class="p-col">
    <div class="p-lbl">Supplier</div>
    <div class="p-name">${supplierName}</div>
    <div class="p-info">${supplierAddress}</div>
    <div class="p-tin">TIN: ${supplierTin}</div>
  </div>
  <div class="p-col">
    <div class="p-lbl">Bill To (Purchaser)</div>
    <div class="p-name">${purchaserName || '&mdash;'}</div>
    ${purchaserAddress ? `<div class="p-info">${purchaserAddress}</div>` : ''}
    ${purchaserPhone   ? `<div class="p-info">${purchaserPhone}</div>`   : ''}
    ${purchaserTin     ? `<div class="p-tin">TIN: ${purchaserTin}</div>` : ''}
  </div>
</div>

<div class="dates">
  <div class="d-col">
    <span class="d-lbl">Date of Invoice:</span>
    <span class="d-val">${invoiceDate}</span>
  </div>
  <div class="d-col">
    <span class="d-lbl">Date of Supply:</span>
    <span class="d-val">${supplyDate}</span>
  </div>
</div>

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

<div class="tot-outer">
  <div class="tot-inner">
    ${discount > 0 ? `<div class="tot-row"><span class="tot-lbl">Discount</span><span class="tot-val">&#8722;&nbsp;${discount.toLocaleString()}</span></div>` : ''}
    <div class="tot-div"></div>
    <div class="tot-row"><span class="tot-lbl">Net Amount (excl. VAT)</span><span class="tot-val">${netAmount.toLocaleString()}</span></div>
    <div class="tot-row"><span class="tot-lbl">VAT @ 18%</span><span class="tot-val">${vatAmount.toLocaleString()}</span></div>
    <div class="tot-grand">
      <span>TOTAL (Rs.)</span>
      <span class="tot-grand-val">${total.toLocaleString()}</span>
    </div>
  </div>
</div>

<div class="words">
  <div class="w-lbl">Amount in Words</div>
  <div class="w-val">${totalWords}</div>
</div>

${paymentHtml}

<div class="sigs">
  <div class="sig"><div class="sig-line">Received By</div></div>
  <div class="sig"><div class="sig-line">Authorised Signatory</div></div>
</div>

<div class="footer">${s.invoice_footer || 'Thank you for your business!'}</div>

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
  const shopName = s.invoice_title || vendor?.name || 'kuruma.lk'
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false && !isThermal) ? `<img src="${s.logo_url}" style="height:60px;max-width:120px;object-fit:contain;margin-bottom:4px" />` : ''
  const thermalLogoHtml = (s.logo_url && s.invoice_show_logo !== false && isThermal) ? `<img src="${s.logo_url}" style="height:30px;max-width:60px;object-fit:contain;margin-bottom:2px" />` : ''
  const footerText = s.invoice_footer || 'Thank you for your business!'
  const termsHtml = (!isThermal && s.invoice_terms) ? `<div style="margin-top:12px;padding:10px;border:2px solid #000;border-radius:6px;font-size:13px;color:#000;font-weight:600;line-height:1.5"><strong>Terms & Conditions:</strong><br/>${s.invoice_terms.replace(/\n/g, '<br/>')}</div>` : ''
  const paymentLines = payments.map((p: any) => `<div style="display:flex;justify-content:space-between;font-size:${isThermal ? '10px' : '13px'};font-weight:${isThermal ? '700' : '600'};color:#000;padding:3px 0"><span>${(p.payment_method || 'cash').toUpperCase()}${p.cheque_number ? ' #' + p.cheque_number : ''}</span><span>Rs.${parseFloat(p.amount).toLocaleString()}</span></div>`).join('')
  const a4Style = `@page{size:A4;margin:15mm 18mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:13px;color:#222;font-weight:400;max-width:720px;margin:0 auto;padding:25px 30px}@media print{body{padding:0;max-width:100%}}.header{text-align:center;padding:20px 0 15px;margin-bottom:0}.shop-name{font-size:24px;font-weight:700;color:#000;letter-spacing:-0.5px}.header-sub{font-size:11px;color:#444;margin-top:2px;line-height:1.6}.invoice-title{display:flex;justify-content:space-between;align-items:center;padding:10px 0;margin-top:15px;border-top:2px solid #000;border-bottom:1px solid #aaa}.invoice-title h2{font-size:18px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:2px}.invoice-no{font-size:18px;font-weight:700;color:#000;font-family:'Courier New',monospace}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:12px 0}.info-cell{padding:8px 0;font-size:12px;border-bottom:1px solid #ccc}.info-cell:nth-child(even){text-align:right}.info-label{color:#555;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}.info-value{font-weight:600;color:#000;font-size:13px}table{width:100%;border-collapse:collapse;margin:15px 0}thead{background:#eee}th{text-align:left;font-size:10px;font-weight:700;padding:8px 10px;color:#222;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #aaa}td{padding:10px;font-size:13px;font-weight:500;color:#111;border-bottom:1px solid #ddd}.text-right{text-align:right}.totals{margin-top:10px;border-top:1px solid #aaa;padding-top:5px}.total-row{display:flex;justify-content:space-between;padding:4px 10px;font-size:13px;font-weight:600;color:#222}.grand-total{display:flex;justify-content:space-between;font-weight:800;font-size:20px;color:#000;padding:12px 10px;margin-top:5px;background:#eee;border-radius:4px}.balance-due{font-weight:700;font-size:16px;text-align:right;margin-top:15px;padding:12px 15px;border:2px solid #000;color:#000;border-radius:4px}.payments-section{margin-top:10px;padding:8px 10px;background:#f0f0f0;border-radius:4px}.payments-label{font-size:9px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}.note-section{margin-top:10px;padding:8px 12px;font-size:12px;font-style:italic;color:#333;border-left:3px solid #999}.footer{text-align:center;padding:25px 0 10px;font-size:10px;color:#888;margin-top:30px;border-top:1px solid #ccc}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{background:#eee !important}.grand-total{background:#eee !important}}`
  const thermalStyle = `@page{size:80mm auto;margin:2mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;color:#000;width:300px;max-width:100%;margin:0 auto}.header{text-align:center;padding:5px 0;border-bottom:1px dashed #000}.shop-name{font-size:16px;font-weight:900}table{width:100%;border-collapse:collapse;margin:5px 0}th{text-align:left;font-size:10px;font-weight:900;padding:3px 2px;border-bottom:1px dashed #000}td{padding:3px 2px;font-size:11px;border-bottom:1px solid #ddd}.text-right{text-align:right}.totals{border-top:1px dashed #000;padding-top:5px}.total-row{display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:700}.grand-total{font-weight:900;font-size:16px;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:5px 0;margin-top:5px}.footer{text-align:center;padding:8px 0 5px;font-size:10px;border-top:1px dashed #000;margin-top:5px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${sale.invoice_no}</title>
<style>${isThermal ? thermalStyle : a4Style}</style></head><body>
<div class="header">${isThermal ? thermalLogoHtml : logoHtml}<div class="shop-name">${shopName}</div><div class="header-sub">${[vendor?.location, vendor?.address].filter(Boolean).join(', ')}${vendor?.phone ? `<br/>Tel: ${vendor.phone}${vendor?.whatsapp && vendor.whatsapp !== vendor.phone ? ' | WhatsApp: ' + vendor.whatsapp : ''}` : ''}${s.tax_id ? `<br/>Tax/VAT: ${s.tax_id}` : ''}${s.email ? `<br/>${s.email}` : ''}</div></div>
${isThermal ? `<div style="padding:5px 0;font-size:11px"><div><strong>${sale.payment_status === 'draft' ? 'On Approval: ' : 'Invoice: '}</strong><strong style="font-size:12px">${sale.invoice_no}</strong></div><div><strong>Date: </strong><strong>${formatDate(sale.created_at)}</strong></div><div><strong>Customer: </strong><strong>${sale.customer_name}${sale.customer_phone ? ' (' + sale.customer_phone + ')' : ''}</strong></div>${sale.vehicle_no ? `<div><strong>Vehicle: </strong><strong style="font-size:12px;letter-spacing:2px">${sale.vehicle_no}</strong></div>` : ''}</div>` : `<div class="invoice-title"><h2>${sale.payment_status === 'draft' ? 'On Approval' : 'Invoice'}</h2><span class="invoice-no">${sale.invoice_no}</span></div><div class="info-grid"><div class="info-cell"><span class="info-label">Date</span><span class="info-value">${formatDate(sale.created_at)}</span></div><div class="info-cell"><span class="info-label">Vehicle No</span><span class="info-value" style="font-size:14px;letter-spacing:2px;font-family:'Courier New',monospace">${sale.vehicle_no || '—'}</span></div><div class="info-cell"><span class="info-label">Customer</span><span class="info-value">${sale.customer_name}${sale.customer_phone ? ' (' + sale.customer_phone + ')' : ''}</span></div><div class="info-cell"><span class="info-label">Payment Status</span><span class="info-value">${sale.payment_status === 'draft' ? 'PENDING' : sale.payment_status === 'paid' ? 'PAID' : sale.payment_status === 'voided' ? 'VOID' : parseFloat(sale.balance_due) > 0 ? 'CREDIT' : 'PAID'}</span></div></div>`}
<table><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead><tbody>${items.map((i: any) => `<tr><td>${i.product_sku ? i.product_sku + ' - ' : ''}${i.product_name}</td><td class="text-right">${i.quantity}</td><td class="text-right">Rs.${parseFloat(i.unit_price).toLocaleString()}</td><td class="text-right">Rs.${parseFloat(i.total).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<div class="totals">${parseFloat(sale.discount) > 0 ? `<div class="total-row"><span>Subtotal</span><span>Rs.${parseFloat(sale.subtotal).toLocaleString()}</span></div><div class="total-row" style="color:#000"><span>Discount</span><span>-Rs.${parseFloat(sale.discount).toLocaleString()}</span></div>` : ''}<div class="total-row grand-total"><span>TOTAL</span><span>Rs.${parseFloat(sale.total).toLocaleString()}</span></div></div>
${paymentLines ? (isThermal ? `<div style="margin-top:6px"><div style="font-size:10px;font-weight:600;margin-bottom:3px">Payments</div>${paymentLines}</div>` : `<div class="payments-section"><div class="payments-label">Payments</div>${paymentLines}</div>`) : ''}
${cleanPrintNotes(sale.notes) ? (isThermal ? `<div style="margin-top:5px;padding:4px;font-size:10px;font-style:italic">Note: ${cleanPrintNotes(sale.notes)}</div>` : `<div class="note-section">Note: ${cleanPrintNotes(sale.notes)}</div>`) : ''}
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
}

export default function TabPOSLkTax({ vendor, products, vendorSettings, showToast, onDataChanged, pendingDraft, onDraftLoaded }: TabPOSLkTaxProps) {
  const isLkTax = vendorSettings?.invoice_mode === 'lk_tax'

  // ── POS state ──────────────────────────────────────────────────────────
  const [posCart, setPosCart] = useState<any[]>([])
  const [posSearch, setPosSearch] = useState('')
  const [posCustomer, setPosCustomer] = useState<any>({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false })
  const [customerSuggestions, setCustomerSuggestions] = useState<any[]>([])
  const [posDiscount, setPosDiscount] = useState('')
  const [posPayments, setPosPayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [posNotes, setPosNotes] = useState('')
  const [posDate, setPosDate] = useState(new Date().toISOString().split('T')[0])
  const [posVehicleNo, setPosVehicleNo] = useState('')
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
  const [posDocType, setPosDocType] = useState<'receipt' | 'tax_invoice'>('receipt')
  const [posCustomerAddress, setPosCustomerAddress] = useState('')
  const [posCustomerTin, setPosCustomerTin] = useState('')
  const [posCustomerVatReg, setPosCustomerVatReg] = useState(false)
  const [showManualLine, setShowManualLine] = useState(false)
  const [manualLine, setManualLine] = useState({ name: '', qty: '1', price: '' })

  // ── lk_tax computed values ─────────────────────────────────────────────
  const posCurrentEntity = posInvoiceEntities.find((e: any) => e.id === posEntityId) || null
  const posIsVatEntity = posCurrentEntity?.invoice_mode === 'lk_tax'

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
    setPosDate(new Date().toISOString().split('T')[0])
    onDraftLoaded?.()
  }, [pendingDraft])

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
    const today = new Date().toISOString().slice(0, 10)
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
      return [...prev, { productId: product.id, productName: product.name, productSku: product.sku, unitPrice: product.price || 0, quantity: 1, maxStock: product.quantity }]
    })
    setPosSearch('')
  }
  function updateCartQty(i: number, q: number) { setPosCart(p => p.map((item, x) => x === i ? { ...item, quantity: Math.max(1, Math.min(q, item.maxStock)) } : item)) }
  function updateCartPrice(i: number, price: number) { setPosCart(p => p.map((item, x) => x === i ? { ...item, unitPrice: price } : item)) }
  function removeFromCart(i: number) { setPosCart(p => p.filter((_, x) => x !== i)) }

  function addManualLine() {
    const name = manualLine.name.trim()
    const qty = Math.max(1, parseInt(manualLine.qty) || 1)
    const price = parseInt(manualLine.price) || 0
    if (!name) return
    setPosCart(prev => [...prev, {
      productId: null, productName: name, productSku: '', unitPrice: price,
      quantity: qty, maxStock: null, ssclStream: 'SVC',
    }])
    setManualLine({ name: '', qty: '1', price: '' })
    setShowManualLine(false)
  }

  // ── Payment lines ──────────────────────────────────────────────────────
  function addPaymentLine() { setPosPayments(p => [...p, { method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]) }
  function updatePaymentLine(i: number, field: string, value: string) { setPosPayments(p => p.map((line, x) => x === i ? { ...line, [field]: value } : line)) }
  function removePaymentLine(i: number) { setPosPayments(p => p.filter((_, x) => x !== i)) }

  // ── Computed totals ────────────────────────────────────────────────────
  const { posSubtotal, posDiscountAmt, posTotal, posPaidAmount, posAdvanceApplied, posTotalPaid, posBalance, posOverpayment } = useMemo(() => {
    const posSubtotal = posCart.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    const posDiscountAmt = parseFloat(posDiscount) || 0
    const posTotal = Math.max(0, posSubtotal - posDiscountAmt)
    const posPaidAmount = posPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
    const posAdvanceApplied = useAdvance && posCustomer.advance > 0 ? Math.min(posCustomer.advance, Math.max(0, posTotal - posPaidAmount)) : 0
    const posTotalPaid = posPaidAmount + posAdvanceApplied
    const posBalance = Math.max(0, posTotal - posTotalPaid)
    const posOverpayment = Math.max(0, posTotalPaid - posTotal)
    return { posSubtotal, posDiscountAmt, posTotal, posPaidAmount, posAdvanceApplied, posTotalPaid, posBalance, posOverpayment }
  }, [posCart, posDiscount, posPayments, useAdvance, posCustomer])

  const posVatAmount = posIsVatEntity ? Math.round(posTotal * 18 / 118) : 0
  const posNetAmount = posIsVatEntity ? posTotal - posVatAmount : posTotal

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

  // ── Create sale ────────────────────────────────────────────────────────
  function handleCreateSale() {
    if (posCart.length === 0) { showToast('Add items to cart'); return }
    const errors: { name?: boolean; phone?: boolean; vehicle?: boolean; address?: boolean; tin?: boolean } = {}
    if (!posCustomer.name.trim()) errors.name = true
    if (!posCustomer.phone.trim()) errors.phone = true
    if (posCustomer.require_vehicle_no && !posVehicleNo.trim()) errors.vehicle = true
    if (isLkTax && posDocType === 'tax_invoice' && !posCustomerAddress.trim()) errors.address = true
    if (isLkTax && posDocType === 'tax_invoice' && posCustomerVatReg && !posCustomerTin.trim()) errors.tin = true
    if (errors.name || errors.phone || errors.vehicle || errors.address || errors.tin) {
      setPosErrors(errors)
      if (errors.address) showToast('⚠️ Customer address required for tax invoice')
      if (errors.tin) showToast('⚠️ Customer TIN required (VAT-registered purchaser)')
      if (errors.vehicle) showToast('⚠️ Vehicle number required for this customer')
      setTimeout(() => setPosErrors({}), 4000)
      return
    }
    setPosErrors({})
    setPosPreview(true)
  }

  async function confirmCreateSale() {
    setPosLoading(true)
    try {
      const action = posDraftId ? 'finalize_draft' : 'create_sale'
      const body = posDraftId
        ? {
            action,
            saleId: posDraftId,
            customerId: posCustomer.id || null,
            useAdvance,
            items: posCart.map(i => ({ id: i.saleItemId, unitPrice: i.unitPrice, quantity: i.quantity })),
            payments: posPayments.filter(p => parseFloat(p.amount) > 0).map(p => ({ method: p.method, amount: parseFloat(p.amount), chequeNumber: p.chequeNumber || null, chequeDate: p.chequeDate || null, bankRef: p.bankRef || null })),
            discount: posDiscountAmt,
            vehicleNo: posVehicleNo || null,
            notes: posNotes || null,
            saleDate: posDate,
            customerName: posCustomer.name,
            customerPhone: posCustomer.phone,
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
              customerTin: posCustomerVatReg ? posCustomerTin.trim() || null : null,
            } : {}),
          }

      const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (j.success) {
        setPosReceipt({ sale: { ...j.sale, totalAmountDue: j.totalAmountDue || 0 }, vendor, advanceUsed: j.advanceUsed || 0, appliedToOutstanding: j.appliedToOutstanding || 0, settledInvoices: j.settledInvoices || [], newAdvance: j.newAdvance || 0 })
        showToast(j.message)
        setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false })
        setPosDiscount(''); setPosPayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
        setPosNotes(''); setPosDate(new Date().toISOString().split('T')[0]); setPosVehicleNo(''); setUseAdvance(false)
        setPosDraftId(null); setPosDraftInvoiceNo('')
        setPosCustomerAddress(''); setPosCustomerTin(''); setPosCustomerVatReg(false)
        setShowManualLine(false); setManualLine({ name: '', qty: '1', price: '' })
        setPosPreview(false)
        await onDataChanged()
        fetchAllDrafts()
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setPosLoading(false)
  }

  async function handleCreateDraft() {
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
        setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0 }); setPosVehicleNo('')
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
                <div className="flex justify-between font-black text-base text-slate-800 pt-1 border-t border-slate-200"><span>Total</span><span>Rs.{posTotal.toLocaleString()}</span></div>
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
              <button onClick={() => printInvoice(posReceipt.sale, posReceipt.vendor, 'thermal', vendorSettings)} className="bg-slate-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl">🖨️ Thermal</button>
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
              <button onClick={() => { setPosDraftId(null); setPosDraftInvoiceNo(''); setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false }); setPosVehicleNo('') }} className="shrink-0 text-amber-400 hover:text-red-500 text-2xl font-bold leading-none">✕</button>
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
                      onClick={() => { setPosEntityId(e.id); if (e.invoice_mode !== 'lk_tax') setPosDocType('receipt') }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${posEntityId === e.id ? 'bg-slate-800 text-white border-slate-800' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                      {e.is_default ? '★ ' : ''}{e.name.replace('MacForce Auto Engineering', 'MacForce')}
                    </button>
                  ))}
                </div>
              </div>
              {posCurrentEntity?.invoice_mode === 'lk_tax' && (
                <div className="shrink-0">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Document</p>
                  <div className="flex rounded-lg border-2 border-slate-200 overflow-hidden">
                    <button onClick={() => setPosDocType('receipt')} className={`px-3 py-1.5 text-xs font-bold transition ${posDocType === 'receipt' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>🧾 Receipt</button>
                    <button onClick={() => setPosDocType('tax_invoice')} className={`px-3 py-1.5 text-xs font-bold transition ${posDocType === 'tax_invoice' ? 'bg-orange-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>📋 Tax Invoice</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-6 pb-36 lg:pb-0">
            <div className="lg:col-span-2 space-y-3 lg:space-y-4 order-last lg:order-none">
              {/* Product Search */}
              <div className="bg-white rounded-xl border border-slate-200 p-4">
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

              {/* Cart */}
              {posCart.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-8 text-center"><p className="text-3xl opacity-30">🛒</p><p className="text-slate-400 font-semibold">Add products above</p></div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-slate-50">
                      <th className="px-2 sm:px-4 py-2 text-left text-xs font-bold text-slate-500">Item</th>
                      <th className="px-2 sm:px-4 py-2 text-xs font-bold text-slate-500 w-16 sm:w-20">Qty</th>
                      <th className="px-2 sm:px-4 py-2 text-xs font-bold text-slate-500 w-20 sm:w-28">Price</th>
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
                            <input type="number" min="1" max={item.maxStock} value={item.quantity} onChange={e => updateCartQty(i, parseInt(e.target.value) || 1)} className="w-12 sm:w-16 px-1 sm:px-2 py-1 border border-slate-200 rounded text-center text-sm" />
                          </td>
                          <td className="px-2 sm:px-4 py-2">
                            <input type="text" inputMode="numeric" value={item.unitPrice || ''} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); updateCartPrice(i, v ? parseInt(v) : 0) }} onFocus={e => { if (e.target.value === '0') e.target.value = '' }} className="w-20 sm:w-24 px-1 sm:px-2 py-1 border border-slate-200 rounded text-sm" />
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
                      <input value={manualLine.name} onChange={e => setManualLine(p => ({ ...p, name: e.target.value }))} placeholder="Description (e.g. Wheel Alignment)" className="w-full px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none focus:border-blue-400" />
                      <div className="flex gap-2">
                        <input type="text" inputMode="numeric" value={manualLine.qty} onChange={e => setManualLine(p => ({ ...p, qty: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="Qty" className="w-20 px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none text-center" />
                        <input type="text" inputMode="numeric" value={manualLine.price} onChange={e => setManualLine(p => ({ ...p, price: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="Price (Rs.)" className="flex-1 px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none" />
                        <button onClick={addManualLine} className="bg-blue-600 text-white font-bold px-3 py-2 rounded-lg text-sm">Add</button>
                        <button onClick={() => { setShowManualLine(false); setManualLine({ name: '', qty: '1', price: '' }) }} className="text-slate-400 hover:text-red-500 font-bold px-2">✕</button>
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
                    <div className="flex justify-between text-sm"><span className="text-slate-300">VAT 18%</span><span>Rs.{posVatAmount.toLocaleString()}</span></div>
                  </div>
                )}
                <div className="flex justify-between text-2xl font-black"><span>TOTAL</span><span>Rs.{posTotal.toLocaleString()}</span></div>
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

                {/* lk_tax: address + TIN (required for tax invoices) */}
                {isLkTax && posDocType === 'tax_invoice' && (
                  <div className="space-y-1.5 pt-1 border-t border-slate-100 mt-1">
                    <p className="text-[10px] font-black text-orange-600 uppercase tracking-widest">Tax Invoice — Purchaser Details</p>
                    <input value={posCustomerAddress} onChange={e => { setPosCustomerAddress(e.target.value); if ((posErrors as any).address) setPosErrors(prev => ({ ...prev, address: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none ${(posErrors as any).address ? 'border-red-400 bg-red-50' : 'border-slate-200 focus:border-orange-400'}`} placeholder="Address *" />
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={posCustomerVatReg} onChange={e => { setPosCustomerVatReg(e.target.checked); if (!e.target.checked) setPosCustomerTin('') }} className="w-4 h-4 accent-orange-500" />
                      <span className="text-xs font-bold text-slate-600">VAT-Registered Purchaser</span>
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
                  <input type="text" value={posVehicleNo} onChange={e => { let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); const m = v.match(/^([A-Z]{2,3})(\d{1,4})$/); if (m) v = m[1] + '-' + m[2]; setPosVehicleNo(v); if (posErrors.vehicle) setPosErrors(prev => ({...prev, vehicle: false})) }} placeholder={posCustomer.require_vehicle_no ? 'ABC-1234 (required)' : 'ABC-1234'} maxLength={8} className={'w-full px-3 py-2 rounded-lg border-2 text-sm outline-none font-mono font-bold tracking-wider transition-all ' + (posErrors.vehicle ? 'border-red-400 bg-red-50 animate-[shake_0.3s_ease-in-out]' : 'border-slate-200 focus:border-orange-400')} />
                  {posCustomer.require_vehicle_no && <span className="absolute right-2 top-2 text-[9px] font-black text-red-500">REQ</span>}
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
                      <input type="text" inputMode="numeric" pattern="[0-9]*" value={line.amount} onChange={e => { const val = e.target.value.replace(/[^0-9.]/g, ''); const u = [...posPayments]; u[i] = { ...u[i], amount: val }; setPosPayments(u) }} className="flex-1 sm:w-28 sm:flex-none min-w-0 px-2 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Amount" />
                      {line.method === 'cheque' && (<>
                        <input type="text" value={line.chequeNumber} onChange={e => { const u = [...posPayments]; u[i] = { ...u[i], chequeNumber: e.target.value }; setPosPayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Cheque #" />
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
                <input value={posDiscount} onChange={e => setPosDiscount(e.target.value.replace(/[^0-9.]/g, ''))} type="text" inputMode="numeric" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Discount (Rs.)" />
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
              <span className="text-xl font-black">Rs.{posTotal.toLocaleString()}</span>
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
