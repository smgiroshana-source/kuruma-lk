'use client'
import { toWhatsAppNumber, formatPhoneSL, validatePhoneSL } from '@/lib/constants'
import { escapeHtml } from '@/lib/escapeHtml'
import { colomboToday } from '@/lib/dates'
import { saleStatusChip } from '@/lib/saleStatus'
import { gpPercent, isBelowCost, netOfVat, costIncVat, productCostIncVat, costHasVat } from '@/lib/margin'
import { compressImage } from '@/lib/compressImage'

// "Business day" of a sale/return/collection = the Asia/Colombo calendar date it
// actually occurred on. No evening cutoff: an 8 PM sale belongs to that day's
// report, not the next day's. Must be computed in Colombo time because
// toISOString() is UTC (which reads as yesterday before 05:30 local).
function colomboBusinessDay(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
}

// Same reasoning, with the clock time: when a return was raised is the whole
// point of listing it, and it must read in Colombo time like every other
// timestamp the shop sees.
function fmtColomboDateTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return '—'
  const d = new Date(isoTimestamp)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-LK', {
    timeZone: 'Asia/Colombo', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

import { useState, useEffect, useRef, startTransition, useMemo, Fragment } from 'react'
import TabStockLkTax from './_lk_tax/TabStock'
import TabStockStandard from './_standard/TabStock'
import TabPOSLkTax from './_lk_tax/TabPOS'
import TabPOSStandard from './_standard/TabPOS'
import type { PendingDraft } from './_lk_tax/TabPOS'
import IncomingTransfers from './_shared/IncomingTransfers'
import TabCredit from './_shared/TabCredit'
import ProductThumb from '@/components/ProductThumb'
import { ProductSheet, PartOutPanel } from './_shared/ProductSheet'
import TabCreditNotes from './_lk_tax/TabCreditNotes'
import TabClaims from './_lk_tax/TabClaims'
import WheelMartSidebar from './_lk_tax/WheelMartSidebar'
import TabOverview from './_lk_tax/TabOverview'
import TabSuppliers from './_lk_tax/TabSuppliers'
import TabSupplierReturns from './_lk_tax/TabSupplierReturns'
import TabWriteoffs from './_lk_tax/TabWriteoffs'
import TabStaff from './_lk_tax/TabStaff'
import TabImports from './_lk_tax/TabImports'
import TabTax from './_lk_tax/TabTax'
import StaffLogins from './_shared/StaffLogins'
import TabCash from './_lk_tax/TabCash'
import TabReports from './_lk_tax/TabReports'

type VendorTab = 'claims' | 'overview' | 'products' | 'add' | 'bulk' | 'pos' | 'sales' | 'credit' | 'receivables' | 'stocktake' | 'suppliers' | 'supplier-returns' | 'writeoffs' | 'fleet' | 'cash' | 'reports' | 'staff' | 'imports' | 'tax' | 'settings'
const CATEGORIES = ['Engine Parts','Transmission & Drivetrain','Suspension & Steering','Brake System','Electrical & Electronics','Body Parts','Lighting','Interior Parts','A/C & Radiator','Wheels & Tires','Exhaust System','Filters & Fluids','Accessories','Hybrid & EV Parts','Other','Windscreen','Beading Belts & Rubber','Audio & Video','Safety']
const CONDITIONS = ['New-Genuine','New-Other','Reconditioned','Damaged']
const TYRE_WIDTHS  = [135,145,155,165,175,185,195,205,215,225,235,245,255,265,275,285,295,305,315,325]
const TYRE_PROFILES = [25,30,35,40,45,50,55,60,65,70,75,80,85]
const TYRE_RIMS    = [12,13,14,15,16,17,18,19,20,21,22,24]
const TYRE_BRANDS  = ['Bridgestone','Michelin','Dunlop','MRF','Apollo','Yokohama','Continental','Pirelli','Toyo','Kumho','Nankang','Nexen','Falken','Hankook','BFGoodrich','Maxxis','Sailun','Linglong','Triangle','Other Brand']
const PAY_METHODS = ['cash','cheque','bank','card']
const PAY_LABELS: Record<string, string> = { cash:'Cash', cheque:'Cheque', bank:'Bank Transfer', card:'Card', advance:'Advance', credit:'Credit' }

function generatePartId() { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'; let id = 'P-'; for (let i = 0; i < 6; i++) id += c[Math.floor(Math.random() * c.length)]; return id }

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n'); if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'))
  return lines.slice(1).map(line => { const vals: string[] = []; let cur = '', inQ = false; for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = '' } else cur += ch }; vals.push(cur.trim()); const obj: Record<string, string> = {}; headers.forEach((h, i) => obj[h] = vals[i] || ''); return obj }).filter(r => r.name || r.product_name || r.part_name)
}
function mapCSVRow(row: Record<string, string>) {
  const partId = row.stock_no || row.id || row.part_id || row.sku || row.partid || row.part_no || ''
  const showPriceRaw = (row.show_price || row.show_price_ || 'YES').trim().toUpperCase()
  const showPrice = showPriceRaw === 'YES' || showPriceRaw === 'TRUE' || showPriceRaw === '1'
  const cleanNum = (v: string) => (v || '').replace(/,/g, '').trim()
  return {
    partId: partId.trim(),
    addedDate: row.added_date || row.date || '',
    name: row.part_name || row.name || row.product_name || '',
    description: row.part_description || row.description || row.desc || '',
    category: (() => { const c = (row.category || 'Other').trim(); const match = CATEGORIES.find(cat => cat.toLowerCase() === c.toLowerCase()); return match || c })(),
    make: row.make || row.vehicle_make || row.brand || '',
    model: row.model || row.vehicle_model || '',
    modelCode: row.model_code || '',
    year: row.year || row.vehicle_year || '',
    condition: ((row.condition || 'Reconditioned').trim() === 'Damage' ? 'Damaged' : (row.condition || 'Reconditioned').trim()),
    side: row.side || '',
    color: row.color || '',
    oemCode: row.oem_code || '',
    cost: cleanNum(row.cost),
    price: cleanNum(row.price || row.unit_price || ''),
    quantity: row.quantity || row.qty || row.stock || '1',
    show_price: showPrice,
    loc_store: row.store || row.loc_store || '',
    loc_floor: row.floor || row.loc_floor || '',
    loc_sub1: row.sub_location_1 || row.sub1 || row.loc_sub1 || row.shelf || row.rack || '',
    loc_sub2: row.sub_location_2 || row.sub2 || row.loc_sub2 || row.bin || row.box || '',
    product_type: (row.product_type || row.type || '').trim().toLowerCase() || null,
    tyre_width:   cleanNum(row.tyre_width   || row.width   || ''),
    tyre_profile: cleanNum(row.tyre_profile || row.profile || row.aspect || ''),
    tyre_rim:     cleanNum(row.tyre_rim     || row.rim     || ''),
    origin_country: (row.manufactured_country || row.country_of_origin || row.origin_country || row.country || row.made_in || '').trim(),
    hasImage: false, imageCount: 0, imageFiles: [] as File[], autoId: false
  }
}
async function extractZipImages(file: File): Promise<Map<string, File[]>> {
  const JSZip = (await import('jszip')).default; const zip = await JSZip.loadAsync(file); const map = new Map<string, File[]>()
  for (const [path, entry] of Object.entries(zip.files)) { if (entry.dir || path.startsWith('__MACOSX') || path.includes('/._') || path.startsWith('.')) continue; const ext = path.split('.').pop()?.toLowerCase() || ''; if (!['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) continue; const parts = path.split('/').filter(p => p.length > 0); if (parts.length < 2) continue; const folder = parts[parts.length - 2]; const blob = await entry.async('blob'); const f = new File([blob], parts[parts.length - 1], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }); if (!map.has(folder)) map.set(folder, []); map.get(folder)!.push(f) }
  return map
}
function formatDate(d: string) { return new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) }
function formatDateShort(d: string) { return new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' }) }
function locLabel(p: any) { return [p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ') }
function confirmedAgo(dateStr: string | null): { label: string; cls: string } | null {
  if (!dateStr) return null
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days === 0) return { label: 'Confirmed today', cls: 'text-emerald-700 bg-emerald-50' }
  if (days <= 7)  return { label: `${days}d ago`, cls: 'text-emerald-600 bg-emerald-50' }
  if (days <= 30) return { label: `${days}d ago`, cls: 'text-amber-700 bg-amber-50' }
  return { label: `${days}d ago`, cls: 'text-red-600 bg-red-50' }
}

// Strip internal tracking notes that must not appear on printed customer invoices.
function cleanPrintNotes(notes: string | null | undefined): string {
  if (!notes) return ''
  return notes
    .split(/;\s*|\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0
      && !s.startsWith('Cancelled SAK-')
      && !s.startsWith('ON APPROVAL')
      && !s.startsWith('VOIDED:')
      && !s.startsWith('RETURN:')
      && !s.startsWith('ITEM RETURNED:'))
    .join('; ')
    .trim()
}

// Fetch ALL of a customer's invoices from the DB (ordered by invoice_no ascending),
// compute a running cumulative balance_due, and print with the correct total.
// This works regardless of which period filter is active in the Sales tab.
async function printWithTotal(sale: any, vendor: any, format: 'a4' | 'thermal', settings?: any) {
  let totalAmountDue = parseFloat(sale.total_amount_due || 0)
  if (sale.customer_id) {
    try {
      const r = await fetch(`/api/vendor/sales?customer_id=${sale.customer_id}`)
      const j = await r.json()
      // API returns invoices ordered by invoice_no ascending (non-voided, non-draft)
      let cumulative = 0
      for (const s of (j.sales || [])) {
        cumulative += parseFloat(s.balance_due || 0)
        if (s.id === sale.id) { totalAmountDue = cumulative; break }
      }
    } catch {}
  }
  printInvoice({ ...sale, total_amount_due: totalAmountDue }, vendor, format, settings)
}

// ── SL-compliant TAX INVOICE printer (lk_tax vendors only) ──────────────────

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
    ? `<img src="${escapeHtml(s.logo_url)}" style="height:44px;max-width:110px;object-fit:contain;display:block;margin-bottom:3px">`
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
/* ─── Page: declared A4 PORTRAIT, invoice in the TOP HALF (210mm × 148mm =
       A5 landscape). Dot-matrix printers cannot rotate a page — landscape as a
       page size splits onto two portrait sheets — so we declare what the
       printer feeds (A4 portrait) and draw the A5 area at the top, exactly as
       the shop's old system did. Zero browser margins; body padding = paper
       margins ─── */
@page{size:A4 portrait;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html{background:#8c9194;min-height:100%;padding:8mm 0 16mm}
body{
  font-family:Arial,'Helvetica Neue',sans-serif;
  font-size:12.5px;color:#111;line-height:1.5;
  width:210mm;min-height:148mm;
  margin:0 auto;padding:6mm 10mm 5mm;
  background:#fff;
  box-shadow:0 4px 24px rgba(0,0,0,.4);
  display:flex;flex-direction:column;
}
@media print{
  html{background:#fff;padding:0}
  body{width:100%;min-height:148mm;margin:0;padding:6mm 10mm 5mm;box-shadow:none}
}
/* ─── Header ─────────────────────────────────────────────── */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;
     gap:14px;padding-bottom:7px;border-bottom:1px solid #000;margin-bottom:8px}
.hl{flex:1}
.hl-name{font-size:19px;font-weight:900;line-height:1.15}
.hl-sub{font-size:11px;color:#444;margin-top:2px}
.hl-tin{font-size:11.5px;font-weight:700;margin-top:2px}
.hr{text-align:right;flex-shrink:0}
.hr-badge{display:inline-block;padding:2px 0;
          font-size:18px;font-weight:900;letter-spacing:3px;line-height:1.2}
.hr-sno{font-size:11px;font-weight:700;margin-top:5px;
        font-family:'Courier New',monospace;letter-spacing:.3px}
/* ─── Unified info box (parties + dates) ─────────────────── */
.ibox{margin-bottom:7px}
/* flex (not fixed 2-col grid): rows hold 1–3 cells — full-width purchaser,
   and dates row fits Vehicle No when present */
.irow{display:flex}

.ic{flex:1;padding:6px 12px}

.ic-lbl{font-size:8.5px;font-weight:900;text-transform:uppercase;letter-spacing:1.3px;
        color:#666;padding-bottom:3px;margin-bottom:5px}
.ic-name{font-size:14.5px;font-weight:700}
.ic-sub{font-size:11.5px;color:#333;margin-top:2px;line-height:1.4}
.ic-tin{font-size:11.5px;font-weight:700;margin-top:3px}
.ic-tinna{font-size:11px;color:#bbb;margin-top:3px}
.ic-buyer{flex:1.55}
.ic-meta{flex:1;display:flex;flex-direction:column;justify-content:center;gap:7px}
.im{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.im-l{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:#666;white-space:nowrap}
.im-v{font-size:13px;font-weight:700;font-family:'Courier New',monospace;white-space:nowrap}
.ic-dlbl{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.3px;color:#666}
.ic-dval{font-size:13px;font-weight:700;font-family:'Courier New',monospace;margin-top:3px}
/* ─── Line-items table ───────────────────────────────────── */
table{width:100%;border-collapse:collapse;margin-bottom:6px}
th{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;
   padding:5px 8px;text-align:left;
   border-top:1px solid #000;border-bottom:1px solid #000}
td{font-size:12.5px;padding:5.5px 8px;vertical-align:top}
.c-no{width:26px;text-align:center}
.c-qty{width:44px;text-align:center}
.c-price{width:105px;text-align:right;white-space:nowrap}
.c-amt{width:110px;text-align:right;font-weight:700;white-space:nowrap}
tbody tr:last-child td{border-bottom:1px solid #000}
/* ─── Totals band: words + payment left, totals right — the landscape
       sheet is wide and short, so this row is where the height is saved ─── */
.band{display:flex;gap:7px;align-items:stretch;margin-bottom:5px}
.band-l{flex:1;display:flex;flex-direction:column;gap:5px;min-width:0}
.band-l .words{flex:1;margin-bottom:0}
.band-l .pmt{margin-bottom:0}
.ttbl{width:84mm;flex-shrink:0;border-collapse:collapse;margin-bottom:0}
.ttbl td{font-size:12.5px;padding:6px 10px;vertical-align:middle}
.ttbl tbody tr:last-child td{border-bottom:none}
.tlbl{color:#333;white-space:nowrap}
.tval{text-align:right;font-weight:700;white-space:nowrap}
.ttbl .grand td{border-top:1px solid #000;font-size:16px;font-weight:900;padding:8px 10px}

/* ─── Amount in words ─────────────────────────────────────── */
.words{padding:2px 0;margin-bottom:5px}
.wlbl{font-size:8.5px;font-weight:900;text-transform:uppercase;
      letter-spacing:1.1px;color:#666;margin-bottom:3px}
.wval{font-size:12.5px;font-weight:700}
/* ─── Payment ────────────────────────────────────────────── */
.pmt{padding:2px 0;margin-bottom:0}
.pmt-lbl{font-size:8.5px;font-weight:900;text-transform:uppercase;
         letter-spacing:1.1px;color:#666;margin-bottom:3px}
.pmt-val{font-size:12px;font-weight:700}
/* ─── Flexible spacer + signatures + footer ──────────────── */
.push{flex:1;min-height:0}
.sigs{display:flex;justify-content:space-between;gap:40px}
.sig{flex:1;text-align:center}
.sig-line{border-top:1px solid #000;padding-top:5px;
          font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px;color:#555}
.footer{text-align:center;font-size:9.5px;color:#888;
        margin-top:6px;padding-top:4px}
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
    <div class="ic ic-buyer">
      <div class="ic-lbl">Bill To (Purchaser)</div>
      <div class="ic-name">${purchaserName || '&mdash;'}</div>
      ${purchaserAddress ? `<div class="ic-sub">${purchaserAddress}</div>` : ''}
      ${purchaserPhone   ? `<div class="ic-sub">${purchaserPhone}</div>`   : ''}
      ${purchaserTin
        ? `<div class="ic-tin">TIN: ${purchaserTin}</div>`
        : `<div class="ic-tinna">TIN: Not Registered</div>`}
    </div>
    <div class="ic ic-meta">
      <div class="im"><span class="im-l">Date of Invoice</span><span class="im-v">${invoiceDate}</span></div>
      <div class="im"><span class="im-l">Date of Supply</span><span class="im-v">${supplyDate}</span></div>
      ${vehicleNo ? `<div class="im"><span class="im-l">Vehicle No</span><span class="im-v">${vehicleNo}</span></div>` : ''}
      ${sale.mileage_km != null ? `<div class="im"><span class="im-l">Mileage</span><span class="im-v">${Number(sale.mileage_km).toLocaleString()} km</span></div>` : ''}
    </div>
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

<!-- Words + payment on the left, totals on the right — one band -->
<div class="band">
  <div class="band-l">
    <div class="words">
      <div class="wlbl">Amount in Words</div>
      <div class="wval">${totalWords}</div>
    </div>
    ${paymentHtml}
  </div>
  <table class="ttbl">
    ${discount > 0
      ? `<tr><td class="tlbl">Discount</td><td class="tval">&#8722;&nbsp;${discount.toLocaleString()}</td></tr>`
      : ''}
    <tr><td class="tlbl">Net Amount (excl. VAT)</td><td class="tval">${netAmount.toLocaleString()}</td></tr>
    <tr><td class="tlbl">VAT @ ${vatRate}%</td><td class="tval">${vatAmount.toLocaleString()}</td></tr>
    <tr class="grand"><td class="tlbl">TOTAL (Rs.)</td><td class="tval">${total.toLocaleString()}</td></tr>
  </table>
</div>

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

// ─────────────────────────────────────────────────────────────────────────────

function printInvoice(sale: any, vendor: any, format: 'a4' | 'thermal', settings?: any) {
  // Route lk_tax TAX INVOICEs to the compliant template
  if (sale.document_type === 'tax_invoice') {
    return printTaxInvoice(sale, vendor, settings)
  }

  // Exclude fully-returned items; adjust qty/total for partial returns
  const items = (sale.items || [])
    .filter((i: any) => (i.returned_quantity || 0) < i.quantity)
    .map((i: any) => {
      const displayQty = i.quantity - (i.returned_quantity || 0)
      return { ...i, quantity: displayQty, total: displayQty * parseFloat(i.unit_price) }
    })
  // credit_return is an internal balance-adjustment record — hide it from the printout
  const payments = (sale.payments || []).filter((p: any) => p.payment_method !== 'credit_return')
  const isThermal = format === 'thermal'; const w = isThermal ? 300 : 800
  const s = settings || {}
  const shopName = escapeHtml(s.invoice_title || vendor?.name) || 'kuruma.lk'
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false && !isThermal) ? `<img src="${escapeHtml(s.logo_url)}" style="height:${isThermal ? '30px' : '60px'};max-width:${isThermal ? '60px' : '120px'};object-fit:contain;margin-bottom:4px" />` : ''
  const thermalLogoHtml = (s.logo_url && s.invoice_show_logo !== false && isThermal) ? `<img src="${escapeHtml(s.logo_url)}" style="height:30px;max-width:60px;object-fit:contain;margin-bottom:2px" />` : ''
  const taxLine = s.tax_id ? `<div style="font-size:${isThermal ? '9px' : '12px'};color:#000;font-weight:700">Tax/VAT: ${escapeHtml(s.tax_id)}</div>` : ''
  const emailLine = s.email ? `<div style="font-size:${isThermal ? '9px' : '12px'};color:#000;font-weight:700">${escapeHtml(s.email)}</div>` : ''
  const footerText = escapeHtml(s.invoice_footer) || 'Thank you for your business!'
  const termsHtml = (!isThermal && s.invoice_terms) ? `<div style="margin-top:12px;padding:10px;border:2px solid #000;border-radius:6px;font-size:13px;color:#000;font-weight:600;line-height:1.5"><strong>Terms & Conditions:</strong><br/>${escapeHtml(s.invoice_terms).replace(/\n/g, '<br/>')}</div>` : ''
  const paymentLines = payments.map((p: any) => `<div style="display:flex;justify-content:space-between;font-size:${isThermal ? '10px' : '13px'};font-weight:${isThermal ? '700' : '600'};color:#000;padding:3px 0"><span>${escapeHtml((p.payment_method || 'cash').toUpperCase())}${p.cheque_number ? ' #' + escapeHtml(p.cheque_number) : ''}</span><span>Rs.${parseFloat(p.amount).toLocaleString()}</span></div>`).join('')
  const a4Style = `@page{size:A4;margin:15mm 18mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:13px;color:#222;font-weight:400;max-width:720px;margin:0 auto;padding:25px 30px}@media print{body{padding:0;max-width:100%}}
.header{text-align:center;padding:20px 0 15px;margin-bottom:0}
.shop-name{font-size:24px;font-weight:700;color:#000;letter-spacing:-0.5px}
.header-sub{font-size:11px;color:#444;margin-top:2px;line-height:1.6}
.invoice-title{display:flex;justify-content:space-between;align-items:center;padding:10px 0;margin-top:15px;border-top:2px solid #000;border-bottom:1px solid #aaa}
.invoice-title h2{font-size:18px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:2px}
.invoice-no{font-size:18px;font-weight:700;color:#000;font-family:'Courier New',monospace}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:12px 0}
.info-cell{padding:8px 0;font-size:12px;border-bottom:1px solid #ccc}
.info-cell:nth-child(even){text-align:right}
.info-label{color:#555;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:1px;display:block;margin-bottom:2px}
.info-value{font-weight:600;color:#000;font-size:13px}
table{width:100%;border-collapse:collapse;margin:15px 0}
thead{background:#eee}
th{text-align:left;font-size:10px;font-weight:700;padding:8px 10px;color:#222;text-transform:uppercase;letter-spacing:0.5px;border-bottom:2px solid #aaa}
td{padding:10px;font-size:13px;font-weight:500;color:#111;border-bottom:1px solid #ddd}
.text-right{text-align:right}
.totals{margin-top:10px;border-top:1px solid #aaa;padding-top:5px}
.total-row{display:flex;justify-content:space-between;padding:4px 10px;font-size:13px;font-weight:600;color:#222}
.grand-total{display:flex;justify-content:space-between;font-weight:800;font-size:20px;color:#000;padding:12px 10px;margin-top:5px;background:#eee;border-radius:4px}
.balance-due{font-weight:700;font-size:16px;text-align:right;margin-top:15px;padding:12px 15px;border:2px solid #000;color:#000;border-radius:4px}
.payments-section{margin-top:10px;padding:8px 10px;background:#f0f0f0;border-radius:4px}
.payments-label{font-size:9px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px}
.note-section{margin-top:10px;padding:8px 12px;font-size:12px;font-style:italic;color:#333;border-left:3px solid #999}
.footer{text-align:center;padding:25px 0 10px;font-size:10px;color:#888;margin-top:30px;border-top:1px solid #ccc}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}thead{background:#eee !important}.grand-total{background:#eee !important}}`
  // WHEEL MART prints on A5 paper; Sakura stays on A4 — same markup, scaled sheet
  const a5Style = `@page{size:A4 portrait;margin:7mm 10mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;font-size:13px;color:#222;font-weight:400;max-width:700px;margin:0 auto;padding:14px 20px}@media print{body{padding:0;max-width:100%}}.header{text-align:center;padding:10px 0 8px;margin-bottom:0}.shop-name{font-size:21px;font-weight:700;color:#000;letter-spacing:-0.4px}.header-sub{font-size:10.5px;color:#444;margin-top:2px;line-height:1.5}.invoice-title{display:flex;justify-content:space-between;align-items:center;padding:8px 0;margin-top:10px;border-top:2px solid #000;border-bottom:1px solid #aaa}.invoice-title h2{font-size:15px;font-weight:700;color:#000;text-transform:uppercase;letter-spacing:1.8px}.invoice-no{font-size:15px;font-weight:700;color:#000;font-family:'Courier New',monospace}.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:0;margin:9px 0}.info-cell{padding:6px 0;font-size:11px}.info-cell:nth-child(even){text-align:right}.info-label{color:#555;font-size:8.5px;font-weight:600;text-transform:uppercase;letter-spacing:.9px;display:block;margin-bottom:1px}.info-value{font-weight:600;color:#000;font-size:12px}table{width:100%;border-collapse:collapse;margin:10px 0}th{text-align:left;font-size:9.5px;font-weight:700;padding:6px 8px;color:#222;text-transform:uppercase;letter-spacing:.5px;border-top:1px solid #000;border-bottom:1px solid #000}td{padding:7px 8px;font-size:12.5px;font-weight:500;color:#111}.text-right{text-align:right}.totals{margin-top:7px;border-top:1px solid #aaa;padding-top:4px}.total-row{display:flex;justify-content:space-between;padding:3px 8px;font-size:12.5px;font-weight:600;color:#222}.grand-total{display:flex;justify-content:space-between;font-weight:800;font-size:17px;color:#000;padding:9px 8px;margin-top:4px;border-top:1px solid #000}.balance-due{font-weight:700;font-size:13px;text-align:right;margin-top:10px;padding:6px 0;color:#000}.payments-section{margin-top:7px;padding:6px 0}.payments-label{font-size:8.5px;font-weight:700;color:#444;text-transform:uppercase;letter-spacing:.9px;margin-bottom:3px}.note-section{margin-top:7px;padding:6px 10px;font-size:11px;font-style:italic;color:#333;border-left:3px solid #999}.footer{text-align:center;padding:14px 0 6px;font-size:9px;color:#888;margin-top:16px}`
  const thermalStyle = `@page{size:80mm auto;margin:2mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;color:#000;width:300px;max-width:100%;margin:0 auto}.header{text-align:center;padding:5px 0;border-bottom:1px dashed #000}.shop-name{font-size:16px;font-weight:900}table{width:100%;border-collapse:collapse;margin:5px 0}th{text-align:left;font-size:10px;font-weight:900;padding:3px 2px;border-bottom:1px dashed #000}td{padding:3px 2px;font-size:11px;border-bottom:1px solid #ddd}.text-right{text-align:right}.totals{border-top:1px dashed #000;padding-top:5px}.total-row{display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:700}.grand-total{font-weight:900;font-size:16px;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:5px 0;margin-top:5px}.footer{text-align:center;padding:8px 0 5px;font-size:10px;border-top:1px dashed #000;margin-top:5px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(sale.invoice_no)}</title>
<style>${isThermal ? thermalStyle : (settings?.invoice_mode === 'lk_tax' ? a5Style : a4Style)}</style></head><body>
<div class="header">${isThermal ? thermalLogoHtml : logoHtml}<div class="shop-name">${shopName}</div><div class="header-sub">${escapeHtml([vendor?.location, vendor?.address].filter(Boolean).join(', '))}${vendor?.phone ? `<br/>Tel: ${escapeHtml(vendor.phone)}${vendor?.whatsapp && vendor.whatsapp !== vendor.phone ? ' | WhatsApp: ' + escapeHtml(vendor.whatsapp) : ''}` : ''}${s.tax_id ? `<br/>Tax/VAT: ${escapeHtml(s.tax_id)}` : ''}${s.email ? `<br/>${escapeHtml(s.email)}` : ''}</div></div>
${isThermal ? `<div style="padding:5px 0;font-size:11px"><div><strong>${sale.payment_status === 'draft' ? 'On Approval: ' : 'Invoice: '}</strong><strong style="font-size:12px">${escapeHtml(sale.invoice_no)}</strong></div><div><strong>Date: </strong><strong>${formatDate(sale.created_at)}</strong></div><div><strong>Customer: </strong><strong>${escapeHtml(sale.customer_name)}${sale.customer_phone ? ' (' + escapeHtml(sale.customer_phone) + ')' : ''}</strong></div>${sale.vehicle_no ? `<div><strong>Vehicle: </strong><strong style="font-size:12px;letter-spacing:2px">${escapeHtml(sale.vehicle_no)}</strong></div>` : ''}</div>` : `<div class="invoice-title"><h2>${sale.payment_status === 'draft' ? 'On Approval' : 'Invoice'}</h2><span class="invoice-no">${escapeHtml(sale.invoice_no)}</span></div><div class="info-grid"><div class="info-cell"><span class="info-label">Date</span><span class="info-value">${formatDate(sale.created_at)}</span></div><div class="info-cell"><span class="info-label">Vehicle No</span><span class="info-value" style="font-size:14px;letter-spacing:2px;font-family:'Courier New',monospace">${escapeHtml(sale.vehicle_no) || '—'}</span></div>${sale.mileage_km != null ? `<div class="info-cell"><span class="info-label">Mileage</span><span class="info-value">${Number(sale.mileage_km).toLocaleString()} km</span></div>` : ''}<div class="info-cell"><span class="info-label">Customer</span><span class="info-value">${escapeHtml(sale.customer_name)}${sale.customer_phone ? ' (' + escapeHtml(sale.customer_phone) + ')' : ''}</span></div><div class="info-cell"><span class="info-label">Payment Status</span><span class="info-value">${sale.payment_status === 'draft' ? 'PENDING' : sale.payment_status === 'paid' ? 'PAID' : sale.payment_status === 'voided' ? 'VOID' : parseFloat(sale.balance_due) > 0 ? 'CREDIT' : 'PAID'}</span></div></div>`}
<table><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead><tbody>${items.map((i: any) => `<tr><td>${i.product_sku ? escapeHtml(i.product_sku) + ' - ' : ''}${escapeHtml(i.product_name)}</td><td class="text-right">${i.quantity}</td><td class="text-right">Rs.${parseFloat(i.unit_price).toLocaleString()}</td><td class="text-right">Rs.${parseFloat(i.total).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<div class="totals">${parseFloat(sale.discount) > 0 ? `<div class="total-row"><span>Subtotal</span><span>Rs.${parseFloat(sale.subtotal).toLocaleString()}</span></div><div class="total-row" style="color:#000"><span>Discount</span><span>-Rs.${parseFloat(sale.discount).toLocaleString()}</span></div>` : ''}<div class="total-row grand-total"><span>TOTAL</span><span>Rs.${parseFloat(sale.total).toLocaleString()}</span></div></div>
${paymentLines ? (isThermal ? `<div style="margin-top:6px"><div style="font-size:10px;font-weight:600;margin-bottom:3px">Payments</div>${paymentLines}</div>` : `<div class="payments-section"><div class="payments-label">Payments</div>${paymentLines}</div>`) : ''}
${cleanPrintNotes(sale.notes) ? (isThermal ? `<div style="margin-top:5px;padding:4px;font-size:10px;font-style:italic">Note: ${escapeHtml(cleanPrintNotes(sale.notes))}</div>` : `<div class="note-section">Note: ${escapeHtml(cleanPrintNotes(sale.notes))}</div>`) : ''}
${(() => {
  const totalDue = parseFloat(sale.total_amount_due || sale.totalAmountDue || 0)
  const currentInvoiceDue = parseFloat(sale.balance_due || 0)
  // Case 1: Has total_amount_due saved (new invoices) — show even if this invoice is fully paid
  if (totalDue > 0) {
    const showBreakdown = currentInvoiceDue > 0 && totalDue > currentInvoiceDue
    const paidNote = currentInvoiceDue === 0 ? '<div style="font-size:13px;font-weight:600;color:#000;margin-bottom:4px">This Invoice: PAID</div>' : ''
    return isThermal
      ? `<div style="text-align:center;font-weight:900;font-size:14px;margin-top:8px;padding:5px;border-top:1px dashed #000;border-bottom:1px dashed #000">${showBreakdown ? `This Invoice Due: Rs.${currentInvoiceDue.toLocaleString()}<br/>` : ''}${currentInvoiceDue === 0 ? 'This Invoice: PAID<br/>' : ''}TOTAL AMOUNT DUE: Rs.${totalDue.toLocaleString()}</div>`
      : `<div class="balance-due">${paidNote}${showBreakdown ? `<div style="font-size:14px;font-weight:700;margin-bottom:4px">This Invoice Due: Rs.${currentInvoiceDue.toLocaleString()}</div>` : ''}TOTAL AMOUNT DUE: Rs.${totalDue.toLocaleString()}</div>`
  }
  // Case 2: Old invoice with balance — show simple BALANCE DUE
  if (currentInvoiceDue > 0) {
    return isThermal
      ? `<div style="text-align:center;font-weight:900;font-size:14px;margin-top:8px;padding:5px;border-top:1px dashed #000;border-bottom:1px dashed #000">BALANCE DUE: Rs.${currentInvoiceDue.toLocaleString()}</div>`
      : `<div class="balance-due">BALANCE DUE: Rs.${currentInvoiceDue.toLocaleString()}</div>`
  }
  // Case 3: Fully paid, no outstanding — show nothing
  return ''
})()}
${termsHtml}
<div class="footer"><p style="color:${isThermal ? '#000' : '#999'}">${footerText}</p><p style="margin-top:3px;font-size:${isThermal ? '8px' : '9px'};color:#ccc">Powered by kuruma.lk</p></div></body></html>`
  const win = window.open('', '_blank', `width=${isThermal ? 350 : 900},height=700`); if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
}

function sendWhatsAppBill(sale: any, vendor: any, phone: string) {
  const waPhone = toWhatsAppNumber(phone)
  // Exclude fully-returned items (mirror printInvoice) and internal credit_return rows
  const items = (sale.items || [])
    .filter((i: any) => (i.returned_quantity || 0) < i.quantity)
    .map((i: any) => {
      const qty = i.quantity - (i.returned_quantity || 0)
      return `• ${i.product_sku || ''} ${i.product_name} x${qty} = Rs.${(qty * parseFloat(i.unit_price || 0)).toLocaleString()}`
    }).join('\n')
  const payments = (sale.payments || [])
    .filter((p: any) => p.payment_method !== 'credit_return')
    .map((p: any) => `  ${(p.payment_method || 'cash').toUpperCase()}: Rs.${parseFloat(p.amount).toLocaleString()}`).join('\n')
  let msg = `*Invoice: ${sale.invoice_no}*\n${vendor?.name || 'kuruma.lk'}\n${formatDate(sale.created_at)}${sale.vehicle_no ? '\nVehicle: ' + sale.vehicle_no : ''}\n\n${items}\n\nSubtotal: Rs.${parseFloat(sale.subtotal).toLocaleString()}`
  if (parseFloat(sale.discount) > 0) msg += `\nDiscount: -Rs.${parseFloat(sale.discount).toLocaleString()}`
  msg += `\n*TOTAL: Rs.${parseFloat(sale.total).toLocaleString()}*`
  if (payments) msg += `\n\nPayments:\n${payments}`
  if (parseFloat(sale.balance_due) > 0) msg += `\n\n⚠️ *This Invoice Due: Rs.${parseFloat(sale.balance_due).toLocaleString()}*`
  msg += `\n\nThank you! - ${vendor?.name || 'kuruma.lk'}`
  // encodeURIComponent — '&', '#' or '%' in a product/customer name truncates the message otherwise
  window.open(`https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`, '_blank')
}

const DEFAULT_VENDOR_SETTINGS = {
  invoice_title: '', invoice_footer: '', invoice_terms: '', invoice_show_logo: true,
  logo_url: '', address_line1: '', address_line2: '', tax_id: '', email: ''
}

export default function VendorDashboard() {
  const cleanupRanRef = useRef(false)
  const settingsTabLoadedRef = useRef(false)
  // Session-consistency guard: the login cookie is shared by every browser tab, so
  // if the user logs into the OTHER shop elsewhere (or this page is restored from
  // bfcache), fresh API responses belong to a different vendor than the one this
  // page rendered. Track the vendor id of the first response; on mismatch, hard
  // reload so the page rebuilds as one consistent shop instead of showing shop A's
  // shell around shop B's data (and worse, submitting sales to the wrong shop).
  const sessionVendorIdRef = useRef<string | null>(null)
  const [tab, setTab] = useState<VendorTab>('overview')
  // Deep-link a sub-view when arriving from the dashboard (e.g. Receive Stock →
  // stocktake's 'receive' view). Consumed + cleared by the target tab on mount.
  const [stockInitialView, setStockInitialView] = useState<string | null>(null)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [productsLoading, setProductsLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [editingProduct, setEditingProduct] = useState<any>(null)
  // Pieces taken off a complete assembly live in _shared/ProductSheet: the
  // phone's product sheet and the desktop edit modal both render that panel.
  const [sheetProduct, setSheetProduct] = useState<any>(null)
  const [productSearch, setProductSearch] = useState('')
  const [showSoldOut, setShowSoldOut] = useState(false)
  // WHEEL MART only: filter to in-stock products with no cost (cost-entry worklist)
  const [showMissingCost, setShowMissingCost] = useState(false)
  // Spreadsheet view
  const [productsViewMode, setProductsViewMode] = useState<'grid'|'sheet'>('grid')
  const [sheetSort, setSheetSort] = useState<{col:string;dir:'asc'|'desc'}>({col:'sku',dir:'asc'})
  const [sheetFilters, setSheetFilters] = useState({category:'',make:'',condition:'',status:''})
  const [sheetContainer, setSheetContainer] = useState<string>('')       // selected container e.g. "145"
  const [subItemCheck, setSubItemCheck] = useState('')                   // base number to check sub-items for
  const [soldProductInfo, setSoldProductInfo] = useState<Record<string, any>>({})
  const [soldInfoLoaded, setSoldInfoLoaded] = useState(false)

  // Fetch sold info lazily when "show sold out" is enabled — in an effect, not
  // during render (render-phase fetch/setState double-fires under StrictMode)
  useEffect(() => {
    if (!showSoldOut || soldInfoLoaded) return
    setSoldInfoLoaded(true)
    fetch('/api/vendor/products/sold-info')
      .then(r => r.json())
      .then(j => { if (j.soldInfo) setSoldProductInfo(j.soldInfo) })
      .catch(() => {})
  }, [showSoldOut, soldInfoLoaded])

  const [newProduct, setNewProduct] = useState({ partId:'', name:'', description:'', category:'Other', make:'', model:'', modelCode:'', year:'', condition:'Reconditioned', side:'', color:'', oemCode:'', cost:'', price:'', quantity:'1', show_price:true, loc_store:'', loc_floor:'', loc_sub1:'', loc_sub2:'', product_type:'part', tyre_width:'', tyre_profile:'', tyre_rim:'', origin_country:'' })
  const [productImages, setProductImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [addLoading, setAddLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [bulkData, setBulkData] = useState<any[]>([])
  const [bulkFile, setBulkFile] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [zipFiles, setZipFiles] = useState<string[]>([])
  const [zipProcessing, setZipProcessing] = useState(false)
  const [zipSummary, setZipSummary] = useState<any>(null)
  const [zipProgress, setZipProgress] = useState({ current: 0, total: 0, label: '', detail: '' })
  const bulkFileRef = useRef<HTMLInputElement>(null)
  const zipFileRef = useRef<HTMLInputElement>(null)

  // POS

  // Sales
  const [salesData, setSalesData] = useState<any>(null)
  const [salesPeriod, setSalesPeriod] = useState('today')
  const [salesLoading, setSalesLoading] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [settingsPhoneError, setSettingsPhoneError] = useState('')
  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exportLoading, setExportLoading] = useState(false)
  const [expandedSale, setExpandedSale] = useState<string | null>(null)
  const [salesSearch, setSalesSearch] = useState('')
  const [salesFilterFrom, setSalesFilterFrom] = useState('')
  const [salesFilterTo, setSalesFilterTo] = useState('')
  const [salesFilterCustomer, setSalesFilterCustomer] = useState('')
  const [salesFilterVehicle, setSalesFilterVehicle] = useState('')
  const [showSalesFilter, setShowSalesFilter] = useState(false)
  const [salesView, setSalesView] = useState('overview')
  // The returns tile counts by the day the RETURN was raised; the transactions
  // list below counts by the day the SALE was made. A return against an older
  // invoice therefore shows in the tile and nowhere else, and "2 return(s)"
  // gave no way to find out which two. Opening the tile answers it in place.
  const [returnsOpen, setReturnsOpen] = useState(false)
  // Correcting a mis-picked SKU in place. Without this the only way to fix one
  // was a return plus a re-bill, which is what tempted a staff member to
  // backdate the re-bill so the original day still balanced.
  const [fixItem, setFixItem] = useState<{ sale: any; item: any } | null>(null)
  const [fixSearch, setFixSearch] = useState('')
  const [fixPick, setFixPick] = useState<any>(null)
  const [fixReason, setFixReason] = useState('')
  const [fixSaving, setFixSaving] = useState(false)
  // Branch view for sales & reports: '' = whole business, or one side of it
  const [salesBranch, setSalesBranch] = useState<'' | 'shop' | 'workshop'>('')
  // Sidebar 'Customers' opens the Credit & Customers tab as the full registry
  const [receivablesShowAll, setReceivablesShowAll] = useState(false)
  // Inline rough-cost entry in the profit report (sku → typed value)
  const [roughCostInputs, setRoughCostInputs] = useState<Record<string, string>>({})
  const [roughCostSaving, setRoughCostSaving] = useState<string | null>(null)
  const [reportDate, setReportDate] = useState(colomboToday())
  const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [reportTo, setReportTo] = useState(colomboToday())
  const [periodReportModal, setPeriodReportModal] = useState(false)
  const [periodReportLoading, setPeriodReportLoading] = useState(false)
  const [periodReportSales, setPeriodReportSales] = useState<any[]>([])
  const [periodReportSelected, setPeriodReportSelected] = useState<Set<string>>(new Set())
  const [customerHistoryId, setCustomerHistoryId] = useState<string | null>(null)
  const [customerHistoryName, setCustomerHistoryName] = useState('')
  const [customerHistory, setCustomerHistory] = useState<any[] | null>(null)

  // Settings
  const [vendorSettings, setVendorSettings] = useState<any>({ ...DEFAULT_VENDOR_SETTINGS })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', new1: '', new2: '' })
  const [passwordLoading, setPasswordLoading] = useState(false)

  // Staff / multi-user

  // Draft / On Approval (page-level: used by Sales "Finalise →" to hand off to TabPOS)
  const [pendingPosDraft, setPendingPosDraft] = useState<PendingDraft | null>(null)
  // WHEEL MART only: items to APPEND to the POS cart (Send to POS from products),
  // distinct from pendingPosDraft which REPLACES the cart for draft finalising.
  const [pendingAddItems, setPendingAddItems] = useState<any[] | null>(null)
  const [draftReturning, setDraftReturning] = useState<string | null>(null)
  const [returningItem, setReturningItem] = useState<string | null>(null)
  const [allDrafts, setAllDrafts] = useState<any[]>([])

  // ── lk_tax (WHEEL MART) POS state ─────────────────────────────────────────
  const [posInvoiceEntities, setPosInvoiceEntities] = useState<any[]>([])

  // ── Credit note state ─────────────────────────────────────────────────────
  const [pendingCreditNote, setPendingCreditNote] = useState<{
    saleId: string; taxSerial: string; customerName: string
    returnedItems: Array<{saleItemId: string; quantity: number}>; refundAmount: number
    entityId: string | null
  } | null>(null)
  const [creditNoteLoading, setCreditNoteLoading] = useState(false)
  const [issuedCreditNote, setIssuedCreditNote] = useState<any>(null)

  // ── lk_tax Tax Config state (reports moved to _lk_tax/TaxRegisters) ──────
  const [taxConfigData, setTaxConfigData] = useState<Record<string, number> | null>(null)
  const [taxConfigSaving, setTaxConfigSaving] = useState(false)

  // Void sale modal
  // Phones get Sales read-only. The list and Print are useful on the floor;
  // Void, Return and Make Tax Invoice all write consequential records and a
  // mis-tap on a 375px row is not worth the convenience.
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const apply = () => setIsNarrow(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])
  const [promoteSale, setPromoteSale] = useState<any>(null)
  const [promoteCheck, setPromoteCheck] = useState<any>(null)
  const [promoting, setPromoting] = useState(false)
  const [reverseSale, setReverseSale] = useState<any>(null)
  const [reverseCheck, setReverseCheck] = useState<any>(null)
  const [reverseReason, setReverseReason] = useState('')
  const [reversing, setReversing] = useState(false)
  // Whether THIS user may withdraw a tax invoice at all — owner, or a manager
  // authorised for both stores. Decides whether the button exists.
  const [mayReverse, setMayReverse] = useState(false)
  const [voidModal, setVoidModal] = useState<{ saleId: string; total: number; paid: number; customerName: string } | null>(null)
  const [dailyReportLoading, setDailyReportLoading] = useState(false)
  const [returnModal, setReturnModal] = useState<any>(null)
  const [returnItems, setReturnItems] = useState<Record<string, number>>({})
  const [returnReason, setReturnReason] = useState('')
  const [returnLoading, setReturnLoading] = useState(false)

  // Feature 1,2: Bulk upload duplicate detection + progress
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0, phase: '', detail: '' })
  const [bulkDuplicates, setBulkDuplicates] = useState<any[]>([])
  const [onlyWithImages, setOnlyWithImages] = useState(false)
  const [showDuplicateModal, setShowDuplicateModal] = useState(false)
  const [duplicateAction, setDuplicateAction] = useState<'skip' | 'update'>('skip')

  // Feature 3: Multi-select delete
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())

  // Feature 5: Image delete in edit modal
  const [editProductImages, setEditProductImages] = useState<any[]>([])
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)

  // Mobile product actions

  // Primary image selection mode
  const [primaryMode, setPrimaryMode] = useState(false)
  const [primaryChanges, setPrimaryChanges] = useState<Map<string, { imageId: string, images: any[] }>>(new Map())

  // Stock Take state moved into _lk_tax/TabStock and _standard/TabStock components

  // Feature 8: Vendor change request
  const [pendingChangeRequest, setPendingChangeRequest] = useState<any>(null)

  useEffect(() => { fetchData(); fetchSettings() }, [])
  // Close the two stale-page entry points the fetch-time guard can't reach:
  // (1) bfcache restore brings back the previous shop's page with live React state
  //     and fires NO fetches — force a fresh load;
  // (2) returning to a backgrounded tab after logging into the other shop elsewhere
  //     — revalidate the session's vendor so the guard reloads before any action.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload() }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      fetch('/api/vendor/data?quick=1')
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (j) guardVendorSession(j.vendor?.id) })
        .catch(() => {})
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisible)
    return () => { window.removeEventListener('pageshow', onPageShow); document.removeEventListener('visibilitychange', onVisible) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { if (tab === 'sales') fetchSales() }, [tab, salesPeriod, salesBranch])
  useEffect(() => {
    if (!customerHistoryId) { setCustomerHistory(null); return }
    const controller = new AbortController()
    fetch(`/api/vendor/sales?customer_id=${customerHistoryId}`, { signal: controller.signal })
      .then(r => r.json()).then(j => setCustomerHistory(j.sales || []))
      .catch(e => { if (e.name !== 'AbortError') setCustomerHistory([]) })
    return () => controller.abort()
  }, [customerHistoryId])

  useEffect(() => {
    // Only load settings tab data once per session — fetchSettings() already runs on mount
    if (tab === 'settings' && !settingsTabLoadedRef.current) {
      settingsTabLoadedRef.current = true
      fetch('/api/vendor/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_change_request' })
      }).then(r => r.json()).then(j => {
        if (j.request) setPendingChangeRequest(j.request)
        else setPendingChangeRequest(null)
      }).catch(() => {})
    }
  }, [tab])

  const [staffRole, setStaffRole] = useState<string>('owner')
  const [canFileTax, setCanFileTax] = useState(true)

  // Safety net behind the sidebar role-gating: a cashier can only ever be on POS,
  // and a manager can't sit on the owner-only Settings tab (even via stale state).
  // VAT Filing is owner-only unless filing has been delegated.
  useEffect(() => {
    if (tab === 'tax') { if (staffRole !== 'owner' && !canFileTax) setTab('pos'); return }
    if (staffRole === 'cashier' && !['pos', 'receivables', 'cash', 'overview', 'suppliers', 'stocktake', 'imports'].includes(tab)) setTab('pos')
    else if (staffRole === 'manager' && tab === 'settings') setTab('pos')
  }, [staffRole, tab, canFileTax])

  async function fetchSettings() {
    try {
      const res = await fetch('/api/vendor/settings')
      if (res.ok) {
        const j = await res.json()
        if (!guardVendorSession(j.vendor?.id)) return
        if (j.settings) {
          // REPLACE (defaults + server settings), never merge into previous state:
          // merging let a stale invoice_mode from the previously-viewed shop survive
          // a vendor switch, rendering shop A's shell around shop B's data.
          setVendorSettings({ ...DEFAULT_VENDOR_SETTINGS, ...j.settings })
          // Load invoice entities for lk_tax vendors (WHEEL MART)
          if (j.settings.invoice_mode === 'lk_tax') fetchInvoiceEntities()
        }
        if (j.role) { setStaffRole(j.role); if (j.role === 'cashier') setTab('pos') }
        setCanFileTax(j.canFileTax === true)
      }
    } catch {}
  }

  async function fetchInvoiceEntities() {
    try {
      const res = await fetch('/api/vendor/invoice-entities')
      if (!res.ok) return
      const j = await res.json()
      setPosInvoiceEntities(j.entities || [])
    } catch {}
  }

  async function saveSettings() {
    setSettingsLoading(true)
    try {
      const res = await fetch('/api/vendor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_settings', settings: vendorSettings }) })
      if (res.ok) showToast('Settings saved!')
      else showToast('Failed to save settings')
    } catch { showToast('Error saving settings') }
    setSettingsLoading(false)
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('action', 'upload_logo')
      const res = await fetch('/api/vendor/settings', { method: 'POST', body: formData })
      if (res.ok) { const j = await res.json(); setVendorSettings({ ...vendorSettings, logo_url: j.logo_url }); showToast('Logo uploaded!') }
      else showToast('Upload failed')
    } catch { showToast('Upload error') }
    setLogoUploading(false)
  }

  async function changePassword() {
    if (passwordForm.new1 !== passwordForm.new2) { showToast('Passwords do not match'); return }
    if (passwordForm.new1.length < 6) { showToast('Password must be at least 6 characters'); return }
    setPasswordLoading(true)
    try {
      const res = await fetch('/api/vendor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'change_password', password: passwordForm.new1 }) })
      if (res.ok) { showToast('Password changed!'); setPasswordForm({ current: '', new1: '', new2: '' }) }
      else { const j = await res.json(); showToast(j.error || 'Failed') }
    } catch { showToast('Error changing password') }
    setPasswordLoading(false)
  }

  const shopInfoSaving = useRef(false)
  async function updateShopInfo(fields: any) {
    if (shopInfoSaving.current) return // double-tap guard — duplicate change requests
    shopInfoSaving.current = true
    try {
      const res = await fetch('/api/vendor/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_vendor', ...fields })
      })
      const j = await res.json()
      if (j.success) {
        if (j.pendingApproval) {
          showToast(j.message)
          fetch('/api/vendor/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'get_change_request' })
          }).then(r => r.json()).then(jr => {
            if (jr.request) setPendingChangeRequest(jr.request)
          }).catch(() => {})
        } else {
          showToast('Shop info updated!')
        }
        fetchData()
      } else {
        showToast('Error: ' + (j.error || 'Failed'))
      }
    } catch { showToast('Error updating shop info') }
    shopInfoSaving.current = false
  }

  // GRN / supplier / stocktake functions moved into _lk_tax/TabStock and _standard/TabStock components

  // Staff logins are handled entirely by _shared/StaffLogins (username,
  // password, role, branch scope, tax authority) — it loads and saves its own
  // data, so the page keeps no staff state of its own.

  // Returns false (after triggering a full reload) when an API response belongs to
  // a different vendor than this page first rendered — see sessionVendorIdRef.
  function guardVendorSession(vendorId: string | null | undefined): boolean {
    if (!vendorId) return true
    if (sessionVendorIdRef.current && sessionVendorIdRef.current !== vendorId) {
      window.location.reload()
      return false
    }
    sessionVendorIdRef.current = vendorId
    return true
  }

  async function fetchData(full?: boolean, silent?: boolean) {
    // silent=true: skip setLoading(true) so the full-page spinner doesn't flash and unmount
    // child components (e.g. POS after a sale). Data is still refreshed in the background.
    if (!silent) setLoading(true)
    setProductsLoading(true)
    try {
      // Fire both requests simultaneously — quick shows stats fast, full loads in parallel
      const quickPromise = fetch('/api/vendor/data?quick=1')
      const fullPromise = fetch('/api/vendor/data')

      // Phase 1: Quick load — vendor info + stats only (fast)
      const quickR = await quickPromise
      if (quickR.status === 401 || quickR.status === 403) { window.location.href = '/login'; return }
      if (quickR.ok) {
        const quickData = await quickR.json()
        if (!guardVendorSession(quickData?.vendor?.id)) return
        setData(quickData); if (!silent) setLoading(false)
      }

      // Phase 2: Full load — already in flight, just await the result
      const fullR = await fullPromise
      if (fullR.ok) {
        const fullData = await fullR.json()
        if (!guardVendorSession(fullData?.vendor?.id)) return
        setData(fullData)
      }
    } catch {}
    if (!silent) setLoading(false)
    setProductsLoading(false)
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

  async function fetchSales() {
    setSalesLoading(true)
    try {
      const r = await fetch(`/api/vendor/sales?period=${salesPeriod}${salesBranch ? `&branch=${salesBranch}` : ''}`)
      if (r.ok) setSalesData(await r.json())
      fetchAllDrafts()
      // Run cleanup once per session only (not on every fetchSales call — reduces DB write IO)
      if (!cleanupRanRef.current) {
        cleanupRanRef.current = true
        fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cleanup_void_drafts' }) }).catch(() => {})
      }
    } catch {}
    setSalesLoading(false)
  }
  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }
  async function handleSignOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = '/' }

  // saveAllStockChanges and saveStocktakeWithCost moved into _lk_tax/TabStock and _standard/TabStock components

  async function productAction(action: string, productId: string, updateData?: any) {
    setActionLoading(productId); try { const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, productId, data: updateData }) }); const j = await r.json(); if (j.success) { showToast(j.message); await fetchData(); setEditingProduct(null) } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setActionLoading(null)
  }
  async function uploadImagesForProduct(productId: string, images: File[]) {
    const BATCH = 10 // Upload 10 images in parallel
    for (let i = 0; i < images.length; i += BATCH) {
      const batch = images.slice(i, i + BATCH)
      await Promise.all(batch.map(async (img, j) => {
        const c = await compressImage(img)
        const fd = new FormData()
        fd.append('image', c)
        fd.append('productId', productId)
        fd.append('isPrimary', (i + j) === 0 ? 'true' : 'false')
        await fetch('/api/vendor/upload', { method: 'POST', body: fd })
      }))
    }
  }

  // Feature 3: Multi-select delete
  function toggleProductSelect(productId: string) {
    setSelectedProducts(prev => {
      const next = new Set(prev)
      next.has(productId) ? next.delete(productId) : next.add(productId)
      return next
    })
  }
  function toggleSelectAll(productList: any[]) {
    setSelectedProducts(prev => {
      if (prev.size === productList.length) return new Set()
      return new Set(productList.map((p: any) => p.id))
    })
  }
  async function deleteSelectedProducts() {
    if (!selectedProducts.size) return
    // Say up front how many of the selection can't go, rather than letting the
    // operator confirm a delete of 40 and be told afterwards that 31 stayed.
    const kept = products.filter((p: any) => selectedProducts.has(p.id) && p.in_history).length
    const goes = selectedProducts.size - kept
    if (goes === 0) {
      showToast(`None of these ${selectedProducts.size} can be deleted — they all appear on a sale, GRN or transfer. Hide them instead.`)
      return
    }
    if (!confirm(
      kept > 0
        ? `Delete ${goes} product${goes > 1 ? 's' : ''}? ${kept} of the ${selectedProducts.size} selected will be kept — they appear on a sale, GRN or transfer. This cannot be undone.`
        : `Delete ${goes} product${goes > 1 ? 's' : ''}? This cannot be undone.`
    )) return
    try {
      const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk_delete', productIds: [...selectedProducts] }) })
      const j = await r.json()
      if (j.success) {
        showToast(j.message)
        if (j.blocked?.length) j.blocked.slice(0, 3).forEach((b: string) => showToast('⚠️ ' + b))
        setSelectedProducts(new Set()); await fetchData()
      }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
  }

  // Feature 5: Image delete
  async function deleteProductImage(imageId: string) {
    if (!confirm('Delete this image?')) return
    setDeletingImageId(imageId)
    try {
      const r = await fetch('/api/vendor/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', imageId }) })
      const j = await r.json()
      if (j.success) { setEditProductImages(prev => prev.filter((img: any) => img.id !== imageId)); showToast('Image deleted') }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setDeletingImageId(null)
  }

  // Mark a thumbnail as new primary (doesn't save yet, just queues)
  function markAsPrimary(productId: string, imageId: string, allImages: any[]) {
    setPrimaryChanges(prev => {
      const next = new Map(prev)
      // If clicking the current primary (original), remove from changes
      const sorted = allImages.slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      if (sorted[0]?.id === imageId) { next.delete(productId); return next }
      next.set(productId, { imageId, images: allImages })
      return next
    })
  }

  // Save all primary image changes in batch
  async function saveAllPrimaryChanges() {
    if (primaryChanges.size === 0) return
    setActionLoading('saving-primary')
    let success = 0
    const entries = Array.from(primaryChanges.entries())
    await Promise.all(entries.map(async ([, { imageId, images }]) => {
      const sorted = images.slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
      const newOrder = [imageId, ...sorted.filter((img: any) => img.id !== imageId).map((img: any) => img.id)]
      try {
        const r = await fetch('/api/vendor/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', imageOrder: newOrder }) })
        const j = await r.json()
        if (j.success) success++
      } catch {}
    }))
    showToast(`${success} product${success > 1 ? 's' : ''} updated!`)
    setPrimaryChanges(new Map())
    setPrimaryMode(false)
    setActionLoading(null)
    await fetchData()
  }

  // Product handlers
  async function handleAddProduct(e: React.FormEvent) { e.preventDefault(); if (!newProduct.name.trim()) { showToast('Name required'); return }; setAddLoading(true); const partId = newProduct.partId.trim() || generatePartId(); try { const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', data: { ...newProduct, sku: partId } }) }); const j = await r.json(); if (j.success && j.product) { if (productImages.length > 0) { showToast('Uploading images...'); await uploadImagesForProduct(j.product.id, productImages) }; showToast('Product added!'); setNewProduct({ partId:'', name:'', description:'', category:'Other', make:'', model:'', modelCode:'', year:'', condition:'Reconditioned', side:'', color:'', oemCode:'', cost:'', price:'', quantity:'1', show_price:true, loc_store:'', loc_floor:'', loc_sub1:'', loc_sub2:'', product_type:'part', tyre_width:'', tyre_profile:'', tyre_rim:'', origin_country:'' }); setProductImages([]); setImagePreviews([]); await fetchData(); setTab('products') } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setAddLoading(false) }
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files || []); setProductImages(p => [...p, ...files]); files.forEach(f => { const r = new FileReader(); r.onload = ev => setImagePreviews(p => [...p, ev.target?.result as string]); r.readAsDataURL(f) }) }
  function removeImage(i: number) { setProductImages(p => p.filter((_, x) => x !== i)); setImagePreviews(p => p.filter((_, x) => x !== i)) }

  // Bulk handlers
  function handleBulkFileUpload(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; setBulkFile(f.name); setZipFiles([]); setZipSummary(null); const r = new FileReader(); r.onload = ev => { const rows = parseCSV(ev.target?.result as string).map(mapCSVRow); setBulkData(rows.map(row => ({ ...row, partId: row.partId || generatePartId(), autoId: !row.partId }))) }; r.readAsText(f) }
  async function handleZipUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    if (!files.length || bulkData.length === 0) { showToast('Upload CSV first'); return }
    setZipFiles(files.map(f => f.name))
    setZipProcessing(true)
    setZipProgress({ current: 0, total: files.length, label: 'Starting...', detail: '' })

    try {
      // Build ID map from CSV
      const idMap = new Map<string, number>()
      bulkData.forEach((r, i) => idMap.set(r.partId.toLowerCase(), i))

      // Start with clean image data
      const ud = bulkData.map(r => ({ ...r, imageFiles: [] as File[], hasImage: false, imageCount: 0 }))
      let totalMatched = 0, totalUnmatched = 0, totalImages = 0
      const allUnmatchedFolders: string[] = []

      // Process each ZIP one by one
      for (let zi = 0; zi < files.length; zi++) {
        const zipFile = files[zi]
        setZipProgress({ current: zi + 1, total: files.length, label: `Processing ZIP ${zi + 1} of ${files.length}`, detail: zipFile.name })

        const map = await extractZipImages(zipFile)
        let matched = 0, unmatched = 0

        for (const [folder, imageFiles] of map) {
          const idx = idMap.get(folder.toLowerCase())
          if (idx !== undefined) {
            // Append images (in case same product has images across multiple ZIPs)
            ud[idx].imageFiles = [...(ud[idx].imageFiles || []), ...imageFiles]
            ud[idx].hasImage = true
            ud[idx].imageCount = ud[idx].imageFiles.length
            matched++
            totalImages += imageFiles.length
          } else {
            unmatched++
            allUnmatchedFolders.push(folder)
          }
        }
        totalMatched += matched
        totalUnmatched += unmatched
      }

      setBulkData(ud)
      setZipSummary({ matched: totalMatched, unmatched: totalUnmatched, unmatchedFolders: allUnmatchedFolders, totalImages, zipCount: files.length })
      showToast(`${totalMatched} products matched from ${files.length} ZIP${files.length > 1 ? 's' : ''}`)
    } catch { showToast('ZIP processing error') }
    setZipProcessing(false)
    setZipProgress({ current: 0, total: 0, label: '', detail: '' })
  }
  function updateBulkRow(i: number, k: string, v: string) { setBulkData(p => { const u = [...p]; u[i] = { ...u[i], [k]: v }; return u }) }
  function removeBulkRow(i: number) { setBulkData(p => p.filter((_, x) => x !== i)) }
  async function handleBulkImport() {
    const importData = onlyWithImages ? bulkData.filter(r => r.hasImage) : bulkData; if (!importData.length) { showToast(onlyWithImages ? "No products with images" : "No products"); return }
    const noImg = importData.filter(r => !r.hasImage).length
    if (noImg > 0 && !confirm(noImg + ' without images. Continue?')) return

    setBulkProgress({ current: 0, total: importData.length, phase: 'Checking for duplicates...', detail: '' })
    setBulkLoading(true)

    try {
      const skus = importData.map(r => r.partId).filter(Boolean)
      const checkRes = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk_check_skus', skus }) })
      const checkJson = await checkRes.json()

      if (checkJson.duplicates && checkJson.duplicates.length > 0) {
        setBulkDuplicates(checkJson.duplicates)
        setShowDuplicateModal(true)
        setBulkLoading(false)
        setBulkProgress({ current: 0, total: 0, phase: '', detail: '' })
        return
      }

      await executeBulkImport('skip')
    } catch {
      showToast('Network error')
      setBulkLoading(false)
      setBulkProgress({ current: 0, total: 0, phase: '', detail: '' })
    }
  }

  async function executeBulkImport(mode: 'skip' | 'update') {
    setShowDuplicateModal(false)
    setBulkLoading(true)
    let wakeLock: any = null
    try { wakeLock = await (navigator as any).wakeLock?.request("screen") } catch {}
    const importData = onlyWithImages ? bulkData.filter(r => r.hasImage) : bulkData; const totalSteps = importData.length + 1

    try {
      setBulkProgress({ current: 0, total: totalSteps, phase: 'Creating products...', detail: 'Sending product data to server' })

      const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'bulk_create', mode,
        products: importData.map(row => ({ sku: row.partId, added_date: row.addedDate || '', name: row.name, description: row.description, category: row.category, make: row.make, model: row.model, model_code: row.modelCode || null, year: row.year, condition: row.condition, side: row.side || null, color: row.color || null, oem_code: row.oemCode || null, cost: row.cost ? parseInt(row.cost) : null, price: row.price, quantity: row.quantity, show_price: row.show_price, loc_store: row.loc_store || null, loc_floor: row.loc_floor || null, loc_sub1: row.loc_sub1 || null, loc_sub2: row.loc_sub2 || null, product_type: row.product_type || null, tyre_width: row.tyre_width || null, tyre_profile: row.tyre_profile || null, tyre_rim: row.tyre_rim || null, origin_country: row.origin_country || null }))
      }) })
      const j = await r.json()

      if (!j.success) { showToast('Error: ' + j.error); setBulkLoading(false); setBulkProgress({ current: 0, total: 0, phase: '', detail: '' }); return }

      setBulkProgress(prev => ({ ...prev, current: 1, phase: 'Uploading images...', detail: `${j.count} products created` }))

      let imageCount = 0; let productsProcessed = 0; const productsWithImages = importData.filter(r => r?.imageFiles?.length).length
      const skuToId = new Map()
      if (j.products) j.products.forEach((p: any) => skuToId.set(p.sku, p.id))

      const PRODUCT_BATCH = 15 // Process 15 products' images in parallel
      const productsToUpload = importData.filter(r => r?.imageFiles?.length && skuToId.get(r.partId))
      for (let i = 0; i < productsToUpload.length; i += PRODUCT_BATCH) {
        const batch = productsToUpload.slice(i, i + PRODUCT_BATCH)

        setBulkProgress(prev => ({
          ...prev,
          current: 1 + Math.round((productsProcessed / Math.max(productsWithImages, 1)) * (totalSteps - 1)),
          phase: 'Uploading images...',
          detail: `Products ${i + 1}-${Math.min(i + PRODUCT_BATCH, productsToUpload.length)} of ${productsToUpload.length}`
        }))

        await Promise.all(batch.map(async (row) => {
          const productId = skuToId.get(row.partId)
          await uploadImagesForProduct(productId, row.imageFiles)
          imageCount += row.imageFiles.length
        }))
        productsProcessed += batch.length
      }

      setBulkProgress({ current: totalSteps, total: totalSteps, phase: 'Complete!', detail: '' })

      const summary = []
      if (j.insertedCount) summary.push(`${j.insertedCount} new`)
      if (j.updatedCount) summary.push(`${j.updatedCount} updated`)
      if (j.skippedCount) summary.push(`${j.skippedCount} skipped`)
      if (imageCount) summary.push(`${imageCount} images`)
      showToast(summary.join(', ') + ' — Import complete!')

      setBulkData([]); setBulkFile(''); setZipFiles([]); setZipSummary(null); setBulkDuplicates([])
      await fetchData(); setTab('products')
    } catch { showToast('Import failed') }

    setBulkLoading(false)
    try { wakeLock?.release() } catch {}
    setTimeout(() => setBulkProgress({ current: 0, total: 0, phase: '', detail: '' }), 3000)
  }

  // Retry missing images - find products with 0 images and re-upload from ZIP
  async function retryMissingImages() {
    if (!bulkData.length) { showToast('Load CSV & ZIP first'); return }
    const products = data?.products || []
    const productsWithoutImages = products.filter((p: any) => !p.images || p.images.length === 0)
    if (!productsWithoutImages.length) { showToast('All products have images!'); return }

    const productsToRetry = bulkData.filter(r => {
      if (!r.imageFiles?.length) return false
      return productsWithoutImages.some((p: any) => p.sku === r.partId)
    })

    if (!productsToRetry.length) { showToast('No matching images found in ZIP for products missing images'); return }

    if (!confirm(`Found ${productsWithoutImages.length} products without images. ${productsToRetry.length} have matching images in the ZIP. Upload now?`)) return

    setBulkLoading(true)
    let wakeLock: any = null
    try { wakeLock = await (navigator as any).wakeLock?.request("screen") } catch {}

    const skuToId = new Map()
    products.forEach((p: any) => skuToId.set(p.sku, p.id))

    const PRODUCT_BATCH = 10
    let imageCount = 0
    const totalSteps = productsToRetry.length + 1

    try {
      for (let i = 0; i < productsToRetry.length; i += PRODUCT_BATCH) {
        const batch = productsToRetry.slice(i, i + PRODUCT_BATCH)
        setBulkProgress({
          current: i + 1,
          total: totalSteps,
          phase: 'Retrying missing images...',
          detail: `Products ${i + 1}-${Math.min(i + PRODUCT_BATCH, productsToRetry.length)} of ${productsToRetry.length}`
        })

        await Promise.all(batch.map(async (row) => {
          const productId = skuToId.get(row.partId)
          if (productId) {
            await uploadImagesForProduct(productId, row.imageFiles)
            imageCount += row.imageFiles.length
          }
        }))
      }

      setBulkProgress({ current: totalSteps, total: totalSteps, phase: 'Complete!', detail: '' })
      showToast(`Uploaded ${imageCount} images for ${productsToRetry.length} products`)
      await fetchData()
    } catch { showToast('Retry failed') }

    setBulkLoading(false)
    try { wakeLock?.release() } catch {}
    setTimeout(() => setBulkProgress({ current: 0, total: 0, phase: '', detail: '' }), 3000)
  }

  // Hand the selected products to the POS screen as a fresh cart. The POS tab
  // (TabPOSLkTax/Standard) loads its cart from pendingPosDraft — it does NOT read
  // page.tsx state — so this is the only channel that actually populates it.
  // Starts a new sale (draftId '') with those items; add more via POS search.
  function sendProductsToPos(prods: any[]) {
    const sel = (prods || []).filter((p: any) => p && p.quantity > 0)
    if (!sel.length) { showToast('No in-stock products selected'); return }
    const items = sel.map((p: any) => ({
      productId: p.id, productName: p.name, productSku: p.sku || '',
      quantity: 1, unitPrice: p.price || 0, unitCost: p.cost || 0, cost: p.cost || 0,
      maxStock: p.quantity,
    }))
    if (vendorSettings?.invoice_mode === 'lk_tax') {
      // WHEEL MART: APPEND to whatever is already in the POS cart (don't clobber)
      setPendingAddItems(items)
    } else {
      // Sakura: replace (the only channel its POS reads)
      setPendingPosDraft({
        cart: items,
        customer: { id: null, name: '', phone: '', advance: 0, outstanding: 0, require_vehicle_no: false },
        vehicleNo: '', draftId: '', draftInvoiceNo: '',
      })
    }
    setTab('pos')
    showToast(`${sel.length} item${sel.length > 1 ? 's' : ''} added to POS`)
  }

  // lk_tax computed values (used in Settings, tab conditionals)
  const isLkTax = vendorSettings?.invoice_mode === 'lk_tax'
  // WHEEL MART prices are VAT-inclusive but the Pvt Ltd only keeps the ex-VAT
  // slice — GP%/below-cost must be judged on that, or a loss-making price can
  // look profitable. Sakura (no VAT) keeps the full price.
  const marginBase = (price: any) => isLkTax ? netOfVat(price, Number(vendorSettings?.vat_rate) || 18) : (Number(price) || 0)
  // Cost is stored net; a price quoted over the counter is VAT-inclusive. This
  // is the floor in the SAME currency the customer hears, so nobody quotes
  // under it by mistake.
  // Gross up by the rate that ACTUALLY applied to this product's cost — a
  // purchase from a non-VAT supplier carries none. Pass the product, not a
  // bare number, so the rate travels with it.
  const costFloor = (p: any) => productCostIncVat(typeof p === 'object' && p !== null ? p : { cost: p })
  const costVatLabel = (p: any): string => (costHasVat(p) ? ' incl VAT' : '')

  async function handleReturn(refundMethod: 'advance' | 'cash') {
    if (!returnModal) return
    const items = Object.entries(returnItems).filter(([, qty]) => qty > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }))
    if (items.length === 0) { showToast('Select items to return'); return }
    setReturnLoading(true)
    try {
      if (returnModal.tax_serial) {
        // ── Tax invoice: issue Credit Note (single step — handles stock, CRN, payment) ──
        const r = await fetch('/api/vendor/credit-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            saleId: returnModal.id,
            returnedItems: items,
            reason: returnReason.trim() || 'goods_returned',
            refundMethod,
          }),
        })
        const j = await r.json()
        if (r.ok) {
          showToast('✅ Credit Note ' + j.creditNoteNo + ' issued')
          setIssuedCreditNote(j.creditNote)
          setReturnModal(null); setReturnItems({}); setReturnReason('')
          fetchSales(); fetchData()
        } else {
          showToast('⚠️ ' + (j.error || 'Failed to issue credit note'))
        }
      } else {
        // ── Receipt: direct return (no credit note required) ──
        const payload: Record<string, unknown> = { action: 'return_items', saleId: returnModal.id, returnItems: items, refundMethod }
        if (returnReason.trim()) payload.return_reason = returnReason.trim()
        const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        const j = await r.json()
        if (j.success) {
          showToast(j.message)
          fetchSales(); fetchData()
          setReturnModal(null); setReturnItems({}); setReturnReason('')
        } else showToast('Error: ' + j.error)
      }
    } catch { showToast('Network error') }
    setReturnLoading(false)
  }

  async function issueCreditNote() {
    if (!pendingCreditNote) return
    setCreditNoteLoading(true)
    try {
      const r = await fetch('/api/vendor/credit-notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          saleId: pendingCreditNote.saleId,
          returnedItems: pendingCreditNote.returnedItems,
          reason: 'goods_returned',
        }),
      })
      const j = await r.json()
      if (r.ok) { setIssuedCreditNote(j.creditNote); setPendingCreditNote(null) }
      else showToast('⚠️ ' + (j.error || 'Failed to issue credit note'))
    } catch { showToast('Network error') }
    setCreditNoteLoading(false)
  }

  function printCreditNote(cn: any, entityInfo?: any) {
    const vatRate = 18
    const itemRows = (cn.items || []).map((i: any) =>
      `<tr>
        <td style="padding:6px 8px">${i.product_name}</td>
        <td style="padding:6px 8px;text-align:center">${i.quantity}</td>
        <td style="padding:6px 8px;text-align:right">Rs.${parseInt(i.unit_price).toLocaleString()}</td>
        <td style="padding:6px 8px;text-align:right">Rs.${parseInt(i.total).toLocaleString()}</td>
      </tr>`).join('')
    const total     = parseInt(cn.total || 0)
    const vatAmount = parseInt(cn.vat_amount || 0)
    const netAmount = parseInt(cn.net_amount || 0)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Credit Note ${cn.credit_note_no}</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:Arial,sans-serif;font-size:12px;color:#000;padding:20mm}
        .title{font-size:22px;font-weight:900;letter-spacing:1px;text-align:center;margin-bottom:4px}
        .subtitle{font-size:11px;text-align:center;color:#555;margin-bottom:16px}
        .parties{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px}
        .party-box{border:1px solid #ccc;border-radius:4px;padding:10px}
        .party-label{font-size:9px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:4px}
        .meta{display:flex;gap:24px;margin-bottom:16px;font-size:11px}
        .meta span{color:#555}
        .meta strong{color:#000}
        table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:16px}
        thead tr{background:#f0f0f0}
        th{padding:6px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase}
        tbody tr{border-top:1px solid #eee}
        .totals{margin-left:auto;width:260px;font-size:12px}
        .totals tr td{padding:4px 8px}
        .totals tr.grand td{font-weight:900;font-size:14px;border-top:2px solid #000;padding-top:6px}
        .ref-box{background:#fff8e1;border:1px solid #f9a825;border-radius:4px;padding:10px;font-size:11px;margin-bottom:16px}
        .footer{font-size:10px;color:#888;text-align:center;margin-top:24px;border-top:1px solid #eee;padding-top:12px}
        @media print{@page{size:A4;margin:15mm}}
      </style></head><body>
      <div class="title">CREDIT NOTE</div>
      <div class="subtitle">This is not a tax invoice</div>

      <div class="ref-box">
        <strong>Against Tax Invoice:</strong> ${cn.original_serial} &nbsp;|&nbsp;
        <strong>Reason:</strong> ${cn.reason === 'goods_returned' ? 'Goods Returned' : cn.reason || 'Goods Returned'}
      </div>

      <div class="parties">
        <div class="party-box">
          <div class="party-label">Supplier</div>
          <div style="font-weight:700">${entityInfo?.name || 'MacForce Auto Engineering (Pvt) Ltd'}</div>
          <div>${entityInfo?.address || ''}</div>
          <div>TIN: ${entityInfo?.tin || ''}</div>
        </div>
        <div class="party-box">
          <div class="party-label">Purchaser</div>
          <div style="font-weight:700">${cn.customer_name || ''}</div>
          <div>${cn.customer_address || ''}</div>
          ${cn.customer_tin ? `<div>TIN: ${cn.customer_tin}</div>` : ''}
        </div>
      </div>

      <div class="meta">
        <div><span>Credit Note No: </span><strong>${cn.credit_note_no}</strong></div>
        <div><span>Date Issued: </span><strong>${new Date(cn.issued_at).toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' })}</strong></div>
      </div>

      <table>
        <thead><tr>
          <th>Description</th><th style="text-align:center">Qty</th>
          <th style="text-align:right">Unit Price</th><th style="text-align:right">Amount</th>
        </tr></thead>
        <tbody>${itemRows}</tbody>
      </table>

      <table class="totals">
        <tr><td>Net Amount (excl. VAT @ ${vatRate}%)</td><td style="text-align:right">Rs.${netAmount.toLocaleString()}</td></tr>
        <tr><td>VAT @ ${vatRate}%</td><td style="text-align:right">Rs.${vatAmount.toLocaleString()}</td></tr>
        <tr class="grand"><td>Total Credit</td><td style="text-align:right">Rs.${total.toLocaleString()}</td></tr>
      </table>

      <div class="footer">
        MacForce Auto Engineering (Pvt) Ltd · TIN: ${entityInfo?.tin || ''}<br/>
        Generated ${new Date().toLocaleString('en-LK')} · Retain for 5 years
      </div>
      <script>window.onload=()=>{window.print();setTimeout(()=>window.close(),1200)}</script>
    </body></html>`
    const w = window.open('', '_blank', 'width=800,height=700')
    if (w) { w.document.write(html); w.document.close() }
  }

  // ── Promote a proprietor receipt to a Pvt Ltd tax invoice ────────────────
  // Checked first, so the numbering consequences are shown before the operator
  // commits rather than discovered in the ledger afterwards.
  async function openPromote(sale: any) {
    setPromoteSale(sale); setPromoteCheck(null)
    try {
      const r = await fetch(`/api/vendor/sales?action=promote_check&id=${sale.id}`)
      setPromoteCheck(await r.json())
    } catch { showToast('Network error'); setPromoteSale(null) }
  }

  // Asked once per session rather than per row: the answer is about the user,
  // not the sale.
  useEffect(() => {
    if (!isLkTax) return
    fetch('/api/vendor/sales?action=reverse_permission')
      .then(r => r.ok ? r.json() : null)
      .then(j => setMayReverse(!!j?.allowed))
      .catch(() => {})
  }, [isLkTax])

  async function openReverse(sale: any) {
    setReverseSale(sale); setReverseCheck(null); setReverseReason('')
    try {
      const r = await fetch(`/api/vendor/sales?action=reverse_check&id=${sale.id}`)
      setReverseCheck(await r.json())
    } catch { showToast('Network error'); setReverseSale(null) }
  }

  async function confirmReverse() {
    if (!reverseSale) return
    setReversing(true)
    try {
      const r = await fetch('/api/vendor/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse_promotion', saleId: reverseSale.id, reason: reverseReason }),
      })
      const j = await r.json()
      if (j.success) { showToast('↩ ' + j.message); setReverseSale(null); fetchSales(); fetchData() }
      else showToast('⚠️ ' + (j.error || 'Could not reverse'))
    } catch { showToast('Network error') }
    setReversing(false)
  }

  async function confirmPromote() {
    if (!promoteSale) return
    setPromoting(true)
    try {
      const r = await fetch('/api/vendor/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'promote_to_tax_invoice', saleId: promoteSale.id, acknowledgeWarnings: true }),
      })
      const j = await r.json()
      if (j.success) { showToast('✅ ' + j.message); setPromoteSale(null); fetchSales(); fetchData() }
      else showToast('⚠️ ' + (j.error || 'Could not promote'))
    } catch { showToast('Network error') }
    setPromoting(false)
  }

  async function voidSale(saleId: string, refundMethod: 'advance' | 'cash') {
    setVoidModal(null)
    try {
      const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void_sale', saleId, refundMethod }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); fetchSales(); fetchData() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
  }

  // ─── REPORT GENERATORS ───
  function generateDailyReport(salesList: any[], vendorInfo: any, reportDate: string, settings?: any, collections?: any[], returns?: any[], cashSession?: any, corrections?: any[], dayExpenses?: any[], cashMovements?: any[], dayWriteoffs?: any[], dayCreditNotes?: any[], daySupplierCredits?: any[], stockAdjustments?: any[], retroactive?: any[]) {
    // Everything is pinned to the Colombo calendar day it happened on. The fetch
    // spans two UTC days (for the +5:30 offset), so sales, collections AND returns
    // must each be filtered to reportDate or yesterday's leak into today.
    const filtered = salesList.filter((s: any) => {
      if (s.payment_status === 'voided') return false
      if (s.payment_status === 'draft') return false // on-approval drafts aren't revenue yet
      // Exclude opening balance entries — not real sales
      if ((s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')) return false
      return colomboBusinessDay(s.created_at) === reportDate
    })
    const dayCollections = (collections || []).filter((c: any) => colomboBusinessDay(c.created_at) === reportDate)
    const totalCollections = dayCollections.reduce((s: number, c: any) => s + c.amount, 0)

    // Only REAL money-out refunds (cash/cheque/bank/card) belong here.
    // credit_return rows are receivable adjustments — no cash moves, ever:
    // same-day returns are already reflected in sale.total / the voided sale
    // being excluded from gross, and old-invoice credit returns just reduce
    // the customer's balance. Counting them showed "Net Sales Rs.0" and a
    // phantom "Cash Refund" after a same-day full return of a credit sale.
    const allReturns = (returns || []).filter((r: any) => colomboBusinessDay(r.created_at) === reportDate)
    const cashReturns = allReturns.filter((r: any) => r.payment_method !== 'credit_return')
    // EVERY return raised today reduces today, whichever day the goods were
    // sold on. A sale no longer shrinks when its goods come back, so this is
    // the only place the reversal is counted — and it lands in the period that
    // pays for it, which is what commission on a 25th–24th cycle needs.
    // Deducting only cash refunds used to count a refund twice: once here, and
    // again when the original sale was quietly rewritten downwards.
    const totalReturnAmount = allReturns.reduce((s: number, r: any) => s + r.amount, 0)

    const totalSales = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.total || 0), 0)
    const netSales = totalSales - totalReturnAmount
    const totalCredit = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)

    // Payment method breakdown from actual payments.
    // Advance is pre-collected money (received on a prior day) — track it separately so it
    // doesn't inflate today's "Collected" cash figure or appear in Payment Methods.
    const methodTotals: Record<string, number> = { cash: 0, cheque: 0, bank: 0, card: 0 }
    let totalAdvanceApplied = 0
    filtered.forEach((sale: any) => {
      if (sale.payments && sale.payments.length > 0) {
        sale.payments.forEach((p: any) => {
          const method = p.payment_method || 'cash'
          const amt = parseFloat(p.amount || 0)
          if (amt <= 0) return // skip negative (refund) entries
          if (method === 'advance') { totalAdvanceApplied += amt }
          else if (['cash','cheque','bank','card'].includes(method)) { methodTotals[method] = (methodTotals[method] || 0) + amt }
        })
      } else if (parseFloat(sale.paid_amount || 0) > 0) {
        const method = sale.payment_method || 'cash'
        const amt = parseFloat(sale.paid_amount || 0)
        if (method === 'advance') { totalAdvanceApplied += amt }
        else { methodTotals[method] = (methodTotals[method] || 0) + amt }
      }
    })
    // Collected = actual new cash/cheque/bank received today (excludes advance draw-downs)
    const totalCashCollected = Object.values(methodTotals).reduce((s, v) => s + v, 0)

    const shopName = escapeHtml(settings?.invoice_title || vendorInfo?.name) || 'kuruma.lk'
    const dateStr = new Date(reportDate).toLocaleDateString('en-LK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Daily Report - ${reportDate}</title>
<style>@page{size:A4;margin:15mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#333;max-width:800px;margin:0 auto}
.header{text-align:center;padding:20px 0;border-bottom:3px solid #ff6b35}.shop{font-size:24px;font-weight:900}.date{font-size:14px;color:#666;margin-top:4px}.report-title{font-size:18px;font-weight:800;color:#ff6b35;margin-top:8px;text-transform:uppercase;letter-spacing:1px}
.summary{display:flex;gap:12px;margin:20px 0;flex-wrap:wrap}.summary-box{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:15px;text-align:center}.summary-box .val{font-size:22px;font-weight:900}.summary-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.green{color:#16a34a}.red{color:#dc2626}.orange{color:#ff6b35}.blue{color:#2563eb}
table{width:100%;border-collapse:collapse;margin:15px 0}th{background:#f1f5f9;text-align:left;font-size:11px;font-weight:700;padding:10px 8px;border-bottom:2px solid #e2e8f0;text-transform:uppercase}td{padding:10px 8px;font-size:12px;border-bottom:1px solid #f1f5f9}.text-right{text-align:right}
.method-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:15px 0}.method-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}.method-box .val{font-size:18px;font-weight:900}.method-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.footer{text-align:center;padding:20px 0;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;margin-top:20px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div class="header"><div class="shop">${shopName}</div>${vendorInfo?.location ? '<div style="font-size:12px;color:#666">' + escapeHtml(vendorInfo.location) + (vendorInfo?.phone ? ' | Tel: ' + escapeHtml(vendorInfo.phone) : '') + '</div>' : ''}<div class="report-title">Daily Sales Report</div><div class="date">${dateStr}</div><div style="font-size:10px;color:#999;margin-top:4px">All sales for the calendar day (Asia/Colombo)</div></div>

<div class="summary">
<div class="summary-box">${totalReturnAmount > 0
  ? '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:1px">Gross Sales</div><div class="val orange">Rs.' + totalSales.toLocaleString() + '</div><div style="font-size:11px;color:#dc2626;font-weight:700;margin-top:6px">&minus; Rs.' + totalReturnAmount.toLocaleString() + ' Returned today</div>'
  : '<div class="val orange">Rs.' + netSales.toLocaleString() + '</div><div class="lbl">Net Sales</div>'
}</div>
${totalReturnAmount > 0 ? '<div class="summary-box" style="border:2px solid #ff6b35"><div class="val orange">Rs.' + netSales.toLocaleString() + '</div><div class="lbl">Net Sales</div></div>' : ''}
<div class="summary-box"><div class="val green">Rs.${totalCashCollected.toLocaleString()}</div><div class="lbl">Collected</div></div>
<div class="summary-box"><div class="val red">Rs.${totalCredit.toLocaleString()}</div><div class="lbl">On Credit</div></div>
</div>

${(methodTotals.cash + methodTotals.cheque + methodTotals.bank + methodTotals.card) > 0 ? `
<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Payment Methods</h3>
<div class="method-grid">
${methodTotals.cash > 0 ? '<div class="method-box"><div class="val green">Rs.' + methodTotals.cash.toLocaleString() + '</div><div class="lbl">💵 Cash</div></div>' : ''}
${methodTotals.cheque > 0 ? '<div class="method-box"><div class="val blue">Rs.' + methodTotals.cheque.toLocaleString() + '</div><div class="lbl">📝 Cheque</div></div>' : ''}
${methodTotals.bank > 0 ? '<div class="method-box"><div class="val" style="color:#7c3aed">Rs.' + methodTotals.bank.toLocaleString() + '</div><div class="lbl">🏦 Bank Transfer</div></div>' : ''}
${methodTotals.card > 0 ? '<div class="method-box"><div class="val" style="color:#0891b2">Rs.' + methodTotals.card.toLocaleString() + '</div><div class="lbl">💳 Card</div></div>' : ''}
</div>` : ''}

${(() => {
      // Cash reconciliation for the day (from the cash session, if one was opened).
      // undefined = caller didn't provide one (e.g. Sakura, which has no cash
      // sessions) → omit the section entirely. null = WHEEL MART looked, none open.
      if (cashSession === undefined) return ''
      if (!cashSession) {
        return '<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Cash Reconciliation</h3>' +
          '<p style="font-size:12px;color:#94a3b8;margin:4px 0 12px">No cash session was opened for this day.</p>'
      }
      const opening  = parseInt(cashSession.opening_balance || 0)
      const expected = cashSession.expected_cash != null ? parseInt(cashSession.expected_cash) : null
      const counted  = cashSession.closing_balance != null ? parseInt(cashSession.closing_balance) : null
      const variance = cashSession.variance != null ? parseInt(cashSession.variance)
        : (counted != null && expected != null ? counted - expected : null)
      const isClosed = cashSession.status === 'closed'
      return '<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Cash Reconciliation</h3>' +
        '<div class="method-grid">' +
          '<div class="method-box"><div class="val blue">Rs.' + opening.toLocaleString() + '</div><div class="lbl">Opening Float</div></div>' +
          (expected != null ? '<div class="method-box"><div class="val orange">Rs.' + expected.toLocaleString() + '</div><div class="lbl">Expected in Drawer</div></div>' : '') +
          (isClosed && counted != null
            ? '<div class="method-box"><div class="val green">Rs.' + counted.toLocaleString() + '</div><div class="lbl">Counted</div></div>' +
              (variance != null ? '<div class="method-box"><div class="val ' + (variance === 0 ? 'green' : (variance < 0 ? 'red' : 'orange')) + '">' + (variance > 0 ? '+' : variance < 0 ? '−' : '') + 'Rs.' + Math.abs(variance).toLocaleString() + '</div><div class="lbl">' + (variance === 0 ? 'Balanced' : (variance < 0 ? 'Short' : 'Over')) + '</div></div>' : '')
            : '<div class="method-box"><div class="val" style="color:#94a3b8">OPEN</div><div class="lbl">Not yet closed</div></div>') +
        '</div>' +
        // When the drawer was opened and counted. The figures can't show that
        // a drawer was counted the NEXT morning — the times can, and a count
        // done the next day means the evening's cash sat unchecked overnight.
        (() => {
          const t = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' }) : null
          const d = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }) : null
          const openT = t(cashSession.opened_at)
          const closeT = t(cashSession.closed_at)
          if (!openT && !closeT) return ''
          const closedNextDay = cashSession.closed_at && d(cashSession.closed_at) !== reportDate
          let line = 'Drawer opened ' + (openT || '—')
          if (closeT) line += ' · counted ' + closeT + (closedNextDay ? ' on ' + d(cashSession.closed_at) : '')
          else line += ' · not yet counted'
          return '<p style="font-size:10px;color:#94a3b8;margin:4px 0 0">' + line + '</p>' +
            (closedNextDay
              ? '<p style="font-size:10px;color:#b45309;font-weight:bold;margin:2px 0 0">⚠ Counted the next day — the evening\'s cash sat unchecked overnight. Count at close of business.</p>'
              : '')
        })() +
        // Money moved (owner/bank/till) — not income, not expense, but the
        // drawer follows it, so the report says so in plain words.
        (() => {
          const movs = cashMovements || []
          if (movs.length === 0) return ''
          const LABEL: Record<string, string> = {
            owner_in: 'Owner put money in', bank_in: 'Drawn from bank',
            to_bank: 'Banked to account', owner_out: 'Owner took drawings',
          }
          return '<div style="margin-top:10px;border:1.5px solid #bae6fd;background:#f0f9ff;border-radius:8px;padding:10px 12px">' +
            '<div style="font-size:12px;font-weight:800;color:#075985;margin-bottom:6px">Money moved (not sales, not expenses)</div>' +
            movs.map((m: any) => {
              const isIn = m.type === 'owner_in' || m.type === 'bank_in'
              return '<div style="display:flex;justify-content:space-between;font-size:11px;color:#0c4a6e;padding:2px 0">' +
                '<span>\u2022 ' + escapeHtml(LABEL[m.type] || m.type) + (m.note ? '<span style="color:#64748b"> \u2014 ' + escapeHtml(String(m.note)) + '</span>' : '') + '</span>' +
                '<span style="font-weight:700">' + (isIn ? '+' : '\u2212') + 'Rs.' + parseInt(m.amount || 0).toLocaleString() + '</span></div>'
            }).join('') +
            '</div>'
        })() +
        // Expected cash falls below the opening float whenever money is paid
        // out. List every one of those payments, or the drop is unexplained.
        (() => {
          const cashOut = (dayExpenses || []).filter((e: any) => (e.payment_method || 'cash') === 'cash')
          if (cashOut.length === 0) return ''
          const total = cashOut.reduce((sum: number, e: any) => sum + parseInt(e.amount || 0), 0)
          return '<div style="margin-top:10px;border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 12px">' +
            '<div style="font-size:12px;font-weight:800;color:#334155;margin-bottom:6px">Cash paid out of the drawer \u2014 Rs.' + total.toLocaleString() + ' (' + cashOut.length + ')</div>' +
            cashOut.map((e: any) =>
              '<div style="display:flex;justify-content:space-between;font-size:11px;color:#475569;padding:2px 0">' +
              '<span>\u2022 ' + escapeHtml(String(e.description || '')) + '<span style="color:#94a3b8"> \u00b7 ' + escapeHtml(String(e.category || '')) + '</span></span>' +
              '<span style="font-weight:700">Rs.' + parseInt(e.amount || 0).toLocaleString() + '</span></div>'
            ).join('') +
            '</div>'
        })() +
        // Post-close corrections are an audit matter: a hand adjustment is how a
        // real shortage could be papered over, so the owner sees every one here.
        ((corrections && corrections.length > 0)
          ? '<div style="margin-top:10px;border:1.5px solid #f59e0b;background:#fffbeb;border-radius:8px;padding:10px 12px">' +
            '<div style="font-size:12px;font-weight:800;color:#92400e;margin-bottom:6px">\u26a0\ufe0f Cash corrections made after closing (' + corrections.length + ')</div>' +
            corrections.map((c: any) => {
              const d = c.detail || {}
              const what = c.action === 'adjust' ? (d.kind === 'in' ? 'Cash in recorded late' : 'Cash out recorded late')
                : c.action === 'set_opening' ? 'Opening balance changed'
                : c.action === 'accept_variance' ? 'Difference accepted as real'
                : c.action
              const amt = d.amount != null ? ' Rs.' + parseInt(d.amount).toLocaleString() : ''
              const varTxt = (d.variance_before != null && d.variance_after != null)
                ? ' \u00b7 variance ' + parseInt(d.variance_before).toLocaleString() + ' \u2192 ' + parseInt(d.variance_after).toLocaleString() : ''
              return '<div style="font-size:11px;color:#78350f;padding:2px 0">\u2022 ' + escapeHtml(what) + escapeHtml(amt) + ' \u2014 by ' + escapeHtml(c.actor || 'unknown') + escapeHtml(varTxt) + (d.note ? ' \u2014 "' + escapeHtml(String(d.note)) + '"' : '') + '</div>'
            }).join('') +
            '</div>'
          : '')
    })()}

${((dayCreditNotes || []).length > 0 || (daySupplierCredits || []).length > 0) ? (() => {
      // Both directions on one section. Neither moves cash — say so, or the
      // figures get read against the till and the drawer never balances.
      const outTot = (dayCreditNotes || []).reduce((t: number, c: any) => t + parseInt(c.total || c.total_amount || 0), 0)
      const inTot  = (daySupplierCredits || []).reduce((t: number, c: any) => t + parseInt(c.total_amount || 0), 0)
      return '<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Credit Notes</h3>' +
        '<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 12px">' +
        ((dayCreditNotes || []).length > 0
          ? '<div style="font-size:11px;font-weight:800;color:#1e40af;margin-bottom:3px">Issued to customers \u2014 reduces sales</div>' +
            (dayCreditNotes || []).map((c: any) =>
              '<div style="font-size:12px;color:#1e3a8a;padding:2px 0">\u2022 <strong>' + escapeHtml(c.credit_note_no || '') + '</strong> \u00b7 ' +
              escapeHtml(c.customer_name || 'Walk-in') + ' \u00b7 against ' + escapeHtml(c.original_serial || '') +
              ' \u2014 Rs.' + parseInt(c.total || c.total_amount || 0).toLocaleString() + '</div>').join('') +
            '<div style="font-size:12px;font-weight:800;color:#1e40af;padding:2px 0">Total credited to customers: Rs.' + outTot.toLocaleString() + '</div>'
          : '') +
        ((daySupplierCredits || []).length > 0
          ? '<div style="font-size:11px;font-weight:800;color:#166534;margin:6px 0 3px">Received from suppliers \u2014 reduces what we owe</div>' +
            (daySupplierCredits || []).map((c: any) =>
              '<div style="font-size:12px;color:#166534;padding:2px 0">\u2022 <strong>' + escapeHtml(c.credit_note_no || '') + '</strong> \u00b7 ' +
              escapeHtml(c.supplier?.name || '') + ' \u00b7 ' + escapeHtml(String(c.reason || '').replace(/_/g, ' ')) +
              ' \u2014 Rs.' + parseInt(c.total_amount || 0).toLocaleString() +
              (parseInt(c.vat_amount || 0) > 0 ? ' (incl VAT Rs.' + parseInt(c.vat_amount).toLocaleString() + ')' : '') + '</div>').join('') +
            '<div style="font-size:12px;font-weight:800;color:#166534;padding:2px 0">Total credited by suppliers: Rs.' + inTot.toLocaleString() + '</div>'
          : '') +
        '<div style="font-size:10px;color:#475569;margin-top:4px">No cash moved either way \u2014 do not read these against the drawer.</div>' +
        '</div>'
    })() : ''}

${(dayWriteoffs || []).length > 0 ? (() => {
      const woTotal = (dayWriteoffs || []).reduce((t: number, w: any) => t + parseInt(w.total_cost || 0), 0)
      return '<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Stock Written Off</h3>' +
        '<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 12px">' +
        (dayWriteoffs || []).map((w: any) =>
          '<div style="font-size:12px;color:#92400e;padding:2px 0">\u2022 <strong>' + escapeHtml(w.writeoff_no) + '</strong> \u00b7 ' +
          escapeHtml(w.reason || '') + ' \u00b7 ' + (w.items_count || 0) + ' item' + ((w.items_count || 0) !== 1 ? 's' : '') +
          ' \u2014 Rs.' + parseInt(w.total_cost || 0).toLocaleString() + '</div>').join('') +
        '<div style="font-size:12px;font-weight:800;color:#92400e;border-top:1px solid #fde68a;margin-top:6px;padding-top:6px">Total cost lost: Rs.' + woTotal.toLocaleString() + '</div>' +
        '<div style="font-size:10px;color:#a16207;margin-top:4px">Goods off the shelf without a sale. No cash moved \u2014 this is stock value, not a drawer payment.</div>' +
        '</div>'
    })() : ''}

${(stockAdjustments || []).length > 0 ? (() => {
      // Counts changed by hand today — recounts, initial stock, corrections.
      // The owner reads this page, so an adjustment cannot happen quietly.
      return '<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Stock Adjustments</h3>' +
        '<div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 12px">' +
        (stockAdjustments || []).map((m: any) =>
          '<div style="font-size:12px;color:#0c4a6e;padding:2px 0">\u2022 <strong>' + escapeHtml(m.product?.name || m.product_sku || '?') + '</strong> ' +
          (Number(m.quantity_change) > 0 ? '+' : '') + Number(m.quantity_change).toLocaleString() +
          ' (' + Number(m.quantity_before).toLocaleString() + ' \u2192 ' + Number(m.quantity_after).toLocaleString() + ')' +
          (m.notes ? ' \u00b7 ' + escapeHtml(m.notes) : '') + '</div>').join('') +
        '<div style="font-size:10px;color:#0369a1;margin-top:4px">Counts changed by hand \u2014 recounts, initial stock and corrections. Not sales, not GRNs.</div>' +
        '</div>'
    })() : ''}

<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Transactions (${filtered.length})</h3>
<table><thead><tr><th>Invoice</th><th>Customer</th><th>Items</th><th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Due</th></tr></thead><tbody>
${filtered.map((s: any) => {
      const activeItems = (s.items || []).filter((i: any) => (i.returned_quantity || 0) < i.quantity)
      const itemNames = escapeHtml(activeItems.map((i: any) => i.product_name).join(', '))
      return '<tr><td><strong>' + escapeHtml(s.invoice_no) + '</strong></td><td>' + (escapeHtml(s.customer_name) || 'Walk-in') + '</td><td style="font-size:11px;color:#666">' + itemNames + '</td><td class="text-right">Rs.' + parseFloat(s.total).toLocaleString() + '</td><td class="text-right" style="color:#16a34a">Rs.' + parseFloat(s.paid_amount || 0).toLocaleString() + '</td><td class="text-right" style="color:' + (parseFloat(s.balance_due || 0) > 0 ? '#dc2626;font-weight:700' : '#94a3b8') + '">Rs.' + parseFloat(s.balance_due || 0).toLocaleString() + '</td></tr>'
    }).join('')}
</tbody></table>

${dayCollections.length > 0 ? (() => {
      const colMethodMap: Record<string, number> = {}
      let advanceCollected = 0
      dayCollections.forEach((c: any) => {
        const m = (c.payment_method || 'cash').toUpperCase()
        const amt = parseFloat(c.amount || 0)
        if (m === 'ADVANCE') { advanceCollected += amt } // advance = pre-collected, exclude from today's cash summary
        else { colMethodMap[m] = (colMethodMap[m] || 0) + amt }
      })
      const cashCollectionsTotal = totalCollections - advanceCollected
      const methodIcons: Record<string, string> = { CASH: '💵', CHEQUE: '📝', BANK: '🏦', CARD: '💳', SETTLEMENT: '🔄' }
      const methodSummary = Object.entries(colMethodMap).map(([m, a]) => '<span style="margin-right:15px">' + (methodIcons[m] || '') + ' ' + m + ': <strong>Rs.' + a.toLocaleString() + '</strong></span>').join('')
      return '<h3 style="font-size:13px;font-weight:800;color:#059669;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Credit Collections (' + dayCollections.length + ') — Rs.' + cashCollectionsTotal.toLocaleString() + '</h3>' +
        '<div style="margin-bottom:10px;font-size:12px;color:#333">' + methodSummary + '</div>' +
        '<table><thead><tr><th>Invoice</th><th>Customer</th><th>Method</th><th class="text-right">Amount</th></tr></thead><tbody>' +
        dayCollections.map((c: any) => '<tr><td><strong>' + (escapeHtml(c.invoice_no) || '-') + '</strong></td><td>' + escapeHtml(c.customer_name) + '</td><td>' + escapeHtml((c.payment_method || 'cash').toUpperCase()) + (c.cheque_number ? ' #' + escapeHtml(c.cheque_number) : '') + '</td><td class="text-right" style="color:#059669;font-weight:700">Rs.' + c.amount.toLocaleString() + '</td></tr>').join('') +
        '</tbody></table>'
    })() : ''}

${(() => {
      // ── Retroactive activity ────────────────────────────────────────────
      // Everything done TODAY that changed a different day, and everything
      // done on another day that changed THIS one. Backdating is legitimate
      // here — the counter's sales are entered next morning — but it used to
      // leave no mark, so a closed day could be rewritten unnoticed. None of
      // this touches the cash figures above; it is here to be seen.
      const actedToday = (retroactive || []).filter((r: any) => colomboBusinessDay(r.actedAt) === reportDate)
      // The other direction: this day's own sheet says what was added to it
      // later, so a re-print that disagrees with the filed copy explains itself.
      const addedLater = filtered.filter((s: any) => s.entered_at && colomboBusinessDay(s.entered_at) !== reportDate)
      if (actedToday.length === 0 && addedLater.length === 0) return ''
      const LABEL: Record<string, string> = {
        backdated: 'Sale entered today, dated', future_dated: 'Sale entered today, dated ahead',
        returned: 'Return raised today against', voided: 'Sale voided today, dated',
        corrected: 'Item corrected today on',
      }
      const rows = actedToday.map((r: any) =>
        '<tr><td style="font-size:11px">' + escapeHtml(LABEL[r.kind] || r.kind) + '</td>' +
        '<td><strong>' + escapeHtml(r.invoice_no || '-') + '</strong></td>' +
        '<td>' + escapeHtml(r.customer_name || '') + (r.detail ? '<div style="font-size:10px;color:#666">' + escapeHtml(r.detail) + (r.reason ? ' — ' + escapeHtml(r.reason) : '') + '</div>' : '') + '</td>' +
        '<td style="font-size:11px;color:#b45309;font-weight:700">' + escapeHtml(colomboBusinessDay(r.belongsTo)) + '</td>' +
        '<td style="font-size:11px">' + escapeHtml(r.byName || 'not recorded') + '</td>' +
        '<td class="text-right" style="font-weight:700">Rs.' + Number(r.amount || 0).toLocaleString() + '</td></tr>'
      ).concat(addedLater.map((s: any) =>
        '<tr><td style="font-size:11px">Added to this day later</td>' +
        '<td><strong>' + escapeHtml(s.invoice_no || '-') + '</strong></td>' +
        '<td>' + escapeHtml(s.customer_name || '') + '</td>' +
        '<td style="font-size:11px;color:#b45309;font-weight:700">entered ' + escapeHtml(colomboBusinessDay(s.entered_at)) + '</td>' +
        '<td style="font-size:11px">—</td>' +
        '<td class="text-right" style="font-weight:700">Rs.' + Number(s.total || 0).toLocaleString() + '</td></tr>'
      )).join('')
      return '<h3 style="font-size:13px;font-weight:800;color:#b45309;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">⚠ Retroactive Activity (' + (actedToday.length + addedLater.length) + ')</h3>' +
        '<div style="margin-bottom:6px;font-size:11px;color:#666">Changes that affect a day other than the one they were made on. Not counted in any figure above.</div>' +
        '<table><thead><tr><th>What</th><th>Invoice</th><th>Customer</th><th>Day affected</th><th>By</th><th class="text-right">Value</th></tr></thead><tbody>' +
        rows + '</tbody></table>'
    })()}

${(() => {
      // Only show actual cash/advance refunds — credit_return entries are balance adjustments
      // already reflected in sale.total and don't represent cash moving out
      if (cashReturns.length === 0) return ''
      const totalReturnAmt = cashReturns.reduce((s: number, r: any) => s + r.amount, 0)
      return '<h3 style="font-size:13px;font-weight:800;color:#dc2626;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Cash Refunds (' + cashReturns.length + ') — Rs.' + totalReturnAmt.toLocaleString() + '</h3>' +
        '<table><thead><tr><th>Invoice</th><th>Customer</th><th>Method</th><th class="text-right">Refund</th></tr></thead><tbody>' +
        cashReturns.map((r: any) => '<tr><td><strong>' + (r.invoice_no || '-') + '</strong></td><td>' + r.customer_name + '</td><td style="font-size:11px;color:#666">' + (r.payment_method || 'cash').toUpperCase() + '</td><td class="text-right" style="color:#dc2626;font-weight:700">Rs.' + r.amount.toLocaleString() + '</td></tr>').join('') +
        '</tbody></table>'
    })()}

<div class="footer"><p>Generated: ${new Date().toLocaleString('en-LK')}</p><p style="margin-top:4px;font-weight:700">Powered by kuruma.lk</p></div></body></html>`

    const win = window.open('', '_blank', 'width=850,height=700')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
  }

  async function openPeriodReport(from?: string, to?: string) {
    const pFrom = from || reportFrom
    const pTo = to || reportTo
    // Keep page-level range in sync — the modal header and the generated PDF
    // read reportFrom/reportTo, so a range passed in from the Reports tab must
    // land there too or the printed period won't match the fetched data.
    if (from) setReportFrom(from)
    if (to) setReportTo(to)
    setPeriodReportLoading(true)
    try {
      const r = await fetch(`/api/vendor/sales?from=${pFrom}&to=${pTo}`)
      if (!r.ok) { showToast(`Failed to fetch sales (${r.status})`); setPeriodReportLoading(false); return }
      const j = await r.json()
      const sales = (j.sales || []).filter((s: any) =>
        s.payment_status !== 'voided' &&
        s.payment_status !== 'draft' &&
        !(s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')
      )
      setPeriodReportSales(sales)
      // Pre-select all unique customer keys
      const keys = new Set<string>(sales.map((s: any) => s.customer_id || 'walkin-' + (s.customer_name || 'Unknown')))
      setPeriodReportSelected(keys)
      setPeriodReportModal(true)
    } catch { showToast('Failed to fetch sales') }
    setPeriodReportLoading(false)
  }

  function generatePeriodReport(salesList: any[], vendorInfo: any, fromDate: string, toDate: string, settings?: any) {
    const filtered = salesList.filter((s: any) =>
      s.payment_status !== 'voided' &&
      s.payment_status !== 'draft' &&
      !(s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')
    )
    const totalSales = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.total || 0), 0)
    const totalPaid = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.paid_amount || 0), 0)
    const totalCredit = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)

    const methodTotals: Record<string, number> = { cash: 0, cheque: 0, bank: 0, card: 0, advance: 0 }
    filtered.forEach((sale: any) => {
      if (sale.payments && sale.payments.length > 0) {
        sale.payments.forEach((p: any) => {
          const method = p.payment_method || 'cash'
          methodTotals[method] = (methodTotals[method] || 0) + parseFloat(p.amount || 0)
        })
      } else if (parseFloat(sale.paid_amount || 0) > 0) {
        methodTotals[sale.payment_method || 'cash'] = (methodTotals[sale.payment_method || 'cash'] || 0) + parseFloat(sale.paid_amount || 0)
      }
    })

    // Customer-wise breakdown — ALL customers sorted by total desc
    const byCustomer: Record<string, { name: string; phone: string; invoices: number; total: number; paid: number; due: number }> = {}
    filtered.forEach((s: any) => {
      const id = s.customer_id || 'walkin-' + (s.customer_name || 'Unknown')
      if (!byCustomer[id]) byCustomer[id] = { name: s.customer_name || 'Walk-in', phone: s.customer_phone || '', invoices: 0, total: 0, paid: 0, due: 0 }
      byCustomer[id].invoices++
      byCustomer[id].total += parseFloat(s.total || 0)
      byCustomer[id].paid += parseFloat(s.paid_amount || 0)
      byCustomer[id].due += parseFloat(s.balance_due || 0)
    })
    const customerRows = Object.values(byCustomer).sort((a, b) => b.total - a.total)

    const shopName = escapeHtml(settings?.invoice_title || vendorInfo?.name) || 'kuruma.lk'
    const fromStr = new Date(fromDate).toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })
    const toStr = new Date(toDate).toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sales Report ${fromDate} to ${toDate}</title>
<style>@page{size:A4;margin:15mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#333;max-width:800px;margin:0 auto}
.header{text-align:center;padding:20px 0;border-bottom:3px solid #ff6b35}.shop{font-size:24px;font-weight:900}.date{font-size:14px;color:#666;margin-top:4px}.report-title{font-size:18px;font-weight:800;color:#ff6b35;margin-top:8px;text-transform:uppercase;letter-spacing:1px}
.summary{display:flex;gap:12px;margin:20px 0;flex-wrap:wrap}.summary-box{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:15px;text-align:center}.summary-box .val{font-size:22px;font-weight:900}.summary-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.green{color:#16a34a}.red{color:#dc2626}.orange{color:#ff6b35}.blue{color:#2563eb}
table{width:100%;border-collapse:collapse;margin:15px 0}th{background:#f1f5f9;text-align:left;font-size:11px;font-weight:700;padding:10px 8px;border-bottom:2px solid #e2e8f0;text-transform:uppercase}td{padding:9px 8px;font-size:12px;border-bottom:1px solid #f1f5f9}.text-right{text-align:right}tr:nth-child(even) td{background:#fafbfc}
.method-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:15px 0}.method-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}.method-box .val{font-size:18px;font-weight:900}.method-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.footer{text-align:center;padding:20px 0;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;margin-top:20px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div class="header"><div class="shop">${shopName}</div>${vendorInfo?.location ? '<div style="font-size:12px;color:#666">' + escapeHtml(vendorInfo.location) + (vendorInfo?.phone ? ' | Tel: ' + escapeHtml(vendorInfo.phone) : '') + '</div>' : ''}<div class="report-title">Sales Report</div><div class="date">${fromStr} — ${toStr}</div></div>

<div class="summary">
<div class="summary-box"><div class="val orange">Rs.${totalSales.toLocaleString()}</div><div class="lbl">Total Sales</div></div>
<div class="summary-box"><div class="val green">Rs.${totalPaid.toLocaleString()}</div><div class="lbl">Collected</div></div>
<div class="summary-box"><div class="val red">Rs.${totalCredit.toLocaleString()}</div><div class="lbl">Balance Due</div></div>
<div class="summary-box"><div class="val blue">${filtered.length}</div><div class="lbl">Invoices</div></div>
</div>

<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Payment Methods</h3>
<div class="method-grid">
${methodTotals.cash > 0 ? '<div class="method-box"><div class="val green">Rs.' + methodTotals.cash.toLocaleString() + '</div><div class="lbl">Cash</div></div>' : ''}
${methodTotals.cheque > 0 ? '<div class="method-box"><div class="val blue">Rs.' + methodTotals.cheque.toLocaleString() + '</div><div class="lbl">Cheque</div></div>' : ''}
${methodTotals.bank > 0 ? '<div class="method-box"><div class="val" style="color:#7c3aed">Rs.' + methodTotals.bank.toLocaleString() + '</div><div class="lbl">Bank Transfer</div></div>' : ''}
${methodTotals.card > 0 ? '<div class="method-box"><div class="val" style="color:#0891b2">Rs.' + methodTotals.card.toLocaleString() + '</div><div class="lbl">Card</div></div>' : ''}
${methodTotals.advance > 0 ? '<div class="method-box"><div class="val" style="color:#059669">Rs.' + methodTotals.advance.toLocaleString() + '</div><div class="lbl">From Advance</div></div>' : ''}
</div>

<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:20px 0 8px;text-transform:uppercase;letter-spacing:1px">Customer Breakdown (${customerRows.length})</h3>
<table><thead><tr>
  <th>Customer</th><th>Phone</th>
  <th class="text-right">Invoices</th>
  <th class="text-right">Total Sales</th>
  <th class="text-right">Paid</th>
  <th class="text-right">Balance Due</th>
</tr></thead><tbody>
${customerRows.map(c => `<tr>
  <td><strong>${escapeHtml(c.name)}</strong></td>
  <td style="font-size:11px;color:#64748b">${escapeHtml(c.phone)}</td>
  <td class="text-right">${c.invoices}</td>
  <td class="text-right">Rs.${c.total.toLocaleString()}</td>
  <td class="text-right" style="color:#16a34a">Rs.${c.paid.toLocaleString()}</td>
  <td class="text-right" style="color:${c.due > 0 ? '#dc2626' : '#94a3b8'};font-weight:${c.due > 0 ? '700' : '400'}">${c.due > 0 ? 'Rs.' + c.due.toLocaleString() : '—'}</td>
</tr>`).join('')}
<tr style="background:#f1f5f9">
  <td colspan="3"><strong>TOTAL</strong></td>
  <td class="text-right"><strong style="color:#ff6b35">Rs.${totalSales.toLocaleString()}</strong></td>
  <td class="text-right"><strong style="color:#16a34a">Rs.${totalPaid.toLocaleString()}</strong></td>
  <td class="text-right"><strong style="color:#dc2626">Rs.${totalCredit.toLocaleString()}</strong></td>
</tr>
</tbody></table>

<div class="footer"><p>Generated: ${new Date().toLocaleString('en-LK')}</p><p style="margin-top:4px;font-weight:700">Powered by kuruma.lk</p></div></body></html>`

    const win = window.open('', '_blank', 'width=900,height=700')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
  }

  function whatsAppDailyReport(salesList: any[], vendorInfo: any, reportDate: string, toPhone?: string) {
    const filtered = salesList.filter((s: any) => {
      if (s.payment_status === 'voided') return false
      if (s.payment_status === 'draft') return false // on-approval drafts aren't revenue yet
      if ((s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL')) return false
      return colomboBusinessDay(s.created_at) === reportDate
    })

    const total = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.total || 0), 0)
    const paid = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.paid_amount || 0), 0)
    const credit = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)

    const methods: Record<string, number> = {}
    filtered.forEach((sale: any) => {
      if (sale.payments && sale.payments.length > 0) {
        sale.payments.forEach((p: any) => {
          const m = p.payment_method || 'cash'
          methods[m] = (methods[m] || 0) + parseFloat(p.amount || 0)
        })
      } else if (parseFloat(sale.paid_amount || 0) > 0) {
        const m = sale.payment_method || 'cash'
        methods[m] = (methods[m] || 0) + parseFloat(sale.paid_amount || 0)
      }
    })

    const dateStr = new Date(reportDate).toLocaleDateString('en-LK', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

    let lines: string[] = []
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

    if (filtered.length > 0) {
      lines.push(``)
      lines.push(`*Invoices:*`)
      filtered.forEach((sale: any) => {
        const custName = sale.customer?.name || sale.customer_name || 'Walk-in'
        const status = sale.balance_due > 0 ? `⚠️ Due: Rs.${parseFloat(sale.balance_due).toLocaleString()}` : `✅ Paid`
        lines.push(`  ${sale.invoice_no} — ${custName} — Rs.${parseFloat(sale.total).toLocaleString()} [${status}]`)
      })
    }

    lines.push(``)
    lines.push(`— ${vendorInfo?.name || 'kuruma.lk'}`)

    const msg = encodeURIComponent(lines.join('\n'))
    const waNum = toPhone ? toPhone.replace(/\D/g, '').replace(/^0/, '94') : ''
    window.open(`https://wa.me/${waNum}?text=${msg}`, '_blank')
  }

  // Orchestrators — fetch a day's sales (+ cash session for reconciliation) and
  // hand off to the report builders. Shared by the Sales tab (Sakura) and the
  // WHEEL MART Reports tab so both entry points behave identically.
  async function runDailyReport(date: string) {
    setDailyReportLoading(true)
    showToast('Fetching sales...')
    try {
      // Early-morning Colombo sales (+5:30) are stored under yesterday's UTC date;
      // fetch the previous UTC day too and pin each row to its Colombo day.
      const prev = new Date(date + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1)
      const [r, cs, ex, wo, cn, scn, sm] = await Promise.all([
        fetch(`/api/vendor/sales?from=${prev.toISOString().slice(0, 10)}&to=${date}`),
        fetch(`/api/vendor/cash-sessions?date=${date}`),
        fetch(`/api/vendor/expenses?date=${date}`),
        // Stock that left without being sold is part of the day's story too —
        // the shelf is lighter and the owner should not have to go looking.
        fetch('/api/vendor/writeoffs'),
        // Credit notes, both directions. Neither moves cash, but both change
        // what the day was worth: ones we issue reduce revenue, ones suppliers
        // send reduce what we owe.
        fetch('/api/vendor/credit-notes'),
        fetch('/api/vendor/supplier-credit-notes'),
        // Counts changed by hand today — the report lists them so an
        // adjustment can never happen quietly.
        fetch('/api/vendor/stock-movements?date=' + date),
      ])
      if (!r.ok) { showToast(`Failed (${r.status})`) }
      else {
        const j = await r.json()
        // undefined = couldn't check (omit the reconciliation section entirely);
        // null = checked, genuinely no session that day ("No cash session" note).
        let cashSession: any = undefined
        let corrections: any[] = []
        let supplierCashPays: any[] = []
        let cashMovements: any[] = []
        try { if (cs.ok) { const cj = await cs.json(); cashSession = cj.session || null; corrections = cj.corrections || []; supplierCashPays = cj.supplier_cash_payments || []; cashMovements = cj.cash_movements || [] } } catch {}
        // Money that LEFT the drawer has to be on the report — otherwise the
        // owner sees the float drop with no explanation of where it went.
        let dayExpenses: any[] = []
        try { if (ex.ok) { const ej = await ex.json(); dayExpenses = ej.expenses || [] } } catch {}
        // Supplier payments aren't expenses (they settle payables), but cash is
        // cash: the report's paid-out list carries both.
        dayExpenses = [
          ...dayExpenses,
          ...supplierCashPays.map((p: any) => ({
            description: `Supplier payment — ${p.supplier?.name || 'supplier'}`,
            category: 'supplier', amount: p.amount, payment_method: 'cash',
          })),
        ]
        let dayWriteoffs: any[] = []
        try {
          if (wo.ok) {
            const wj = await wo.json()
            dayWriteoffs = (wj.writeoffs || []).filter((w: any) =>
              w.status === 'posted' && String(w.writeoff_date).slice(0, 10) === date)
          }
        } catch {}
        let dayCreditNotes: any[] = []
        try {
          if (cn.ok) {
            const cj = await cn.json()
            // issued_at is a timestamp, so it must be pinned to the Colombo
            // day like everything else here — a note raised before 5:30am
            // Colombo carries yesterday's UTC date.
            dayCreditNotes = (cj.creditNotes || [])
              .filter((c: any) => c.issued_at && colomboBusinessDay(c.issued_at) === date)
          }
        } catch {}
        let daySupplierCredits: any[] = []
        try {
          if (scn.ok) {
            const sj = await scn.json()
            daySupplierCredits = (sj.creditNotes || [])
              .filter((c: any) => String(c.credit_note_date || '').slice(0, 10) === date)
          }
        } catch {}
        let stockAdjustments: any[] = []
        try { if (sm.ok) { const sj = await sm.json(); stockAdjustments = sj.movements || [] } } catch {}
        generateDailyReport(j.sales || [], data?.vendor, date, vendorSettings, j.collectionsToday || [], j.returnsInPeriod || [], cashSession, corrections, dayExpenses, cashMovements, dayWriteoffs, dayCreditNotes, daySupplierCredits, stockAdjustments, j.retroactive || [])
      }
    } catch { showToast('Failed') }
    setDailyReportLoading(false)
  }

  async function runWhatsAppDaily(date: string) {
    setDailyReportLoading(true)
    showToast('Fetching sales...')
    try {
      const prev = new Date(date + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1)
      const r = await fetch(`/api/vendor/sales?from=${prev.toISOString().slice(0, 10)}&to=${date}`)
      if (!r.ok) { showToast(`Failed (${r.status})`) }
      else {
        const j = await r.json()
        whatsAppDailyReport(j.sales || [], j.vendor || data?.vendor, date, (j.vendor || data?.vendor)?.whatsapp || (j.vendor || data?.vendor)?.phone)
      }
    } catch { showToast('Failed') }
    setDailyReportLoading(false)
  }

  // ── End of Day Report ───────────────────────────────────────────────────
  async function sendEODReport() {
    const today = colomboToday()
    showToast('Fetching today\'s sales...')
    try {
      // Fetch from yesterday (UTC) too: with the +5:30 offset, today's early-morning
      // Colombo sales are stored under yesterday's UTC date. generateDailyReport then
      // pins each row to its Colombo calendar day, so nothing extra leaks in.
      const yesterday = new Date(today + 'T00:00:00Z'); yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      const r = await fetch(`/api/vendor/sales?from=${yesterday.toISOString().slice(0, 10)}&to=${today}`)
      if (!r.ok) { showToast(`Failed to fetch sales (${r.status})`); return }
      const j = await r.json()
      const sales = j.sales || []
      const vendor = j.vendor || data?.vendor
      if (!sales.length) { showToast('No sales today yet'); return }
      const phone = vendor?.whatsapp || vendor?.phone
      if (!phone) { showToast('No manager phone set'); return }
      whatsAppDailyReport(sales, vendor, today, phone)
    } catch { showToast('Failed to fetch sales') }
  }

  // ── Sales Summary PDF ───────────────────────────────────────────────────
  async function handleExportSummaryPDF() {
    if (!exportFrom || !exportTo) { showToast('Please select both dates'); return }
    setExportLoading(true)
    try {
      const r = await fetch(`/api/vendor/sales?from=${exportFrom}&to=${exportTo}`)
      if (!r.ok) { showToast(`Failed to fetch sales (${r.status})`); setExportLoading(false); return }
      const j = await r.json()
      const allSales = (j.sales || []).filter((s: any) => s.payment_status !== 'voided' && s.payment_status !== 'draft')
      const sales = allSales.filter((s: any) => !(s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL'))
      if (!sales.length) { showToast('No sales in that date range'); setExportLoading(false); return }

      const vendor = j.vendor || data?.vendor
      const totalRevenue = sales.reduce((s: number, x: any) => s + parseFloat(x.total || 0), 0)
      const totalPaid = sales.reduce((s: number, x: any) => s + parseFloat(x.paid_amount || 0), 0)
      const totalCredit = sales.reduce((s: number, x: any) => s + parseFloat(x.balance_due || 0), 0)
      const totalDiscount = sales.reduce((s: number, x: any) => s + parseFloat(x.discount || 0), 0)
      const totalItems = sales.reduce((s: number, x: any) => s + (x.items || []).reduce((is: number, i: any) => is + i.quantity, 0), 0)

      const fromLabel = new Date(exportFrom).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      const toLabel = new Date(exportTo).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

      const rows = sales.map((s: any) => `
        <tr>
          <td>${new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td class="mono">${escapeHtml(s.invoice_no)}</td>
          <td>${escapeHtml(s.customer?.name || s.customer_name) || 'Walk-in'}</td>
          <td>${escapeHtml(s.customer?.phone || s.customer_phone)}</td>
          <td class="right">${(s.items || []).reduce((is: number, i: any) => is + i.quantity, 0)}</td>
          <td class="right">${s.discount > 0 ? 'Rs.' + parseFloat(s.discount).toLocaleString() : '-'}</td>
          <td class="right bold">Rs.${parseFloat(s.total).toLocaleString()}</td>
          <td class="right green">Rs.${parseFloat(s.paid_amount).toLocaleString()}</td>
          <td class="right ${parseFloat(s.balance_due) > 0 ? 'red' : ''}">${parseFloat(s.balance_due) > 0 ? 'Rs.' + parseFloat(s.balance_due).toLocaleString() : '-'}</td>
          <td><span class="badge ${s.payment_status === 'paid' ? 'badge-green' : s.payment_status === 'partial' ? 'badge-amber' : 'badge-red'}">${s.payment_status.toUpperCase()}</span></td>
        </tr>
      `).join('')

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Sales Report ${fromLabel} – ${toLabel}</title>
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
          <div class="shop-name">${escapeHtml(vendor?.name) || 'kuruma.lk'}</div>
          <div class="shop-sub">${escapeHtml(vendor?.location)}${vendor?.phone ? ' | ' + escapeHtml(vendor.phone) : ''}</div>
        </div>
        <div>
          <div class="report-title">Sales Summary Report</div>
          <div class="report-period">${fromLabel} — ${toLabel}</div>
        </div>
      </div>
      <div class="summary-grid">
        <div class="stat"><div class="stat-label">Invoices</div><div class="stat-value blue">${sales.length}</div></div>
        <div class="stat"><div class="stat-label">Items Sold</div><div class="stat-value orange">${totalItems}</div></div>
        <div class="stat"><div class="stat-label">Revenue</div><div class="stat-value green">Rs.${totalRevenue.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Collected</div><div class="stat-value green">Rs.${totalPaid.toLocaleString()}</div></div>
        <div class="stat"><div class="stat-label">Outstanding</div><div class="stat-value ${totalCredit > 0 ? 'red' : 'green'}">Rs.${totalCredit.toLocaleString()}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>Date</th><th>Invoice</th><th>Customer</th><th>Phone</th>
          <th class="right">Items</th><th class="right">Discount</th>
          <th class="right">Total</th><th class="right">Paid</th>
          <th class="right">Balance</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr style="border-top:2px solid #e2e8f0;font-weight:800;background:#f8fafc">
          <td colspan="4"><strong>TOTAL (${sales.length} invoices)</strong></td>
          <td class="right">${totalItems}</td>
          <td class="right">${totalDiscount > 0 ? 'Rs.' + totalDiscount.toLocaleString() : '-'}</td>
          <td class="right bold green">Rs.${totalRevenue.toLocaleString()}</td>
          <td class="right bold green">Rs.${totalPaid.toLocaleString()}</td>
          <td class="right bold ${totalCredit > 0 ? 'red' : ''}">Rs.${totalCredit.toLocaleString()}</td>
          <td></td>
        </tr></tfoot>
      </table>
      <div class="footer">
        <span>Generated: ${new Date().toLocaleString('en-GB')}</span>
        <span>kuruma.lk — Auto Parts Marketplace</span>
      </div>
      </body></html>`

      const w = window.open('', '_blank', 'width=1100,height=800')
      if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500) }
      showToast(`PDF ready — ${sales.length} invoices`)
      setShowExportModal(false)
    } catch { showToast('PDF generation failed') }
    setExportLoading(false)
  }

  // ── Export Sales CSV ────────────────────────────────────────────────────
  async function handleExportCSV(mode: 'summary' | 'items') {
    if (!exportFrom || !exportTo) { showToast('Please select both dates'); return }
    setExportLoading(true)
    try {
      const r = await fetch(`/api/vendor/sales?from=${exportFrom}&to=${exportTo}`)
      if (!r.ok) { showToast(`Failed to fetch sales (${r.status})`); setExportLoading(false); return }
      const j = await r.json()
      // Exclude voided, drafts (not revenue) and opening-balance rows from exports
      const sales = (j.sales || []).filter((s: any) =>
        s.payment_status !== 'voided' && s.payment_status !== 'draft' &&
        !(s.items || []).some((i: any) => i.product_sku === 'OPENING-BAL'))
      if (!sales.length) { showToast('No sales in that date range'); setExportLoading(false); return }

      const esc = (v: any) => {
        const s = String(v ?? '').replace(/"/g, '""')
        return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s}"` : s
      }
      const rows: string[][] = []

      if (mode === 'summary') {
        rows.push(['Invoice No','Date','Customer Name','Customer Phone','Subtotal (Rs.)','Discount (Rs.)','Total (Rs.)','Paid (Rs.)','Balance Due (Rs.)','Payment Status','Payment Method','Items','Notes'])
        for (const s of sales) {
          const itemsSummary = (s.items || []).map((i: any) => `${i.product_name} x${i.quantity}`).join(' | ')
          rows.push([
            s.invoice_no,
            new Date(s.created_at).toLocaleDateString('en-GB'),
            s.customer?.name || s.customer_name || 'Walk-in',
            s.customer?.phone || s.customer_phone || '',
            s.subtotal ?? s.total,
            s.discount || 0,
            s.total,
            s.paid_amount,
            s.balance_due,
            s.payment_status,
            s.payment_method,
            itemsSummary,
            s.notes || '',
          ].map(esc))
        }
      } else {
        rows.push(['Invoice No','Date','Customer Name','Customer Phone','SKU','Part Name','Qty','Unit Price (Rs.)','Cost (Rs.)','Profit (Rs.)','Line Total (Rs.)','Invoice Total (Rs.)','Paid (Rs.)','Balance Due (Rs.)','Payment Status'])
        for (const s of sales) {
          for (const item of (s.items || [])) {
            const cost = item.unit_cost != null && item.unit_cost > 0 ? item.unit_cost : null
            const profit = cost != null ? (item.unit_price - cost) * item.quantity : ''
            rows.push([
              s.invoice_no,
              new Date(s.created_at).toLocaleDateString('en-GB'),
              s.customer?.name || s.customer_name || 'Walk-in',
              s.customer?.phone || s.customer_phone || '',
              item.product_sku || '',
              item.product_name,
              item.quantity,
              item.unit_price,
              cost ?? '',
              profit,
              item.total,
              s.total,
              s.paid_amount,
              s.balance_due,
              s.payment_status,
            ].map(esc))
          }
        }
      }

      const csv = rows.map(r => r.join(',')).join('\n')
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `kuruma-sales-${mode}-${exportFrom}-to-${exportTo}.csv`
      a.click()
      URL.revokeObjectURL(url)
      showToast(`Exported ${sales.length} sales ✓`)
      setShowExportModal(false)
    } catch { showToast('Export failed') }
    setExportLoading(false)
  }

  const filteredProducts = useMemo(() => {
    const prods: any[] = (data?.products) || []
    const s = productSearch.toLowerCase()
    return prods.filter((p: any) => {
      // WHEEL MART cost-entry worklist: in-stock actives with no cost — these
      // sell with zero COGS (GP overstated) until someone types the cost in.
      if (showMissingCost) {
        const missingCost = p.quantity > 0 && p.is_active && !(parseInt(p.cost) > 0)
        if (!missingCost) return false
      }
      const matchesSearch = !productSearch || p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.make || '').toLowerCase().includes(s)
      if (!matchesSearch) return false
      // If sold out (qty 0): show if showSoldOut is on, OR if searching by SKU and it matches
      if (p.quantity <= 0) {
        if (showSoldOut) return true
        if (productSearch && (p.sku || '').toLowerCase().includes(s)) return true
        return false
      }
      return true
    })
  }, [data, productSearch, showSoldOut, showMissingCost])



  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!data) return null
  const { vendor, products, stats, dashboard } = data

  // Payment lines are rendered inline to avoid focus loss

  return (
    <div className="min-h-screen bg-slate-50">
      {toast && <div className="fixed top-4 right-4 z-[100] bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold max-w-sm">{toast}</div>}

      {/* ── WHEEL MART: fixed left sidebar ───────────────────────────────────── */}
      {isLkTax && (
        <WheelMartSidebar
          tab={tab === 'receivables' && receivablesShowAll ? ('customers' as VendorTab) : tab}
          onTabChange={t => startTransition(() => {
            // 'customers' opens the customer REGISTRY (Credit & Customers tab
            // with Show All Customers on); 'receivables' opens the same tab in
            // its credit-focused view
            if (t === 'customers') { setReceivablesShowAll(true); setTab('receivables') }
            else if (t === 'receivables') { setReceivablesShowAll(false); setTab('receivables') }
            else setTab(t as VendorTab)
          })}
          vendorName={vendor.name}
          staffRole={staffRole}
          canFileTax={canFileTax}
          onSignOut={handleSignOut}
        />
      )}

      {/* ── Top header bar ───────────────────────────────────────────────────── */}
      {isLkTax ? (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-30 transition-all md:ml-[220px] pl-16 md:pl-0">
          <div className="px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-black text-orange-500 text-sm">WHEEL MART</span>
              <span className="text-slate-300 mx-0.5">/</span>
              <span className="text-slate-700 font-semibold">{({'overview':'Dashboard','products':'Products','add':'Add Product','bulk':'Bulk Upload','pos':'POS','sales':'Sales & Invoices','credit':'Credit Notes','stocktake':'📦 Stock','receivables':receivablesShowAll ? 'Customers' : 'Receivables','staff':'Staff','cash':'Cash & Expenses','reports':'Reports','suppliers':'Suppliers','fleet':'Fleet & Vehicles','writeoffs':'Write-offs','supplier-returns':'Supplier Returns','imports':'Import Shipments','tax':'VAT Filing','settings':'Settings'} as Record<string,string>)[tab] ?? tab}</span>
            </div>
            <div className="flex items-center gap-2">
              <button className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors text-base">🔔</button>
              <a href="/" className="text-sm text-orange-500 font-medium hover:text-orange-600 transition-colors flex items-center gap-1">View Store →</a>
            </div>
          </div>
        </header>
      ) : (
        <header className="bg-white border-b border-slate-200 sticky top-0 z-50"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-3"><a href="/" className="text-xl font-black text-orange-500">kuruma.lk</a><span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">VENDOR</span><span className="text-sm font-semibold text-slate-600 hidden sm:inline">{vendor.name}</span></div><div className="flex items-center gap-3"><a href="/" className="text-sm text-slate-400 hover:text-slate-600">View Store</a><button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-600 font-semibold">Log Out</button></div></div></header>
      )}

      {/* ── SAKURA: horizontal tab bar (WHEEL MART uses sidebar instead) ──────── */}
      {!isLkTax && (
        <div className="bg-white border-b border-slate-200"><div className="max-w-7xl mx-auto px-2 sm:px-4 flex gap-0 overflow-x-auto scrollbar-hide" style={{WebkitOverflowScrolling:'touch'}}>
          {([{key:'overview' as VendorTab,l:'Overview'},{key:'products' as VendorTab,l:'Products'},{key:'add' as VendorTab,l:'+ Add'},{key:'bulk' as VendorTab,l:'Bulk'},{key:'pos' as VendorTab,l:'POS'},{key:'sales' as VendorTab,l:'Sales'},{key:'credit' as VendorTab,l:'Credit'},{key:'stocktake' as VendorTab,l:'📦 Stock'},{key:'settings' as VendorTab,l:'⚙️'}])
          .filter((t) => staffRole === 'cashier' ? t.key === 'pos' : true).map(t => (
            <button key={t.key} onClick={() => startTransition(() => setTab(t.key))} className={`px-3 sm:px-4 py-4 text-xs sm:text-sm font-bold border-b-2 transition whitespace-nowrap ${tab === t.key ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-400 hover:text-slate-700'} ${t.key === 'bulk' ? 'hidden sm:inline-block' : ''}`}>{t.l}</button>
          ))}
        </div></div>
      )}

      <main className={isLkTax ? 'px-3 sm:px-6 py-6 pb-24 md:pb-6 md:ml-[220px]' : 'max-w-7xl mx-auto px-4 py-6'}>

        {/* OVERVIEW — WHEEL MART uses TabOverview, Sakura keeps inline */}
        {tab === 'overview' && isLkTax && (
          <>
          {/* Stock the other shop has sent — answered here, where the shop
              actually looks, not only inside the Transfer Stock tab. */}
          <IncomingTransfers showToast={showToast} onDataChanged={fetchData} />
          <TabOverview
            vendor={vendor}
            stats={stats}
            dashboard={dashboard}
            staffRole={staffRole}
            products={products}
            vendorSettings={vendorSettings}
            onDailyReport={() => runDailyReport(colomboToday())}
            onDataChanged={() => fetchData(true, true)}
            onNavigate={(t, sub) => startTransition(() => {
              // Dashboard deep-links: sub targets a view inside the tab
              if (t === 'products' && sub === 'missing-cost') { setShowMissingCost(true); setTab('products'); return }
              setTab(t as VendorTab); setStockInitialView(sub ?? null)
            })}
            showToast={showToast}
          />
          </>
        )}
        {tab === 'overview' && !isLkTax && (<div>
          <h1 className="text-2xl font-black text-slate-900 mb-6">Dashboard</h1>
          <IncomingTransfers showToast={showToast} onDataChanged={fetchData} />
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-orange-500">{stats.totalProducts}</p><p className="text-xs text-slate-400 mt-1">Products</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-emerald-500">{stats.activeProducts}</p><p className="text-xs text-slate-400 mt-1">Active</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-blue-500">{stats.totalStock}</p><p className="text-xs text-slate-400 mt-1">Stock</p></div>
            
            
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5"><h3 className="font-bold text-slate-900 mb-3">Quick Actions</h3><div className="space-y-2">
              <button onClick={() => startTransition(() => setTab('pos'))} className="w-full text-left px-4 py-3 rounded-lg bg-green-50 hover:bg-green-100 text-green-700 font-semibold text-sm">🧾 Open POS</button>
              <button onClick={() => startTransition(() => setTab('credit'))} className="w-full text-left px-4 py-3 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-sm">💳 Credit & Settlements</button>
              <button onClick={() => startTransition(() => setTab('add'))} className="w-full text-left px-4 py-3 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 font-semibold text-sm">+ Add Product</button>
              <button onClick={() => startTransition(() => setTab('sales'))} className="w-full text-left px-4 py-3 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold text-sm">📊 Sales History</button>
            </div></div>
            <div className="bg-white rounded-xl border border-slate-200 p-5"><h3 className="font-bold text-slate-900 mb-3">Shop Info</h3><div className="space-y-2 text-sm">
              <p><span className="text-slate-400">Name:</span> <span className="font-semibold">{vendor.name}</span></p>
              <p><span className="text-slate-400">Phone:</span> <span className="font-semibold">{vendor.phone}</span></p>
              <p><span className="text-slate-400">Location:</span> <span className="font-semibold">{vendor.location}</span></p>
              <p><span className="text-slate-400">Status:</span> <span className={'font-bold ' + (vendor.status === 'approved' ? 'text-emerald-600' : 'text-amber-600')}>{vendor.status.toUpperCase()}</span></p>
            </div></div>
          </div>
        </div>)}

        {/* SUPPLIERS — WHEEL MART only */}
        {tab === 'suppliers' && isLkTax && (
          <TabSuppliers vendor={vendor} showToast={showToast} />
        )}

        {/* SUPPLIER RETURNS — WHEEL MART only */}
        {tab === 'supplier-returns' && isLkTax && (
          <TabSupplierReturns vendor={vendor} showToast={showToast} />
        )}

        {/* WRITE-OFFS — WHEEL MART only */}
        {tab === 'writeoffs' && isLkTax && (
          <TabWriteoffs vendor={vendor} showToast={showToast} />
        )}

        {/* Fleet & Vehicles removed from the nav (owner decision 2026-08-18);
            TabFleet stays in the repo in case it returns. */}

        {/* CASH RECONCILIATION + EXPENSES — WHEEL MART only */}
        {tab === 'cash' && isLkTax && (
          <TabCash vendor={vendor} showToast={showToast} initialView={stockInitialView} onInitialViewConsumed={() => setStockInitialView(null)} />
        )}

        {/* REPORTS — WHEEL MART only */}
        {tab === 'reports' && isLkTax && (
          <TabReports vendor={vendor} showToast={showToast} reportTools={{ runDailyReport, runWhatsAppDaily, openPeriodReport, dailyReportLoading, periodReportLoading }} />
        )}

        {/* IMPORT SHIPMENTS — WHEEL MART only (Cusdec + import VAT) */}
        {tab === 'imports' && isLkTax && (
          <TabImports showToast={showToast} />
        )}

        {/* VAT FILING CENTRE — WHEEL MART only; owner, or a delegated filer */}
        {tab === 'tax' && isLkTax && (staffRole === 'owner' || canFileTax) && (
          <TabTax showToast={showToast} vendorSettings={vendorSettings} />
        )}

        {/* STAFF / HR — WHEEL MART only; owner + manager (server re-checks role) */}
        {tab === 'staff' && isLkTax && (staffRole === 'owner' || staffRole === 'manager') && (
          <TabStaff staffRole={staffRole} vendorName={vendorSettings?.invoice_title || vendor?.name} initialView={stockInitialView} onInitialViewConsumed={() => setStockInitialView(null)} />
        )}

        {/* PRODUCTS */}
        {tab === 'products' && (<div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h1 className="text-2xl font-black text-slate-900">Products</h1>
            <div className="flex gap-2 items-center">
              {/* View toggle */}
              <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                <button onClick={() => setProductsViewMode('grid')} className={'px-3 py-1.5 rounded-md text-xs font-bold transition ' + (productsViewMode === 'grid' ? 'bg-white shadow text-slate-800' : 'text-slate-400')}>⊞ Grid</button>
                <button onClick={() => setProductsViewMode('sheet')} className={'px-3 py-1.5 rounded-md text-xs font-bold transition ' + (productsViewMode === 'sheet' ? 'bg-white shadow text-slate-800' : 'text-slate-400')}>📊 Sheet</button>
              </div>
              <button onClick={() => setTab('add')} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg">+ Add</button>
            </div>
          </div>
          {/* Feature 3: Selection toolbar */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <input type="text" placeholder="Search..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 w-56" />
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-500"><input type="checkbox" checked={showSoldOut} onChange={e => setShowSoldOut(e.target.checked)} className="w-3.5 h-3.5 accent-orange-500" />Show Sold Out</label>
              {isLkTax && (() => {
                const missingCount = ((data?.products) || []).filter((p: any) => p.quantity > 0 && p.is_active && !(parseInt(p.cost) > 0)).length
                return (
                  <label className={`flex items-center gap-1.5 cursor-pointer text-xs font-semibold ${missingCount > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                    <input type="checkbox" checked={showMissingCost} onChange={e => setShowMissingCost(e.target.checked)} className="w-3.5 h-3.5 accent-amber-500" />
                    Missing cost{missingCount > 0 ? ` (${missingCount})` : ''}
                  </label>
                )
              })()}
              {selectedProducts.size > 0 && <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full">{selectedProducts.size} selected</span>}
            </div>
            <div className="flex gap-2">
              {!primaryMode && <button onClick={() => { setPrimaryMode(true); setPrimaryChanges(new Map()) }} className="text-xs font-bold px-4 py-2 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50">🖼️ Change Primary Images</button>}
              {primaryMode && (<>
                <span className="text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full self-center">{primaryChanges.size} changed</span>
                <button onClick={saveAllPrimaryChanges} disabled={primaryChanges.size === 0 || actionLoading === 'saving-primary'} className="bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50">{actionLoading === 'saving-primary' ? 'Saving...' : `✓ Save ${primaryChanges.size} Change${primaryChanges.size !== 1 ? 's' : ''}`}</button>
                <button onClick={() => { setPrimaryMode(false); setPrimaryChanges(new Map()) }} className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">Cancel</button>
              </>)}
              {selectedProducts.size > 0 && (<>
                <button onClick={() => {
                  sendProductsToPos((data?.products || []).filter((p: any) => selectedProducts.has(p.id)))
                  setSelectedProducts(new Set())
                }} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5">🛒 Send to POS ({selectedProducts.size})</button>
                <button onClick={deleteSelectedProducts} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5">🗑️ Delete {selectedProducts.size}</button>
              </>)}
            </div>
          </div>
          {sheetProduct && (
            <ProductSheet
              product={(data?.products || []).find((x: any) => x.id === sheetProduct.id) || sheetProduct}
              onClose={() => setSheetProduct(null)}
              onEdit={p => { setSheetProduct(null); setEditingProduct({ ...p }); setEditProductImages(p.images || []) }}
              onSell={p => { setSheetProduct(null); sendProductsToPos([p]) }}
              showToast={showToast}
              uploadImages={uploadImagesForProduct}
              onChanged={() => fetchData(false, true)}
              costLabel={isLkTax ? costVatLabel : undefined}
            />
          )}
          {editingProduct && (<div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setEditingProduct(null)}><div className="bg-white rounded-t-2xl sm:rounded-2xl p-4 sm:p-6 w-full sm:max-w-lg h-[95vh] sm:h-auto sm:max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}><h3 className="text-lg font-bold mb-4">Edit Product</h3><div className="space-y-3"><div className="bg-blue-50 border border-blue-200 rounded-lg p-3"><label className="block text-xs font-bold text-blue-800 mb-1">Part ID</label><input value={editingProduct.sku || ''} onChange={e => setEditingProduct({...editingProduct, sku: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none font-mono font-bold bg-white" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Name</label><input value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Description</label><textarea value={editingProduct.description || ''} onChange={e => setEditingProduct({...editingProduct, description: e.target.value})} rows={2} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none resize-none" /></div><div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Category</label><select value={editingProduct.category} onChange={e => setEditingProduct({...editingProduct, category: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Condition</label><select value={editingProduct.condition} onChange={e => setEditingProduct({...editingProduct, condition: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Make</label><input value={editingProduct.make || ''} onChange={e => setEditingProduct({...editingProduct, make: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Toyota" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Model</label><input value={editingProduct.model || ''} onChange={e => setEditingProduct({...editingProduct, model: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Year</label><input value={editingProduct.year || ''} onChange={e => setEditingProduct({...editingProduct, year: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Model Code</label><input value={editingProduct.model_code || ''} onChange={e => setEditingProduct({...editingProduct, model_code: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="ZRE172" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Side</label><select value={editingProduct.side || ''} onChange={e => setEditingProduct({...editingProduct, side: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none"><option value="">Any</option><option>Front</option><option>Rear</option><option>Left</option><option>Right</option><option>Front Left</option><option>Front Right</option><option>Rear Left</option><option>Rear Right</option></select></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Color</label><input value={editingProduct.color || ''} onChange={e => setEditingProduct({...editingProduct, color: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Black" /></div></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">OEM Code</label><input value={editingProduct.oem_code || ''} onChange={e => setEditingProduct({...editingProduct, oem_code: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none font-mono" placeholder="A12345" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Mfd. Country</label><input value={editingProduct.origin_country || ''} onChange={e => setEditingProduct({...editingProduct, origin_country: e.target.value})} list="origin-country-list" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="e.g. Japan" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Cost {isLkTax && costHasVat(editingProduct) ? '(incl. VAT)' : ''} (Rs.)</label><input type="number" value={editingProduct.cost || ''} onChange={e => setEditingProduct({...editingProduct, cost: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Internal cost" />{isLkTax && Number(editingProduct.cost) > 0 && <p className="text-[10px] text-slate-500 mt-1">= Rs.{costFloor(editingProduct).toLocaleString()}{costHasVat(editingProduct) ? ' incl VAT' : ''} (what the list shows)</p>}{isLkTax && Number(editingProduct.cost) > 0 && <label className="flex items-center gap-1.5 mt-1 cursor-pointer"><input type="checkbox" checked={editingProduct.cost_is_estimate || false} onChange={e => setEditingProduct({...editingProduct, cost_is_estimate: e.target.checked})} className="rounded" /><span className="text-[10px] text-slate-500 font-semibold">~ rough estimate</span></label>}</div></div><div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Price (Rs.)</label><input type="number" value={editingProduct.price || ''} onChange={e => setEditingProduct({...editingProduct, price: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Qty</label><input type="number" value={editingProduct.quantity} onChange={e => setEditingProduct({...editingProduct, quantity: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" />{isLkTax && <p className="text-[10px] text-slate-400 mt-1">New stock from a supplier → use a GRN. Edit qty only to correct a count.</p>}</div></div>{Number(editingProduct.price) > 0 && Number(editingProduct.cost) > 0 && (isBelowCost(marginBase(editingProduct.price), editingProduct.cost) ? <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700 font-bold">⚠️ Selling price Rs.{Number(editingProduct.price).toLocaleString()}{isLkTax ? ` (Rs.${marginBase(editingProduct.price).toLocaleString()} excl. VAT)` : ''} is at or below cost (Rs.{Number(editingProduct.cost).toLocaleString()}) — no profit.</div> : <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-[11px] text-green-700">✅ Margin: GP {gpPercent(marginBase(editingProduct.price), editingProduct.cost)}%{isLkTax ? ' (net of VAT)' : ''} · profit Rs.{(marginBase(editingProduct.price) - Number(editingProduct.cost)).toLocaleString()}/unit (cost Rs.{Number(editingProduct.cost).toLocaleString()})</div>)}{isLkTax && <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Min Stock Level <span className="text-slate-400 font-normal">(alert threshold)</span></label><input type="number" min="0" value={editingProduct.min_stock_level || 0} onChange={e => setEditingProduct({...editingProduct, min_stock_level: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="0 = no alert" /></div></div>}<div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2"><label className="block text-xs font-bold text-amber-800">📍 Warehouse Location <span className="font-normal text-amber-600">(optional)</span></label><div className="grid grid-cols-2 gap-2"><div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Store</label><input value={editingProduct.loc_store || ''} onChange={e => setEditingProduct({...editingProduct, loc_store: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Main Store" /></div><div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Floor</label><input value={editingProduct.loc_floor || ''} onChange={e => setEditingProduct({...editingProduct, loc_floor: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Ground" /></div><div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Sub Location 1</label><input value={editingProduct.loc_sub1 || ''} onChange={e => setEditingProduct({...editingProduct, loc_sub1: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Rack A" /></div><div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Sub Location 2</label><input value={editingProduct.loc_sub2 || ''} onChange={e => setEditingProduct({...editingProduct, loc_sub2: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Bin 5" /></div></div></div><div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3"><div><p className="text-xs font-semibold text-slate-700">Show Price Publicly</p><p className="text-[11px] text-slate-400 mt-0.5">Customers will see the price on the listing</p></div><button type="button" onClick={() => setEditingProduct({...editingProduct, show_price: !editingProduct.show_price})} className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (editingProduct.show_price ? 'bg-orange-500' : 'bg-slate-300')}><span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (editingProduct.show_price ? 'translate-x-6' : 'translate-x-1')} /></button></div>
            {/* Feature 5: Existing Images with Delete */}
            {editProductImages.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2">Current Images ({editProductImages.length})</label>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {editProductImages.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)).map((img: any, idx: number) => (
                    <div key={img.id} className="relative">
                      <img src={img.url} alt={`Image ${idx + 1}`} className={'w-full aspect-square rounded-lg object-cover ' + (idx === 0 ? 'ring-2 ring-orange-500' : 'border border-slate-200')} />
                      {idx === 0 && <span className="absolute top-1 left-1 bg-orange-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">PRIMARY</span>}
                      <div className="flex gap-1 mt-1">
                        {idx !== 0 && <button onClick={async () => {
                          const sorted = editProductImages.slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))
                          const newOrder = [img.id, ...sorted.filter((x: any) => x.id !== img.id).map((x: any) => x.id)]
                          try { const r = await fetch('/api/vendor/images', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reorder', imageOrder: newOrder }) }); const j = await r.json(); if (j.success) { showToast('Primary updated'); await fetchData(); setEditProductImages(prev => { const updated = prev.map((x: any) => ({ ...x, sort_order: newOrder.indexOf(x.id) })); return updated.sort((a: any, b: any) => a.sort_order - b.sort_order) }) } } catch {}
                        }} className="flex-1 bg-orange-50 text-orange-600 text-[10px] font-bold py-1.5 rounded active:bg-orange-100">Set Primary</button>}
                        <button onClick={() => deleteProductImage(img.id)} disabled={deletingImageId === img.id} className={(idx === 0 ? 'flex-1' : '') + ' bg-red-50 text-red-500 text-[10px] font-bold py-1.5 px-2 rounded active:bg-red-100'}>
                          {deletingImageId === img.id ? '...' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Tap "Set Primary" to change cover image</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Add More Images</label>
              <input type="file" accept="image/*" multiple onChange={async (e) => {
                const files = Array.from(e.target.files || [])
                if (files.length === 0 || !editingProduct) return
                showToast('Uploading...')
                await uploadImagesForProduct(editingProduct.id, files)
                await fetchData()
                showToast('Images uploaded!')
              }} className="w-full text-sm text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-orange-50 file:text-orange-600 hover:file:bg-orange-100" />
            </div>
          <div className="mt-1"><PartOutPanel product={editingProduct} showToast={showToast} uploadImages={uploadImagesForProduct} onCostMoved={moved => setEditingProduct((cur: any) => cur ? { ...cur, cost: Math.max(0, (Number(cur.cost) || 0) - moved) } : cur)} onChanged={() => fetchData(false, true)} /></div></div><div className="flex gap-2 mt-5"><button onClick={() => productAction('update', editingProduct.id, { sku: editingProduct.sku, name: editingProduct.name, description: editingProduct.description, price: editingProduct.price, quantity: editingProduct.quantity, make: editingProduct.make, model: editingProduct.model, year: editingProduct.year, model_code: editingProduct.model_code, condition: editingProduct.condition, side: editingProduct.side, color: editingProduct.color, oem_code: editingProduct.oem_code, origin_country: editingProduct.origin_country || null, cost: editingProduct.cost, category: editingProduct.category, show_price: editingProduct.show_price, loc_store: editingProduct.loc_store || null, loc_floor: editingProduct.loc_floor || null, loc_sub1: editingProduct.loc_sub1 || null, loc_sub2: editingProduct.loc_sub2 || null, min_stock_level: editingProduct.min_stock_level || 0, cost_is_estimate: Number(editingProduct.cost) > 0 ? (editingProduct.cost_is_estimate || false) : false })} disabled={actionLoading === editingProduct.id} className="bg-orange-500 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">Save</button><button onClick={() => setEditingProduct(null)} className="text-slate-500 text-sm px-4 py-2">Cancel</button></div></div></div>)}
          {products.length === 0 ? (productsLoading ? <div className="text-center py-16 bg-white rounded-xl border border-slate-200"><div className="w-8 h-8 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div><p className="text-slate-400 font-semibold">Loading products...</p></div> : <div className="text-center py-16 bg-white rounded-xl border border-slate-200"><p className="text-4xl mb-3">📦</p><p className="text-slate-500 font-semibold">No products</p></div>) : (<>

            {/* ─── GRID VIEW ─── */}
            {productsViewMode === 'grid' && (<>
              {/* Mobile: Grid of image cards with tap-to-reveal actions */}
              <div className="sm:hidden grid grid-cols-2 gap-2.5">
                {filteredProducts.map((p: any) => { const img = (p.images || []).sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0))[0]; return (
                  <div key={p.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                    <div className="aspect-square bg-slate-100 relative" onClick={() => setSheetProduct(p)}>
                      {img ? <img src={img.url} alt={p.name} loading="lazy" className="w-full h-full object-cover" /> : <ProductThumb product={p} variant="card" className="w-full h-full" />}
                      {p.quantity <= 0 && <span className="absolute top-1 left-1 bg-red-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">SOLD</span>}
                      {!p.is_active && p.quantity > 0 && <span className="absolute top-1 left-1 bg-slate-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">HIDDEN</span>}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs font-bold text-slate-800 leading-tight line-clamp-2 min-h-[2.5em]">{p.name}</p>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-black text-orange-600">{p.price ? 'Rs.' + p.price.toLocaleString() : 'Ask'}</span>
                        <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (p.quantity > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600')}>{p.quantity > 0 ? p.quantity + ' in' : 'out'}</span>
                      </div>
                      {p.cost != null && Number(p.cost) > 0 && <span className={'text-[9px] block truncate ' + (isBelowCost(marginBase(p.price), p.cost) ? 'text-red-600 font-bold' : 'text-slate-400')}>cost Rs.{(isLkTax ? costFloor(p) : Number(p.cost)).toLocaleString()}{isLkTax ? costVatLabel(p) : ''}{gpPercent(marginBase(p.price), p.cost) != null ? ' · GP ' + gpPercent(marginBase(p.price), p.cost) + '%' : ''}</span>}
                      {locLabel(p) && <span className="text-[9px] font-semibold text-amber-700 bg-amber-50 px-1 rounded truncate block">📍 {locLabel(p)}</span>}
                    </div>
                  </div>
                ) })}
              </div>
              {/* Desktop: Full table */}
              <div className="hidden sm:block bg-white rounded-xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="px-3 py-3 w-10"><input type="checkbox" checked={selectedProducts.size > 0 && selectedProducts.size === filteredProducts.length} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 accent-orange-500" /></th><th className="px-4 py-3 text-xs font-bold text-slate-500">Image</th><th className="px-4 py-3 text-xs font-bold text-slate-500">ID</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Product</th><th className="px-4 py-3 text-xs font-bold text-slate-500 hidden lg:table-cell">Location</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Price</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Stock</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Status</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Actions</th></tr></thead><tbody>
                {filteredProducts.map((p: any, i: number) => { const sortedImages = (p.images || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)); const pendingChange = primaryChanges.get(p.id); const effectivePrimaryId = pendingChange ? pendingChange.imageId : sortedImages[0]?.id; return (<tr key={p.id} className={'border-t border-slate-100 ' + (pendingChange ? 'bg-blue-50/50' : selectedProducts.has(p.id) ? 'bg-orange-50' : i % 2 ? 'bg-slate-50/50' : '')}><td className="px-3 py-2.5"><input type="checkbox" checked={selectedProducts.has(p.id)} onChange={() => toggleProductSelect(p.id)} className="w-4 h-4 accent-orange-500" /></td><td className="px-4 py-2.5"><div className={'flex gap-1.5 overflow-x-auto ' + (primaryMode ? 'max-w-[420px]' : 'max-w-[300px]')}>{sortedImages.length > 0 ? sortedImages.slice(0, 6).map((img: any) => { const isPrimary = img.id === effectivePrimaryId; const size = primaryMode ? 'w-16 h-16 sm:w-20 sm:h-20' : 'w-10 h-10 sm:w-14 sm:h-14'; return (<img key={img.id} src={img.url} alt="" loading="lazy" title={isPrimary ? 'Primary image' : primaryMode ? 'Click to set as primary' : ''} onClick={() => { if (primaryMode && !isPrimary) markAsPrimary(p.id, img.id, p.images) }} className={size + ' rounded-lg object-cover shrink-0 transition-all ' + (isPrimary ? 'ring-2 ring-orange-500' : 'border border-slate-200') + (primaryMode && !isPrimary ? ' cursor-pointer hover:ring-2 hover:ring-blue-400 active:scale-95 active:ring-2 active:ring-blue-400' : '')} />) }) : <ProductThumb product={p} variant="thumb" className={(primaryMode ? 'w-16 h-16 sm:w-20 sm:h-20' : 'w-10 h-10 sm:w-14 sm:h-14') + ' rounded-lg shrink-0'} />}{sortedImages.length > 6 && <span className="text-[10px] text-slate-400 self-center shrink-0">+{sortedImages.length - 6}</span>}</div></td><td className="px-4 py-2.5"><span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded font-semibold">{p.sku}</span></td><td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{p.name}</div><div className="text-xs text-slate-400">{[p.make && p.make + ' ' + (p.model || ''), p.origin_country && '🌐 ' + p.origin_country].filter(Boolean).join(' · ')}</div></td><td className="px-4 py-2.5 hidden lg:table-cell">{locLabel(p) ? <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">📍 {locLabel(p)}</span> : <span className="text-xs text-slate-300">—</span>}</td><td className="px-4 py-2.5"><div className="font-bold text-orange-600">{p.price ? 'Rs.' + p.price.toLocaleString() : 'Ask'}</div>{p.cost != null && Number(p.cost) > 0 && (<div className={'text-[10px] mt-0.5 ' + (isBelowCost(marginBase(p.price), p.cost) ? 'text-red-600 font-bold' : 'text-slate-400')}>cost Rs.{(isLkTax ? costFloor(p) : Number(p.cost)).toLocaleString()}{isLkTax ? costVatLabel(p) : ''}{gpPercent(marginBase(p.price), p.cost) != null ? ' · GP ' + gpPercent(marginBase(p.price), p.cost) + '%' : ''}{isBelowCost(marginBase(p.price), p.cost) ? ' ⚠' : ''}</div>)}</td><td className={'px-4 py-2.5 font-semibold ' + (p.quantity <= 0 ? 'text-red-500' : '')}>{p.quantity <= 0 ? <span className="bg-red-50 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">0 - Sold</span> : p.quantity}</td><td className="px-4 py-2.5"><span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{p.is_active ? 'ACTIVE' : 'HIDDEN'}</span></td><td className="px-4 py-2.5"><div className="flex gap-1"><button onClick={() => { setEditingProduct({...p}); setEditProductImages(p.images || []) }} className="text-[11px] font-semibold text-blue-600 px-2 py-1 rounded border border-blue-200">Edit</button><button onClick={() => productAction('toggle', p.id)} disabled={actionLoading === p.id} className={'text-[11px] font-semibold px-2 py-1 rounded border disabled:opacity-50 ' + (p.is_active ? 'text-amber-600 border-amber-200' : 'text-emerald-600 border-emerald-200')}>{p.is_active ? 'Hide' : 'Show'}</button>{p.in_history ? (
  /* Named on a sale, GRN or transfer — Postgres will refuse, so don't offer
     the button. Hide is the real answer and is already next to it. */
  <span title="This product appears on a sale, goods-received note or transfer, so it can't be deleted without breaking that record. Use Hide — or, if it was only ever transferred, reverse that transfer from Stock → Transfer Stock → Transfer History and it becomes deletable."
    className="text-[11px] font-semibold text-slate-300 px-2 py-1 rounded border border-slate-200 cursor-not-allowed select-none">Del</span>
) : (
  <button onClick={() => { if (confirm(`Delete "${p.name}"? It has never been sold, received or transferred, so nothing else refers to it.`)) productAction('delete', p.id) }} className="text-[11px] font-semibold text-red-500 px-2 py-1 rounded border border-red-200">Del</button>
)}</div></td></tr>) })}
              </tbody></table></div></div>
            </>)}

            {/* ─── SPREADSHEET VIEW ─── */}
            {productsViewMode === 'sheet' && (() => {
              // Format: [optional prefix] + 3-digit container + 3-digit sequence + optional A/B/C suffix
              // e.g. 145847, 145847A, 145847B  OR  SAK-145847, SAK-145847A
              const skuRe = /^([A-Za-z\-]*)(\d{3})(\d{3})([A-Z]*)$/

              // Parse all SKUs
              type ParsedSKU = { prefix: string; container: string; seq: number; suffix: string; full: string }
              const parsed: ParsedSKU[] = []
              let detectedPrefix = ''
              products.forEach((p: any) => {
                const m = (p.sku || '').match(skuRe)
                if (m) {
                  if (!detectedPrefix) detectedPrefix = m[1]
                  parsed.push({ prefix: m[1], container: m[2], seq: parseInt(m[3]), suffix: m[4], full: p.sku })
                }
              })

              // Gap finder: user types a prefix (e.g. "145") → find missing SKUs starting with those digits
              const gapPrefix = sheetContainer.replace(/\D/g,'')  // digits only
              let missingSKUs: string[] = []
              let gapNextSKU = ''
              if (gapPrefix.length >= 1) {
                // All base numbers (no suffix) whose string starts with gapPrefix
                const matchingBases = parsed
                  .filter(p => (p.container + String(p.seq).padStart(3,'0')).startsWith(gapPrefix) && p.suffix === '')
                  .map(p => parseInt(p.container + String(p.seq).padStart(3,'0')))
                // Also count bases that only exist as sub-items (parent was sold, A/B/C remain)
                const subOnlyBases = parsed
                  .filter(p => (p.container + String(p.seq).padStart(3,'0')).startsWith(gapPrefix) && p.suffix !== '')
                  .map(p => parseInt(p.container + String(p.seq).padStart(3,'0')))
                const usedNums = new Set([...matchingBases, ...subOnlyBases])
                if (usedNums.size > 0) {
                  const allNums = [...usedNums].sort((a,b) => a - b)
                  const minNum = allNums[0]
                  const maxNum = allNums[allNums.length - 1]
                  for (let i = minNum; i <= maxNum; i++) {
                    if (!usedNums.has(i)) missingSKUs.push(detectedPrefix + String(i))
                  }
                  gapNextSKU = detectedPrefix + String(maxNum + 1)
                }
              }

              // Build filter options
              const cats = ([...new Set(products.map((p: any) => p.category).filter(Boolean))] as string[]).sort()
              const makes = ([...new Set(products.map((p: any) => p.make).filter(Boolean))] as string[]).sort()
              const conds = ([...new Set(products.map((p: any) => p.condition).filter(Boolean))] as string[]).sort()

              // Apply sheet filters + search
              const s = productSearch.toLowerCase()
              let sheetRows = products.filter((p: any) => {
                if (!showSoldOut && p.quantity <= 0 && !productSearch && !gapPrefix) return false
                // When SKU prefix is typed, filter table to matching SKUs only
                if (gapPrefix && !(p.sku||'').startsWith(gapPrefix)) return false
                if (productSearch && !p.name.toLowerCase().includes(s) && !(p.sku||'').toLowerCase().includes(s) && !(p.make||'').toLowerCase().includes(s) && !(p.oem_code||'').toLowerCase().includes(s)) return false
                if (sheetFilters.category && p.category !== sheetFilters.category) return false
                if (sheetFilters.make && p.make !== sheetFilters.make) return false
                if (sheetFilters.condition && p.condition !== sheetFilters.condition) return false
                if (sheetFilters.status === 'active' && !p.is_active) return false
                if (sheetFilters.status === 'hidden' && p.is_active) return false
                if (sheetFilters.status === 'soldout' && p.quantity > 0) return false
                return true
              })

              // Sort — SKU sort groups sub-items with parent: sort by container → seq → suffix
              sheetRows = [...sheetRows].sort((a, b) => {
                const col = sheetSort.col
                const dir = sheetSort.dir === 'asc' ? 1 : -1
                let av: any, bv: any
                if (col === 'sku') {
                  const am = (a.sku||'').match(skuRe); const bm = (b.sku||'').match(skuRe)
                  // Sort by container, then seq, then suffix so sub-items stay with parent
                  if (am && bm) {
                    const cmp = (parseInt(am[2])*1000 + parseInt(am[3])) - (parseInt(bm[2])*1000 + parseInt(bm[3]))
                    if (cmp !== 0) return cmp * dir
                    return (am[4] < bm[4] ? -1 : am[4] > bm[4] ? 1 : 0) * dir
                  }
                  av = a.sku||''; bv = b.sku||''
                } else if (col === 'price') { av = a.price||0; bv = b.price||0 }
                else if (col === 'cost') { av = a.cost||0; bv = b.cost||0 }
                else if (col === 'qty') { av = a.quantity||0; bv = b.quantity||0 }
                else { av = (a[col]||'').toString().toLowerCase(); bv = (b[col]||'').toString().toLowerCase() }
                return av < bv ? -dir : av > bv ? dir : 0
              })

              const SortTh = ({ col, label }: { col: string; label: string }) => (
                <th onClick={() => setSheetSort(prev => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })}
                  className="px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 group">
                  {label}{sheetSort.col === col ? (sheetSort.dir === 'asc' ? ' ↑' : ' ↓') : <span className="opacity-0 group-hover:opacity-30"> ↕</span>}
                </th>
              )

              return (
                <div>
                  {/* ── SKU Gap Finder ── */}
                  <div className="mb-3 bg-white rounded-xl border border-slate-200 p-3 flex flex-wrap items-start gap-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Find Missing SKUs</label>
                        <input
                          type="text" value={sheetContainer} maxLength={6}
                          onChange={e => setSheetContainer(e.target.value.replace(/\D/g,''))}
                          placeholder="e.g. 145"
                          className="w-32 px-3 py-1.5 rounded-lg border-2 border-slate-200 text-sm font-mono outline-none focus:border-orange-400"
                        />
                      </div>
                      {gapNextSKU && (
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide mb-1">Next After Last</p>
                          <button onClick={() => { navigator.clipboard?.writeText(gapNextSKU); showToast('Copied: ' + gapNextSKU) }}
                            className="font-mono font-bold text-sm bg-emerald-50 text-emerald-700 border border-emerald-300 px-3 py-1.5 rounded-lg hover:bg-emerald-100 active:scale-95 transition">
                            {gapNextSKU} 📋
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      {gapPrefix.length === 0 && <p className="text-xs text-slate-400">Type digits above to find gaps — e.g. type <span className="font-mono font-bold">145</span> to see all missing SKUs in 145xxx</p>}
                      {gapPrefix.length > 0 && missingSKUs.length === 0 && gapNextSKU && <p className="text-sm text-emerald-600 font-semibold">✅ No gaps found in {gapPrefix}xxx</p>}
                      {missingSKUs.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wide mb-1.5">{missingSKUs.length} missing — click to copy</p>
                          <div className="flex flex-wrap gap-1">
                            {missingSKUs.slice(0, 50).map(sk => (
                              <button key={sk} onClick={() => { navigator.clipboard?.writeText(sk); showToast('Copied: ' + sk) }}
                                className="font-mono text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 active:scale-95 transition">
                                {sk}
                              </button>
                            ))}
                            {missingSKUs.length > 50 && <span className="text-[11px] text-amber-400 self-center">+{missingSKUs.length - 50} more</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Filter row */}
                  <div className="flex flex-wrap gap-2 mb-3">
                    <select value={sheetFilters.category} onChange={e => setSheetFilters(f => ({...f, category: e.target.value}))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold bg-white outline-none focus:border-orange-400">
                      <option value="">All Categories</option>
                      {cats.map((c: string) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={sheetFilters.make} onChange={e => setSheetFilters(f => ({...f, make: e.target.value}))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold bg-white outline-none focus:border-orange-400">
                      <option value="">All Makes</option>
                      {makes.map((m: string) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select value={sheetFilters.condition} onChange={e => setSheetFilters(f => ({...f, condition: e.target.value}))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold bg-white outline-none focus:border-orange-400">
                      <option value="">All Conditions</option>
                      {conds.map((c: string) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={sheetFilters.status} onChange={e => setSheetFilters(f => ({...f, status: e.target.value}))}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold bg-white outline-none focus:border-orange-400">
                      <option value="">All Status</option>
                      <option value="active">Active</option>
                      <option value="hidden">Hidden</option>
                      <option value="soldout">Sold Out</option>
                    </select>
                    {(sheetFilters.category || sheetFilters.make || sheetFilters.condition || sheetFilters.status) && (
                      <button onClick={() => setSheetFilters({category:'',make:'',condition:'',status:''})}
                        className="px-3 py-1.5 rounded-lg border border-red-200 text-xs font-bold text-red-500 bg-red-50 hover:bg-red-100">
                        ✕ Clear
                      </button>
                    )}
                    <span className="text-xs text-slate-400 self-center ml-auto">{sheetRows.length} of {products.length} products</span>
                  </div>

                  {/* Spreadsheet table */}
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="text-xs border-collapse" style={{minWidth:'1100px'}}>
                        <thead>
                          <tr className="bg-slate-50 border-b-2 border-slate-200 text-left">
                            <th className="px-3 py-2.5 text-[11px] font-bold text-slate-400 w-8">#</th>
                            <SortTh col="sku" label="SKU" />
                            <SortTh col="name" label="Name" />
                            <SortTh col="category" label="Category" />
                            <SortTh col="make" label="Make" />
                            <SortTh col="model" label="Model" />
                            <SortTh col="year" label="Year" />
                            <SortTh col="condition" label="Condition" />
                            <SortTh col="side" label="Side" />
                            <SortTh col="oem_code" label="OEM Code" />
                            <SortTh col="cost" label="Cost" />
                            <SortTh col="price" label="Price" />
                            <SortTh col="qty" label="Qty" />
                            <th className="px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">Location</th>
                            <SortTh col="is_active" label="Status" />
                            {showSoldOut && <th className="px-3 py-2.5 text-[11px] font-bold text-purple-500 uppercase tracking-wide whitespace-nowrap bg-purple-50">Sold Date</th>}
                            {showSoldOut && <th className="px-3 py-2.5 text-[11px] font-bold text-purple-500 uppercase tracking-wide whitespace-nowrap bg-purple-50">Sold Price</th>}
                            {showSoldOut && <th className="px-3 py-2.5 text-[11px] font-bold text-purple-500 uppercase tracking-wide whitespace-nowrap bg-purple-50">Customer</th>}
                            <th className="px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide sticky right-0 bg-slate-50">Edit</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sheetRows.map((p: any, i: number) => {
                            const loc = [p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ')
                            const pm = (p.sku||'').match(skuRe)
                            const isSubItem = pm && pm[4] !== ''   // has A/B/C suffix
                            const qtyColor = p.quantity <= 0 ? 'text-red-600 font-bold' : p.quantity <= 2 ? 'text-amber-600 font-bold' : 'text-slate-700'
                            const rowBg = isSubItem ? 'bg-blue-50/40' : i % 2 === 0 ? '' : 'bg-slate-50/50'
                            return (
                              <tr key={p.id} className={'border-b border-slate-100 hover:bg-orange-50/40 transition-colors ' + rowBg}>
                                <td className="px-3 py-2 text-slate-300 font-mono text-[10px]">{i + 1}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {isSubItem ? (
                                    <span className="font-mono font-bold text-blue-700">
                                      <span className="text-slate-400">└ </span>{p.sku}
                                      <span className="ml-1 text-[9px] font-bold bg-blue-100 text-blue-600 px-1 rounded">SUB</span>
                                    </span>
                                  ) : (
                                    <span className="font-mono font-bold text-slate-800">{p.sku || '—'}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 font-semibold text-slate-900 max-w-[200px]"><div className="truncate" title={p.name}>{p.name}</div></td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.category || '—'}</td>
                                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{p.make || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.model || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.year || '—'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  {p.condition ? <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded ' + (p.condition === 'New' ? 'bg-blue-50 text-blue-700' : p.condition === 'Reconditioned' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600')}>{p.condition}</span> : '—'}
                                </td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{p.side || '—'}</td>
                                <td className="px-3 py-2 font-mono text-slate-500 whitespace-nowrap">{p.oem_code || '—'}</td>
                                <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{p.cost ? 'Rs.' + (isLkTax ? costFloor(p) : Number(p.cost)).toLocaleString() : '—'}</td>
                                <td className="px-3 py-2 font-bold text-orange-600 whitespace-nowrap">{p.price ? 'Rs.' + Number(p.price).toLocaleString() : 'Ask'}</td>
                                <td className={'px-3 py-2 whitespace-nowrap ' + qtyColor}>{p.quantity}</td>
                                <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-[10px]">{loc || '—'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">
                                  <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded-full ' + (p.quantity <= 0 ? 'bg-red-100 text-red-600' : p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                                    {p.quantity <= 0 ? 'SOLD' : p.is_active ? 'ACTIVE' : 'HIDDEN'}
                                  </span>
                                </td>
                                {showSoldOut && (() => {
                                  const si = soldProductInfo[p.id]
                                  const soldDate = si?.sold_date ? new Date(si.sold_date).toLocaleDateString('en-LK', {day:'2-digit',month:'short',year:'numeric'}) : '—'
                                  return (<>
                                    <td className="px-3 py-2 whitespace-nowrap text-[11px] text-purple-700 bg-purple-50/40">{soldDate}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-[11px] font-bold text-purple-700 bg-purple-50/40">{si?.sold_price ? 'Rs.' + Number(si.sold_price).toLocaleString() : '—'}</td>
                                    <td className="px-3 py-2 whitespace-nowrap text-[11px] text-purple-600 bg-purple-50/40 max-w-[140px]"><div className="truncate">{si?.customer_name || '—'}</div></td>
                                  </>)
                                })()}
                                <td className="px-3 py-2 sticky right-0 bg-white border-l border-slate-100">
                                  <button onClick={() => { setEditingProduct({...p}); setEditProductImages(p.images || []) }}
                                    className="text-[11px] font-semibold text-blue-600 px-2.5 py-1 rounded border border-blue-200 hover:bg-blue-50 whitespace-nowrap">
                                    ✏️ Edit
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )
            })()}

          </>)}
        </div>)}

        {/* ADD PRODUCT */}
        {tab === 'add' && (<div className="max-w-2xl">
          <h1 className="text-2xl font-black text-slate-900 mb-6">Add Product</h1>
          <form onSubmit={handleAddProduct} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3"><label className="block text-xs font-bold text-blue-800 mb-1">Part ID</label><input value={newProduct.partId} onChange={e => setNewProduct({...newProduct, partId: e.target.value.toUpperCase()})} className="w-full px-3 py-2.5 rounded-lg border-2 border-blue-200 text-sm outline-none font-mono font-bold bg-white" placeholder="Auto-generated if blank" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label><input required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Description</label><textarea value={newProduct.description} onChange={e => setNewProduct({...newProduct, description: e.target.value})} rows={2} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none resize-none" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Category</label><select value={newProduct.category} onChange={e => {
                const cat = e.target.value
                const isTyre = cat === 'Wheels & Tires'
                setNewProduct({...newProduct, category: cat, product_type: isTyre ? 'tyre' : 'part', tyre_width: isTyre ? newProduct.tyre_width : '', tyre_profile: isTyre ? newProduct.tyre_profile : '', tyre_rim: isTyre ? newProduct.tyre_rim : ''})
              }} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div>
              <div><label className="block text-xs font-semibold text-slate-600 mb-1">Condition</label><select value={newProduct.condition} onChange={e => setNewProduct({...newProduct, condition: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none">{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div>
            </div>

            {/* ── TYRE MODE: Width / Profile / Rim + Brand ── */}
            {newProduct.category === 'Wheels & Tires' ? (<>
              <div className="bg-sky-50 border border-sky-200 rounded-xl p-3 space-y-3">
                <div className="flex items-center gap-2"><span className="text-sky-600 text-sm">🏎️</span><span className="text-xs font-bold text-sky-800">Tyre Size</span>
                  {newProduct.tyre_width && newProduct.tyre_profile && newProduct.tyre_rim && (
                    <span className="ml-auto font-mono text-xs font-bold text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full">
                      {newProduct.tyre_width}/{newProduct.tyre_profile}R{newProduct.tyre_rim}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div><label className="block text-[10px] font-semibold text-sky-700 mb-1">Width (mm)</label>
                    <select value={newProduct.tyre_width} onChange={e => {
                      const np = {...newProduct, tyre_width: e.target.value}
                      if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim) np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                      setNewProduct(np)
                    }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-sm outline-none bg-white focus:border-sky-400">
                      <option value="">–</option>{TYRE_WIDTHS.map(w => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-semibold text-sky-700 mb-1">Profile (%)</label>
                    <select value={newProduct.tyre_profile} onChange={e => {
                      const np = {...newProduct, tyre_profile: e.target.value}
                      if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim) np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                      setNewProduct(np)
                    }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-sm outline-none bg-white focus:border-sky-400">
                      <option value="">–</option>{TYRE_PROFILES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div><label className="block text-[10px] font-semibold text-sky-700 mb-1">Rim (inch)</label>
                    <select value={newProduct.tyre_rim} onChange={e => {
                      const np = {...newProduct, tyre_rim: e.target.value}
                      if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim) np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                      setNewProduct(np)
                    }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-sm outline-none bg-white focus:border-sky-400">
                      <option value="">–</option>{TYRE_RIMS.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                </div>
                <div><label className="block text-[10px] font-semibold text-sky-700 mb-1">Brand</label>
                  <select value={newProduct.make} onChange={e => {
                    const np = {...newProduct, make: e.target.value}
                    if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim) np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                    setNewProduct(np)
                  }} className="w-full px-3 py-2 rounded-lg border-2 border-sky-200 text-sm outline-none bg-white focus:border-sky-400">
                    <option value="">Select brand…</option>{TYRE_BRANDS.map(b => <option key={b} value={b === 'Other Brand' ? '' : b}>{b}</option>)}
                  </select>
                </div>
                {newProduct.tyre_width && newProduct.tyre_profile && newProduct.tyre_rim && (
                  <button type="button" onClick={() => setNewProduct({...newProduct, name: `${newProduct.tyre_width}/${newProduct.tyre_profile}R${newProduct.tyre_rim}${newProduct.make ? ' ' + newProduct.make : ''}`.trim()})}
                    className="text-[11px] text-sky-700 underline hover:text-sky-900">
                    ↑ Auto-fill name from size
                  </button>
                )}
              </div>
            </>) : (
              /* Normal part: Make / Model / Year */
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Make</label><input value={newProduct.make} onChange={e => setNewProduct({...newProduct, make: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Toyota" /></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Model</label><input value={newProduct.model} onChange={e => setNewProduct({...newProduct, model: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1">Year</label><input value={newProduct.year} onChange={e => setNewProduct({...newProduct, year: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Model Code</label><input value={newProduct.modelCode} onChange={e => setNewProduct({...newProduct, modelCode: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="ZRE172" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Side</label><select value={newProduct.side} onChange={e => setNewProduct({...newProduct, side: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none"><option value="">Any</option><option>Front</option><option>Rear</option><option>Left</option><option>Right</option><option>Front Left</option><option>Front Right</option><option>Rear Left</option><option>Rear Right</option></select></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Color</label><input value={newProduct.color} onChange={e => setNewProduct({...newProduct, color: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Black" /></div></div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">OEM Code</label><input value={newProduct.oemCode} onChange={e => setNewProduct({...newProduct, oemCode: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none font-mono" placeholder="A12345" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Manufactured Country <span className="font-normal text-[10px] text-slate-400">(optional)</span></label><input value={newProduct.origin_country} onChange={e => setNewProduct({...newProduct, origin_country: e.target.value})} list="origin-country-list" className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="e.g. Japan" /><datalist id="origin-country-list"><option value="Japan" /><option value="Thailand" /><option value="China" /><option value="India" /><option value="Indonesia" /><option value="South Korea" /><option value="Sri Lanka" /><option value="Taiwan" /><option value="Vietnam" /><option value="Germany" /></datalist></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Opening Cost (Rs.) <span className="font-normal text-[10px] text-slate-400">excl. VAT</span></label><input type="number" value={newProduct.cost} onChange={e => setNewProduct({...newProduct, cost: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Purchase cost" /></div></div>
            {newProduct.cost && parseInt(newProduct.cost) > 0 && parseInt(newProduct.quantity) > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-[11px] text-green-700">✅ A FIFO cost layer will be created: {newProduct.quantity} unit{parseInt(newProduct.quantity) !== 1 ? 's' : ''} @ Rs.{parseInt(newProduct.cost).toLocaleString()} — GP tracking enabled from first sale.</div>
            )}
            {newProduct.cost && parseInt(newProduct.cost) > 0 && (!newProduct.quantity || parseInt(newProduct.quantity) === 0) && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-700">⚠️ Cost entered but Quantity is 0 — no cost layer created. Use Stock → Receive Stock to add stock with cost tracking.</div>
            )}
            <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Price (Rs.)</label><input type="number" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Quantity</label><input type="number" value={newProduct.quantity} onChange={e => setNewProduct({...newProduct, quantity: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" />{isLkTax && Number(newProduct.quantity) > 0 && (<p className="text-[10px] text-slate-400 mt-1">Bought from a local supplier? Use <button type="button" onClick={() => startTransition(() => { setTab('stocktake'); setStockInitialView('receive') })} className="font-bold text-orange-600 underline">Receive Stock (GRN)</button> instead — that records what you owe and the VAT. Quantity here is for old stock and containers.</p>)}</div></div>
            {parseInt(newProduct.price) > 0 && parseInt(newProduct.cost) > 0 && (isBelowCost(marginBase(newProduct.price), parseInt(newProduct.cost))
              ? <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-[11px] text-red-700 font-bold">⚠️ Selling price Rs.{parseInt(newProduct.price).toLocaleString()}{isLkTax ? ` (Rs.${marginBase(newProduct.price).toLocaleString()} excl. VAT)` : ''} is at or below cost (Rs.{parseInt(newProduct.cost).toLocaleString()}) — no profit.</div>
              : <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-[11px] text-green-700">✅ Margin: GP {gpPercent(marginBase(newProduct.price), parseInt(newProduct.cost))}%{isLkTax ? ' (net of VAT)' : ''} · profit Rs.{(marginBase(newProduct.price) - parseInt(newProduct.cost)).toLocaleString()}/unit (cost Rs.{parseInt(newProduct.cost).toLocaleString()})</div>)}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <label className="block text-xs font-bold text-amber-800">📍 Warehouse Location <span className="font-normal text-amber-600">(optional)</span></label>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Store</label><input value={newProduct.loc_store} onChange={e => setNewProduct({...newProduct, loc_store: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Main Store" /></div>
                <div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Floor</label><input value={newProduct.loc_floor} onChange={e => setNewProduct({...newProduct, loc_floor: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Ground" /></div>
                <div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Sub Location 1</label><input value={newProduct.loc_sub1} onChange={e => setNewProduct({...newProduct, loc_sub1: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Rack A" /></div>
                <div><label className="block text-[10px] font-semibold text-amber-700 mb-1">Sub Location 2</label><input value={newProduct.loc_sub2} onChange={e => setNewProduct({...newProduct, loc_sub2: e.target.value})} className="w-full px-2.5 py-2 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Bin 5" /></div>
              </div>
            </div>
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3"><div><p className="text-xs font-semibold text-slate-700">Show Price Publicly</p><p className="text-[11px] text-slate-400 mt-0.5">Customers will see the price on the listing</p></div><button type="button" onClick={() => setNewProduct({...newProduct, show_price: !newProduct.show_price})} className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (newProduct.show_price ? 'bg-orange-500' : 'bg-slate-300')}><span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (newProduct.show_price ? 'translate-x-6' : 'translate-x-1')} /></button></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-2">Images</label><input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" /><div className="flex flex-wrap gap-3">{imagePreviews.map((p, i) => (<div key={i} className="relative w-24 h-24 sm:w-20 sm:h-20 rounded-lg overflow-hidden border-2 border-slate-200"><img src={p} alt="" className="w-full h-full object-cover" /><button type="button" onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 w-6 h-6 sm:w-5 sm:h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center">x</button></div>))}<button type="button" onClick={() => fileInputRef.current?.click()} className="w-24 h-24 sm:w-20 sm:h-20 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-orange-400 active:border-orange-400 active:bg-orange-50"><span className="text-2xl sm:text-xl">+</span></button></div></div>
            <button type="submit" disabled={addLoading} className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 rounded-xl disabled:opacity-50">{addLoading ? 'Creating...' : 'Add Product'}</button>
          </form>
        </div>)}

        {/* BULK */}
        {tab === 'bulk' && (<div>
          <h1 className="text-2xl font-black text-slate-900 mb-4">Bulk Upload</h1>

          {/* Step-by-step guide */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">

            {/* Step 1: Download Template */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-3"><span className="bg-orange-100 text-orange-600 text-[10px] font-black px-2.5 py-1 rounded-full">STEP 1</span><h3 className="font-bold text-sm">Download CSV Template</h3></div>
              <p className="text-xs text-slate-500 mb-3">Download the template, fill in your product details in Excel or Google Sheets, then save as CSV.</p>
              <button onClick={() => {
                const csv = 'Added Date,stock no,Part name,Part Description,Category,Make,Model,Model Code,Condition,Side,Color,OEM Code,Quantity,Cost,Price,show price,Store,Floor,Sub Location 1,Sub Location 2,Product Type,Tyre Width,Tyre Profile,Tyre Rim,Manufactured Country\n12-Mar-2026,BRK-001,Front Brake Pads Set,OEM quality brake pads,Brake System,Toyota,Corolla,ZRE172,Reconditioned,Front,Black,,10,,4500,YES,Main Store,Ground,Rack A,Bin 3,part,,,,Japan\n12-Mar-2026,TYR-001,185/65R15 Bridgestone Ecopia EP150,,Tyres,Bridgestone,,,New,,,,20,5500,6800,YES,Main Store,Ground,Tyre Rack,,tyre,185,65,15,Japan\n12-Mar-2026,TYR-002,205/55R16 Michelin Primacy 4,,Tyres,Michelin,,,New,,,,8,9200,11500,YES,Main Store,Ground,Tyre Rack,,tyre,205,55,16,Thailand\n12-Mar-2026,ENG-002,Timing Belt Kit,Complete kit with tensioner,Engine Parts,Honda,Civic,FK7,New,,,A4567,5,8000,12500,YES,Main Store,Ground,Rack B,,part,,,,'
                const blob = new Blob([csv], { type: 'text/csv' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a'); a.href = url; a.download = 'kuruma-bulk-template.csv'; a.click()
                URL.revokeObjectURL(url)
                showToast('Template downloaded!')
              }} className="w-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-bold py-3 rounded-xl transition">📥 Download CSV Template</button>
              <div className="mt-3 bg-slate-50 rounded-lg p-3 text-[11px] text-slate-500 font-mono overflow-x-auto">
                <table className="w-full">
                  <thead><tr className="text-slate-400 text-left"><th className="pr-2">part_id</th><th className="pr-2">name</th><th className="pr-2">category</th><th className="pr-2">price</th><th>qty</th></tr></thead>
                  <tbody><tr><td className="pr-2">BRK-001</td><td className="pr-2">Brake Pads</td><td className="pr-2">Brakes</td><td className="pr-2">4500</td><td>10</td></tr><tr><td className="pr-2">ENG-002</td><td className="pr-2">Timing Belt</td><td className="pr-2">Engine Parts</td><td className="pr-2">12500</td><td>5</td></tr></tbody>
                </table>
              </div>
              <div className="mt-2 text-[10px] text-slate-400">
                <p><strong>Columns:</strong> Added Date, stock no, Part name, Part Description, Category, Make, Model, Model Code, Condition, Side, Color, OEM Code, Quantity, Cost, Price, show price, Store, Floor, Sub Location 1, Sub Location 2, Product Type, Tyre Width, Tyre Profile, Tyre Rim, Manufactured Country</p>
                <p className="mt-1"><strong>show price:</strong> YES or NO</p>
                <p><strong>Product Type:</strong> <code>part</code> (default), <code>tyre</code>, or <code>service</code>. For tyres, also fill Tyre Width / Profile / Rim (e.g. 185, 65, 15 for 185/65R15).</p>
                <p><strong>Manufactured Country:</strong> optional — e.g. Japan, Thailand, China, India, Indonesia. Leave blank if unknown.</p>
                <p><strong>Location columns</strong> are optional — leave blank if not needed</p>
                <p><strong>Categories:</strong> {CATEGORIES.join(', ')}</p>
                <p><strong>Conditions:</strong> New-Genuine, New-Other, Reconditioned, Damaged</p>
              </div>
            </div>

            {/* Step 2: Compress Images */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center gap-2 mb-3"><span className="bg-purple-100 text-purple-600 text-[10px] font-black px-2.5 py-1 rounded-full">STEP 2</span><h3 className="font-bold text-sm">Compress Product Images</h3></div>
              <p className="text-xs text-slate-500 mb-3">Use our offline image compressor to organize and compress your product photos into a ZIP file.</p>
              <a href="/tools/compressor.html" target="_blank" className="block w-full bg-purple-500 hover:bg-purple-600 text-white text-sm font-bold py-3 rounded-xl transition text-center">🖼️ Open Image Compressor</a>
              <div className="mt-3 bg-purple-50 border border-purple-100 rounded-lg p-3">
                <p className="text-xs text-purple-700 font-semibold mb-2">How to prepare images:</p>
                <div className="text-[11px] text-purple-600 font-mono bg-white rounded p-2 leading-relaxed">
                  My Product Photos/<br/>
                  &nbsp;&nbsp;BRK-001/ &nbsp;&nbsp;← Part ID as folder name<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;front.jpg<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;back.jpg<br/>
                  &nbsp;&nbsp;ENG-002/<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;photo1.jpg<br/>
                  &nbsp;&nbsp;&nbsp;&nbsp;photo2.jpg
                </div>
                <p className="text-[10px] text-purple-500 mt-2">Folder names must match the <strong>part_id</strong> in your CSV. The compressor outputs a ZIP ready for Step 4.</p>
              </div>
            </div>
          </div>

          {/* Step 3 & 4: Upload */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-5 hover:border-orange-400 transition">
              <div className="flex items-center gap-2 mb-3"><span className="bg-green-100 text-green-600 text-[10px] font-black px-2.5 py-1 rounded-full">STEP 3</span><h3 className="font-bold text-sm">Upload CSV File</h3></div>
              <input ref={bulkFileRef} type="file" accept=".csv" onChange={handleBulkFileUpload} className="hidden" />
              <button onClick={() => bulkFileRef.current?.click()} className="w-full py-8 border-2 border-dashed border-slate-200 rounded-xl hover:border-orange-400 hover:bg-orange-50 transition">
                <span className="text-3xl block mb-2">📄</span>
                <span className="font-bold text-sm text-slate-600">{bulkFile || 'Click to select your filled CSV'}</span>
                {bulkFile && <span className="block text-xs text-green-600 font-semibold mt-1">✓ {bulkData.length} products loaded</span>}
              </button>
            </div>

            <div className={'bg-white rounded-xl border-2 border-dashed p-5 transition ' + (bulkData.length ? 'border-slate-200 hover:border-green-400' : 'border-slate-100 opacity-60')}>
              <div className="flex items-center gap-2 mb-3"><span className={'text-[10px] font-black px-2.5 py-1 rounded-full ' + (bulkData.length ? 'bg-cyan-100 text-cyan-600' : 'bg-slate-100 text-slate-400')}>STEP 4</span><h3 className="font-bold text-sm">Upload ZIP Images (multiple supported)</h3></div>
              <input ref={zipFileRef} type="file" accept=".zip" multiple onChange={handleZipUpload} className="hidden" />
              <button onClick={() => { if (!bulkData.length) { showToast('Upload CSV first (Step 3)'); return }; zipFileRef.current?.click() }} disabled={zipProcessing} className="w-full py-8 border-2 border-dashed border-slate-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition disabled:opacity-50">
                <span className="text-3xl block mb-2">📦</span>
                <span className="font-bold text-sm text-slate-600">{zipProcessing ? 'Processing...' : zipFiles.length > 0 ? `${zipFiles.length} ZIP file${zipFiles.length > 1 ? 's' : ''} loaded` : 'Click to select ZIP file(s)'}</span>
                {zipFiles.length > 0 && !zipProcessing && <span className="block text-[11px] text-slate-400 mt-1">{zipFiles.join(', ')}</span>}
                {zipSummary && <span className="block text-xs text-green-600 font-semibold mt-1">✓ {zipSummary.matched} products matched ({zipSummary.totalImages} images) from {zipSummary.zipCount} ZIP{zipSummary.zipCount > 1 ? 's' : ''}</span>}
                {zipSummary && zipSummary.unmatched > 0 && <span className="block text-xs text-amber-500 font-semibold mt-0.5">⚠ {zipSummary.unmatched} folders didn&apos;t match any Part ID</span>}
              </button>
              {/* ZIP processing progress */}
              {zipProcessing && zipProgress.total > 0 && (
                <div className="mt-3 bg-slate-50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-slate-600">{zipProgress.label}</span>
                    <span className="text-xs font-mono text-slate-400">{zipProgress.current}/{zipProgress.total}</span>
                  </div>
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.round((zipProgress.current / zipProgress.total) * 100)}%`, background: 'linear-gradient(90deg, #06b6d4, #10b981)' }} />
                  </div>
                  {zipProgress.detail && <p className="text-[10px] text-slate-400 mt-1 truncate">{zipProgress.detail}</p>}
                </div>
              )}
              {!bulkData.length && <p className="text-[10px] text-slate-400 mt-2 text-center">Upload CSV first to enable this step</p>}
            </div>
          </div>

          {/* Step 5: Review & Import */}
          {bulkData.length > 0 && (<div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><span className="bg-orange-100 text-orange-600 text-[10px] font-black px-2.5 py-1 rounded-full">STEP 5</span><h3 className="font-bold">Review & Import ({bulkData.length} products)</h3></div>
              <div className="flex gap-2">
                <button onClick={() => { setBulkData([]); setBulkFile(''); setZipFiles([]); setZipSummary(null) }} className="text-sm text-slate-500 px-3 py-1.5 rounded-lg border border-slate-200">Clear All</button>
                <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200"><input type="checkbox" checked={onlyWithImages} onChange={e => setOnlyWithImages(e.target.checked)} className="w-4 h-4 accent-orange-500" />Only with images</label>
                <button onClick={retryMissingImages} disabled={bulkLoading} className="bg-blue-500 text-white text-sm font-bold px-5 py-1.5 rounded-lg disabled:opacity-50 hover:bg-blue-600">{bulkLoading ? 'Retrying...' : '🔄 Retry Missing Images'}</button>
                <button onClick={handleBulkImport} disabled={bulkLoading} className="bg-orange-500 text-white text-sm font-bold px-5 py-1.5 rounded-lg disabled:opacity-50 hover:bg-orange-600">{bulkLoading ? 'Importing...' : '🚀 Import All'}</button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Stock No</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Part Name</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Category</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Make / Model</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Model Code</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Condition</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Side</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Color</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">OEM Code</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Cost</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Price</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Qty</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Show</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Images</th><th className="px-3 py-2"></th></tr></thead><tbody>{bulkData.map((r, i) => (<tr key={i} className={'border-t ' + (!r.hasImage ? 'bg-amber-50/50' : '')}><td className="px-3 py-2"><span className="font-mono text-xs px-2 py-0.5 rounded font-bold bg-slate-100">{r.partId}</span></td>
<td className="px-3 py-2"><input value={r.name} onChange={e => updateBulkRow(i,'name',e.target.value)} className="w-36 px-2 py-1 border border-slate-200 rounded text-xs" /></td>
<td className="px-3 py-2"><select value={r.category} onChange={e => updateBulkRow(i,'category',e.target.value)} className="px-2 py-1 border border-slate-200 rounded text-xs">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></td>
<td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">{[r.make, r.model].filter(Boolean).join(' ') || '-'}</td>
<td className="px-3 py-2"><input value={r.modelCode || ''} onChange={e => updateBulkRow(i,'modelCode',e.target.value)} className="w-20 px-2 py-1 border border-slate-200 rounded text-xs font-mono" placeholder="—" /></td>
<td className="px-3 py-2 text-xs text-slate-500">{r.condition || '-'}</td>
<td className="px-3 py-2 text-xs text-slate-500">{r.side || '—'}</td>
<td className="px-3 py-2 text-xs text-slate-500">{r.color || '—'}</td>
<td className="px-3 py-2"><input value={r.oemCode || ''} onChange={e => updateBulkRow(i,'oemCode',e.target.value)} className="w-24 px-2 py-1 border border-slate-200 rounded text-xs font-mono" placeholder="—" /></td>
<td className="px-3 py-2"><input type="text" inputMode="numeric" value={r.cost || ''} onChange={e => updateBulkRow(i,'cost',e.target.value)} className="w-20 px-2 py-1 border border-slate-200 rounded text-xs" placeholder="—" /></td>
<td className="px-3 py-2"><input type="text" inputMode="numeric" value={r.price} onChange={e => updateBulkRow(i,'price',e.target.value)} className="w-20 px-2 py-1 border border-slate-200 rounded text-xs" /></td>
<td className="px-3 py-2"><input type="number" value={r.quantity} onChange={e => updateBulkRow(i,'quantity',e.target.value)} className="w-14 px-2 py-1 border border-slate-200 rounded text-xs" /></td>
<td className="px-3 py-2"><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${r.show_price ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-400'}`}>{r.show_price ? 'YES' : 'NO'}</span></td>
<td className="px-3 py-2">{r.hasImage ? <span className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">✓ {r.imageCount}</span> : <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">No images</span>}</td>
<td className="px-3 py-2"><button onClick={() => removeBulkRow(i)} className="text-red-400 hover:text-red-600 text-xs font-bold">✕</button></td></tr>))}</tbody></table></div></div>
          </div>)}

            {/* Feature 2: Import Progress Bar */}
            {bulkLoading && bulkProgress.total > 0 && (
              <div className="bg-white rounded-xl border-2 border-orange-400 p-5 mb-4 mt-4 sticky top-[52px] z-40 shadow-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-slate-700">{bulkProgress.phase}</span>
                  <span className="text-xs font-mono text-slate-400">{Math.round((bulkProgress.current / bulkProgress.total) * 100)}%</span>
                </div>
                <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500 ease-out" style={{
                    width: `${Math.round((bulkProgress.current / bulkProgress.total) * 100)}%`,
                    background: bulkProgress.phase === 'Complete!' ? 'linear-gradient(90deg, #06D6A0, #10B981)' : 'linear-gradient(90deg, #FF6B35, #F59E0B)'
                  }} />
                </div>
                {bulkProgress.detail && <p className="text-xs text-slate-400 mt-1.5">{bulkProgress.detail}</p>}
              </div>
            )}

            {/* Feature 1: Duplicate SKU Warning Modal */}
            {showDuplicateModal && (
              <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowDuplicateModal(false)}>
                <div className="bg-white rounded-2xl max-w-lg w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                  <div className="bg-amber-50 border-b border-amber-200 px-5 py-4">
                    <h3 className="font-bold text-base text-amber-800 flex items-center gap-2">⚠️ {bulkDuplicates.length} Duplicate SKU{bulkDuplicates.length > 1 ? 's' : ''} Found</h3>
                    <p className="text-xs text-amber-600 mt-1">These Part IDs already exist in your shop. Choose how to handle them:</p>
                  </div>
                  <div className="px-5 py-3 max-h-48 overflow-y-auto border-b border-slate-100">
                    {bulkDuplicates.map((d: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                        <span className="font-mono text-xs font-bold text-slate-700">{d.sku}</span>
                        <span className="text-xs text-slate-400 truncate ml-3">{d.name}</span>
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-4 space-y-2">
                    <label className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition hover:bg-slate-50" style={{ borderColor: duplicateAction === 'skip' ? '#FF6B35' : '#E2E8F0' }} onClick={() => setDuplicateAction('skip')}>
                      <input type="radio" name="dupAction" checked={duplicateAction === 'skip'} onChange={() => setDuplicateAction('skip')} className="mt-0.5 accent-orange-500" />
                      <div><span className="font-bold text-sm text-slate-800">Skip Duplicates</span><p className="text-xs text-slate-400 mt-0.5">Only import new products. Existing ones stay unchanged.</p></div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-lg border-2 cursor-pointer transition hover:bg-slate-50" style={{ borderColor: duplicateAction === 'update' ? '#FF6B35' : '#E2E8F0' }} onClick={() => setDuplicateAction('update')}>
                      <input type="radio" name="dupAction" checked={duplicateAction === 'update'} onChange={() => setDuplicateAction('update')} className="mt-0.5 accent-orange-500" />
                      <div><span className="font-bold text-sm text-slate-800">Update Existing</span><p className="text-xs text-slate-400 mt-0.5">Overwrite duplicate products with the new CSV data.</p></div>
                    </label>
                  </div>
                  <div className="px-5 py-3 bg-slate-50 flex gap-2 justify-end rounded-b-2xl">
                    <button onClick={() => { setShowDuplicateModal(false); setBulkLoading(false) }} className="text-sm text-slate-500 px-4 py-2 font-semibold">Cancel</button>
                    <button onClick={() => executeBulkImport(duplicateAction)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-5 py-2 rounded-lg">
                      {duplicateAction === 'skip' ? `Import ${bulkData.length - bulkDuplicates.length} New` : `Import & Update All ${bulkData.length}`}
                    </button>
                  </div>
                </div>
              </div>
            )}
        </div>)}

        {/* POS — always mounted so mid-transaction state survives tab switches (Bug #2).
              onDataChanged uses silent=true so the full-page loading spinner doesn't flash
              and unmount the POS component after a sale, preserving the receipt screen (Bug #1). */}
        <div className={tab === 'pos' ? '' : 'hidden'}>
          {isLkTax ? (
            <TabPOSLkTax
              vendor={vendor}
              products={products}
              vendorSettings={vendorSettings}
              showToast={showToast}
              onDataChanged={() => fetchData(undefined, true)}
              pendingDraft={pendingPosDraft}
              onDraftLoaded={() => setPendingPosDraft(null)}
              pendingAddItems={pendingAddItems}
              onItemsAdded={() => setPendingAddItems(null)}
            />
          ) : (
            <TabPOSStandard
              vendor={vendor}
              products={products}
              vendorSettings={vendorSettings}
              showToast={showToast}
              onDataChanged={() => fetchData(undefined, true)}
              pendingDraft={pendingPosDraft}
              onDraftLoaded={() => setPendingPosDraft(null)}
            />
          )}
        </div>



        {/* SALES */}
        {tab === 'sales' && (<div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h1 className="text-2xl font-black">📊 Sales & Analytics</h1>
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => { const today = colomboToday(); setExportFrom(today); setExportTo(today); setShowExportModal(true) }} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">⬇ Export CSV</button>
            {isLkTax && (
              <div className="flex gap-1 bg-white rounded-lg border border-slate-200 p-1">
                {[{v:'',l:'All'},{v:'shop',l:'🏪 Shop'},{v:'workshop',l:'🔧 Workshop'}].map(b => (
                  <button key={b.v} onClick={() => setSalesBranch(b.v as any)}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${salesBranch === b.v ? 'bg-slate-800 text-white' : 'text-slate-500 active:bg-slate-100'}`}>{b.l}</button>
                ))}
              </div>
            )}
            <div className="flex gap-1 bg-white rounded-lg border border-slate-200 p-1">
              {[{v:'today',l:'Today'},{v:'week',l:'Week'},{v:'month',l:'Month'},{v:'all',l:'All'}].map(p => (
                <button key={p.v} onClick={() => setSalesPeriod(p.v)} className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${salesPeriod === p.v ? 'bg-orange-500 text-white' : 'text-slate-500 active:bg-slate-100'}`}>{p.l}</button>
              ))}
            </div>
            </div>
          </div>

          {/* ── Export Modal ── */}
          {showExportModal && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setShowExportModal(false)}>
              <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-slate-900 mb-1">Export Sales</h3>
                <p className="text-xs text-slate-400 mb-4">Select a date range to export</p>
                <div className="space-y-3 mb-5">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">From Date</label>
                    <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">To Date</label>
                    <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>
                <div className="space-y-2">
                  <button onClick={handleExportSummaryPDF} disabled={exportLoading || !exportFrom || !exportTo} className="w-full bg-orange-500 text-white font-bold text-sm py-2.5 rounded-xl disabled:opacity-50 hover:bg-orange-600">
                    {exportLoading ? 'Generating…' : '📄 Sales Summary PDF'}
                  </button>
                  <button onClick={() => handleExportCSV('items')} disabled={exportLoading || !exportFrom || !exportTo} className="w-full bg-emerald-600 text-white font-bold text-sm py-2.5 rounded-xl disabled:opacity-50 hover:bg-emerald-700">
                    {exportLoading ? 'Exporting…' : '⬇ Line Items CSV (Profit Analysis)'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-400 mt-3 text-center">Voided invoices are excluded from export</p>
              </div>
            </div>
          )}

          {salesLoading ? <div className="text-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : salesData ? (<div>

            {/* Sub-tabs: Overview / Transactions / Customers */}
            {(() => {
              const [salesSubTab, setSalesSubTab] = [salesView, setSalesView] as [string, (v: string) => void]
              return (<>
                <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1">
                  {/* WHEEL MART's tax reports now live in the Tax tab, not here */}
                  {([{v:'overview',l:'Overview'},{v:'transactions',l:'Transactions'},{v:'customers',l:'Customers'},...(!isLkTax ? [{v:'reports',l:'📊 Reports'}] : [])]).map(t => (
                    <button key={t.v} onClick={() => setSalesSubTab(t.v)} className={`flex-1 py-2 text-xs font-bold rounded-md transition ${salesSubTab === t.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t.l}</button>
                  ))}
                </div>


                {/* ─── OVERVIEW ─── */}
                {salesSubTab === 'overview' && (<div>
                  {/* Stats cards — 2 cols mobile, 3 cols desktop */}
                  {/* WHEEL MART ONLY: Sakura is cost-less by choice — sales tracking only,
                      no profit calculations anywhere in its view (owner rule). */}
                  {isLkTax && (() => {
                    // ── Three-way profit split (owner rule, Aug 2026) ──
                    // real cost (sale-time FIFO snapshot, or product cost entered later)
                    //   → normal profit; rough cost (product cost flagged ~estimate)
                    //   → profit shown separately as estimate-based; NO cost at all
                    //   → excluded from profit, revenue listed on its own line.
                    // Manual service lines have no cost concept — full revenue is profit.
                    const validSales = (salesData.sales || []).filter((s: any) => s.payment_status !== 'voided')
                    const prodBySku = new Map((data?.products || []).filter((p: any) => p.sku).map((p: any) => [p.sku, p]))
                    let realRev = 0, realCogs = 0, roughRev = 0, roughCogs = 0, noCostRev = 0
                    const noCost = new Map<string, { name: string; sku: string; qty: number; rev: number; productId: string | null }>()
                    for (const s of validSales) {
                      for (const i of (s.items || [])) {
                        if (i.product_sku === 'OPENING-BAL') continue
                        const qty = i.quantity - (i.returned_quantity || 0)
                        if (qty <= 0) continue
                        const rev = qty * parseFloat(i.unit_price || 0)
                        const snap = i.unit_cost != null && parseInt(i.unit_cost) > 0 ? parseInt(i.unit_cost) : null
                        const prod: any = i.product_sku ? prodBySku.get(i.product_sku) : null
                        if (snap != null) { realRev += rev; realCogs += snap * qty }
                        else if (!i.product_sku) { realRev += rev } // typed service line — no COGS
                        else if (prod && parseInt(prod.cost) > 0) {
                          if (prod.cost_is_estimate) { roughRev += rev; roughCogs += parseInt(prod.cost) * qty }
                          else { realRev += rev; realCogs += parseInt(prod.cost) * qty }
                        } else {
                          noCostRev += rev
                          const key = i.product_sku
                          const e = noCost.get(key) || { name: i.product_name, sku: key, qty: 0, rev: 0, productId: prod?.id || null }
                          e.qty += qty; e.rev += rev
                          noCost.set(key, e)
                        }
                      }
                    }
                    const realGp = realRev - realCogs
                    const roughGp = roughRev - roughCogs
                    const profitRev = realRev + roughRev
                    const gpPct = profitRev > 0 ? Math.round((realGp + roughGp) / profitRev * 100) : null
                    if (realCogs + roughCogs + noCostRev === 0) return null
                    const noCostList = [...noCost.values()].sort((a, b) => b.rev - a.rev)
                    return (
                      <div className="mb-3 bg-white rounded-xl border border-purple-200 p-3.5 sm:p-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <p className={`text-lg sm:text-xl font-black ${realGp + roughGp >= 0 ? 'text-purple-600' : 'text-red-600'}`}>Rs.{(realGp + roughGp).toLocaleString()}</p>
                            <p className="text-[11px] text-slate-400 font-semibold">Gross Profit {gpPct !== null ? `(${gpPct}% margin)` : ''}</p>
                            {roughGp !== 0 && <p className="text-[10px] text-amber-600 font-semibold mt-0.5">includes ~Rs.{roughGp.toLocaleString()} from rough-cost items</p>}
                          </div>
                          <div className="text-right text-[10px] text-slate-400">
                            <p>Profit (actual costs): <span className="font-bold text-slate-600">Rs.{realGp.toLocaleString()}</span></p>
                            {roughGp !== 0 && <p>~ Profit (rough costs): <span className="font-bold text-amber-600">Rs.{roughGp.toLocaleString()}</span></p>}
                            {noCostRev > 0 && <p>Sales without cost (excluded): <span className="font-bold text-red-500">Rs.{noCostRev.toLocaleString()}</span></p>}
                          </div>
                        </div>
                        {noCostList.length > 0 && (
                          <div className="mt-3 pt-3 border-t border-purple-100">
                            <p className="text-[11px] font-black text-slate-500 mb-2">🏷️ {noCostList.length} item{noCostList.length !== 1 ? 's' : ''} sold without cost — enter a rough cost to include in profit, or leave blank:</p>
                            <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto">
                              {noCostList.map(e => (
                                <div key={e.sku} className="flex items-center gap-2 text-xs">
                                  <span className="flex-1 font-semibold text-slate-700 truncate">{e.name} <span className="text-slate-400 font-mono">{e.sku}</span></span>
                                  <span className="text-slate-400 shrink-0">{e.qty} sold · Rs.{e.rev.toLocaleString()}</span>
                                  {e.productId ? (
                                    <>
                                      <input type="number" inputMode="numeric" min="0" placeholder="rough cost"
                                        value={roughCostInputs[e.sku] || ''}
                                        onChange={ev => setRoughCostInputs(p => ({ ...p, [e.sku]: ev.target.value }))}
                                        className="w-24 px-2 py-1 rounded border-2 border-amber-200 text-xs font-mono outline-none focus:border-amber-400" />
                                      <button
                                        disabled={!(parseInt(roughCostInputs[e.sku]) > 0) || roughCostSaving === e.sku}
                                        onClick={async () => {
                                          setRoughCostSaving(e.sku)
                                          try {
                                            const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update', productId: e.productId, data: { cost: parseInt(roughCostInputs[e.sku]), cost_is_estimate: true } }) })
                                            const j = await r.json()
                                            if (j.success) { showToast(`~ Rough cost saved for ${e.sku}`); fetchData(false, true); fetchSales() }
                                            else showToast('Error: ' + j.error)
                                          } catch { showToast('Network error') }
                                          setRoughCostSaving(null)
                                        }}
                                        className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold disabled:opacity-40 shrink-0">Save ~</button>
                                    </>
                                  ) : <span className="text-[10px] text-slate-300 shrink-0">product removed</span>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4 mb-5">
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-green-600">Rs.{(salesData.stats.totalRevenue - (salesData.stats.totalReturns || 0)).toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Net Revenue</p>
                      {salesData.stats.totalReturns > 0 && <p className="text-[10px] text-red-500 mt-0.5">Returns: -Rs.{salesData.stats.totalReturns.toLocaleString()}</p>}
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-emerald-600">Rs.{salesData.stats.totalPaid.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Collected</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-red-600">Rs.{salesData.stats.totalCredit.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Outstanding</p>
                    </div>
                    {salesData.stats.totalCollections > 0 && (
                    <div className="bg-white rounded-xl border border-emerald-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-teal-600">Rs.{salesData.stats.totalCollections.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Credit Collections</p>
                      {salesData.collectionsToday && (() => {
                        const methods: Record<string, number> = {}
                        salesData.collectionsToday.forEach((c: any) => {
                          const m = (c.payment_method || 'cash').toLowerCase()
                          if (m === 'advance') return // advance is internal offset, not real collection
                          methods[m] = (methods[m] || 0) + c.amount
                        })
                        return <p className="mt-1.5 text-[10px] text-teal-700 font-semibold leading-relaxed">{Object.entries(methods).map(([m, a]) => `${m.toUpperCase()}: Rs.${(a as number).toLocaleString()}`).join(' · ')}</p>
                      })()}
                    </div>
                    )}
                    {salesData.stats.totalReturns > 0 && (
                    <button type="button" onClick={() => setReturnsOpen(o => !o)}
                      className={'text-left bg-white rounded-xl border p-3.5 sm:p-4 transition-colors hover:bg-red-50/60 ' + (returnsOpen ? 'border-red-400 ring-1 ring-red-200' : 'border-red-200')}>
                      <p className="text-lg sm:text-xl font-black text-red-600">Rs.{salesData.stats.totalReturns.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Returns / Refunds</p>
                      <p className="text-[10px] text-red-500 mt-0.5 font-semibold">
                        {(salesData.returnsInPeriod || []).length} return(s) · {returnsOpen ? 'hide' : 'see which'} {returnsOpen ? '▴' : '▾'}
                      </p>
                    </button>
                    )}
                  </div>

                  {/* ─── Which returns, and when they were raised ───────────── */}
                  {returnsOpen && salesData.stats.totalReturns > 0 && (
                    <div className="bg-red-50/50 border border-red-200 rounded-xl p-3 sm:p-4 mb-5">
                      <p className="text-[11px] font-bold text-red-800 mb-2">
                        Returned in this period
                        {salesData.stats.totalPiecesReturned > 0 && <> · {salesData.stats.totalPiecesReturned} piece(s) back on the shelf</>}
                        <span className="font-normal text-red-600"> — listed by the day the return was raised, so a return against an older invoice still appears here</span>
                      </p>
                      <div className="space-y-1.5">
                        {[...(salesData.returnsInPeriod || [])]
                          .sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
                          .map((r: any) => {
                            // "RETURN (credit cancelled): Toyota FC ABS Actuator x1" —
                            // everything after the colon is what actually came back.
                            const item = String(r.notes || '').includes(':')
                              ? String(r.notes).slice(String(r.notes).indexOf(':') + 1).trim()
                              : ''
                            // Neither of these hands money back: a credit return
                            // reduces what the customer owes, an advance return
                            // parks the value on their advance balance. Only a
                            // cash/bank method is money actually leaving.
                            const m = String(r.payment_method || '').toLowerCase()
                            const nonCash = m.includes('credit') ? 'off their balance — no cash'
                              : m === 'advance' ? 'to their advance — no cash' : ''
                            return (
                              <div key={r.id} className="bg-white rounded-lg border border-red-100 px-3 py-2 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  {/* The stock record names the goods exactly; the
                                      note is only the fallback for a sale whose
                                      lines belong to a later return of the same
                                      invoice. */}
                                  {(r.returnedItems || []).length > 0
                                    ? (r.returnedItems || []).map((g: any, gi: number) => (
                                        <p key={gi} className="text-xs font-bold text-slate-800 truncate">
                                          {g.name} <span className="text-red-600">×{g.quantity}</span>
                                        </p>
                                      ))
                                    : <p className="text-xs font-bold text-slate-800 truncate">{item || 'Returned item'}</p>}
                                  <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                                    {r.invoice_no || '(no invoice)'} · {r.customer_name || 'Unknown'} · {fmtColomboDateTime(r.created_at)}
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <p className="text-xs font-black text-red-600">-Rs.{Number(r.amount || 0).toLocaleString()}</p>
                                  <p className="text-[9px] font-bold mt-0.5 text-slate-400">
                                    {nonCash || 'REFUNDED ' + String(r.payment_method || '').toUpperCase().replace(/_/g, ' ')}
                                  </p>
                                </div>
                              </div>
                            )
                          })}
                      </div>
                    </div>
                  )}

                  {/* ─── On Approval — always shows ALL drafts, oldest first ─── */}
                  {allDrafts.length > 0 && (
                    <div className="mb-5 bg-amber-50 border-2 border-amber-300 rounded-2xl overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 border-b border-amber-200">
                        <span className="text-lg">📦</span>
                        <span className="font-black text-amber-900">On Approval</span>
                        <span className="bg-amber-500 text-white text-xs font-black px-2 py-0.5 rounded-full">{allDrafts.length}</span>
                        <span className="text-xs text-amber-700 ml-1">Sent out — awaiting decision</span>
                      </div>
                      <div className="divide-y divide-amber-200">
                        {allDrafts.map((draft: any) => {
                          const isReturning = draftReturning === draft.id
                          const daysAgo = Math.floor((Date.now() - new Date(draft.created_at).getTime()) / 86400000)
                          const draftTotal = parseFloat(draft.total || 0)
                          return (
                            <div key={draft.id} className="p-4">
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-mono text-xs font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">{draft.invoice_no}</span>
                                    <span className="text-xs text-slate-500">{daysAgo === 0 ? 'Today' : daysAgo + 'd ago'}</span>
                                    {daysAgo >= 3 && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded-full">{daysAgo}d out</span>}
                                  </div>
                                  <p className="font-bold text-slate-800 mt-0.5">{draft.customer_name}</p>
                                  {draft.customer_phone && <p className="text-xs text-slate-500">📞 {draft.customer_phone}</p>}
                                </div>
                                <div className="text-right shrink-0">
                                  {draftTotal > 0 ? (
                                    <p className="font-black text-amber-800">Rs.{draftTotal.toLocaleString()}</p>
                                  ) : (
                                    <p className="text-xs text-slate-400 italic">Price TBD</p>
                                  )}
                                  <p className="text-xs text-slate-500">{(draft.items || []).length} item{(draft.items || []).length !== 1 ? 's' : ''}</p>
                                </div>
                              </div>
                              {/* Items list */}
                              <div className="bg-white rounded-lg border border-amber-100 mb-3 divide-y divide-amber-50 overflow-hidden">
                                {(draft.items || []).map((item: any) => (
                                  <div key={item.id} className="flex items-center gap-2 px-3 py-2">
                                    <span className="text-xs text-slate-700 flex-1 leading-snug">
                                      {item.product_sku && <span className="font-mono text-[10px] text-slate-400 mr-1">{item.product_sku}</span>}
                                      {item.product_name} <span className="font-bold text-slate-900">×{item.quantity}</span>
                                    </span>
                                    <button
                                      disabled={returningItem === item.id || isReturning}
                                      onClick={async () => {
                                        if (!confirm('Return ' + item.product_name + ' ×' + item.quantity + '?\nStock will be restored.')) return
                                        setReturningItem(item.id)
                                        const res = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'return_draft_item', saleId: draft.id, saleItemId: item.id }) })
                                        const j = await res.json()
                                        if (j.success) { showToast(j.message || '↩ Item returned'); fetchSales(); fetchData() }
                                        else showToast(j.error || 'Error')
                                        setReturningItem(null)
                                      }}
                                      className="text-[10px] font-black text-red-500 border border-red-200 rounded-md px-2 py-1 hover:bg-red-50 active:bg-red-100 disabled:opacity-40 shrink-0 whitespace-nowrap"
                                    >
                                      {returningItem === item.id ? '…' : '↩ Return'}
                                    </button>
                                  </div>
                                ))}
                              </div>
                              {/* Action buttons */}
                              <div className="flex flex-wrap gap-2">
                                {draft.customer_phone && (
                                  <a href={'tel:' + draft.customer_phone} className="flex items-center gap-1 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 active:bg-slate-100">
                                    📞 Call
                                  </a>
                                )}
                                <button
                                  onClick={() => printInvoice(draft, salesData.vendor, 'thermal', vendorSettings)}
                                  className="flex items-center gap-1 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 active:bg-slate-100"
                                >
                                  🖨️ Thermal
                                </button>
                                <button
                                  onClick={() => printInvoice(draft, salesData.vendor, 'a4', vendorSettings)}
                                  className="flex items-center gap-1 text-xs font-bold text-slate-600 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 active:bg-slate-100"
                                >
                                  📄 {isLkTax ? 'A5' : 'A4'}
                                </button>
                                <button
                                  disabled={isReturning}
                                  onClick={async () => {
                                    if (!confirm('Return ALL items from ' + draft.customer_name + '?\nStock will be restored.')) return
                                    setDraftReturning(draft.id)
                                    const res = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'return_draft', saleId: draft.id }) })
                                    const j = await res.json()
                                    if (j.success) { showToast('↩ All items returned'); fetchSales(); fetchData() }
                                    else showToast(j.error || 'Error')
                                    setDraftReturning(null)
                                  }}
                                  className="flex-1 text-xs font-bold text-red-600 border border-red-200 rounded-lg px-3 py-2 hover:bg-red-50 active:bg-red-100 disabled:opacity-40"
                                >
                                  {isReturning ? '…' : '↩ Return All'}
                                </button>
                                <button
                                  onClick={() => {
                                    // Build draft payload and hand off to TabPOS via pendingPosDraft
                                    setPendingPosDraft({
                                      cart: (draft.items || []).map((i: any) => ({
                                        productId: i.product_id, productName: i.product_name,
                                        productSku: i.product_sku || '', quantity: i.quantity,
                                        unitPrice: i.unit_price || 0, unitCost: i.unit_cost || 0,
                                        maxStock: 9999, saleItemId: i.id,
                                      })),
                                      customer: { id: draft.customer_id || null, name: draft.customer_name, phone: draft.customer_phone || '', advance: 0, outstanding: 0, require_vehicle_no: false },
                                      vehicleNo: draft.vehicle_no || '',
                                      draftId: draft.id,
                                      draftInvoiceNo: draft.invoice_no || '',
                                    })
                                    setTab('pos')
                                  }}
                                  className="flex-1 text-xs font-black text-green-700 border border-green-300 rounded-lg px-3 py-2 bg-green-50 hover:bg-green-100 active:bg-green-200"
                                >
                                  ✅ Finalise →
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Revenue chart — simple bar chart with CSS */}
                  {salesData.dailyRevenue && salesData.dailyRevenue.length > 1 && (
                    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
                      <h3 className="font-bold text-sm mb-3">Daily Revenue</h3>
                      {/* Bar chart: flex-1 spacer pushes each bar to the bottom; pixel heights avoid % issues in nested flex */}
                      <div className="flex gap-0.5 overflow-x-auto" style={{ scrollbarWidth: 'none', height: '150px' }}>
                        {(() => {
                          const maxRev = Math.max(...salesData.dailyRevenue.map((d: any) => d.revenue))
                          const MAX_BAR_PX = 110
                          return salesData.dailyRevenue.map((day: any) => {
                            const barPx = maxRev > 0 ? Math.max((day.revenue / maxRev) * MAX_BAR_PX, 2) : 2
                            const dateStr = new Date(day.date + 'T00:00:00').toLocaleDateString('en-LK', { day: 'numeric', month: 'short' })
                            return (
                              <div key={day.date} className="flex flex-col items-center flex-1 min-w-[26px] h-full group relative">
                                {/* tooltip */}
                                <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10 mt-1">
                                  Rs.{day.revenue.toLocaleString()}<br/>{day.count} sale{day.count !== 1 ? 's' : ''}
                                </div>
                                {/* spacer pushes bar down */}
                                <div className="flex-1" />
                                {/* bar */}
                                <div className="w-full bg-gradient-to-t from-orange-500 to-orange-400 rounded-t-sm" style={{ height: `${barPx}px` }} />
                                {/* date label */}
                                <span className="text-[7px] text-slate-400 whitespace-nowrap mt-0.5" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{dateStr}</span>
                              </div>
                            )
                          })
                        })()}
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                    {/* Top Products */}
                    {salesData.topProducts && salesData.topProducts.length > 0 && (
                      <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <h3 className="font-bold text-sm mb-3">Top Products</h3>
                        <div className="space-y-2">
                          {salesData.topProducts.slice(0, 7).map((p: any, i: number) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-[10px] font-black text-slate-300 w-4">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold text-slate-800 truncate">{p.name}</p>
                                <p className="text-[10px] text-slate-400">{p.qty} sold</p>
                              </div>
                              <span className="text-xs font-bold text-green-600">Rs.{p.revenue.toLocaleString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Payment Method Breakdown */}
                    {salesData.paymentBreakdown && salesData.paymentBreakdown.length > 0 && (
                      <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <h3 className="font-bold text-sm mb-3">Payment Methods</h3>
                        <div className="space-y-2.5">
                          {salesData.paymentBreakdown.map((p: any) => {
                            const pct = salesData.stats.totalRevenue > 0 ? (p.amount / salesData.stats.totalRevenue) * 100 : 0
                            return (
                              <div key={p.method}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className="text-xs font-semibold text-slate-700">{PAY_LABELS[p.method] || p.method}</span>
                                  <span className="text-xs font-bold text-slate-900">Rs.{p.amount.toLocaleString()} <span className="text-slate-400 font-normal">({Math.round(pct)}%)</span></span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-orange-400 rounded-full" style={{ width: `${Math.min(pct, 100)}%` }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Top Customers */}
                  {salesData.topCustomers && salesData.topCustomers.length > 0 && (
                    <div className="bg-white rounded-xl border border-slate-200 p-4">
                      <h3 className="font-bold text-sm mb-3">Top Customers</h3>
                      <div className="space-y-2">
                        {salesData.topCustomers.slice(0, 7).map((c: any, i: number) => (
                          <div key={i} className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-slate-300 w-4">{i + 1}</span>
                            <div className="flex-1 min-w-0">
                              <button onClick={() => { if (c.id !== 'walkin') { setCustomerHistoryId(c.id); setCustomerHistoryName(c.name) } }} className={'text-xs font-semibold truncate block text-left ' + (c.id !== 'walkin' ? 'text-orange-600 active:text-orange-800' : 'text-slate-800')}>
                                {c.name}
                              </button>
                              <p className="text-[10px] text-slate-400">{c.count} invoices</p>
                            </div>
                            <span className="text-xs font-bold text-green-600">Rs.{c.spent.toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>)}

                {/* ─── TRANSACTIONS ─── */}
                {salesSubTab === 'transactions' && (() => {
                  const hasFilters = salesFilterFrom || salesFilterTo || salesFilterCustomer || salesFilterVehicle || salesSearch
                  const filteredSales = salesData.sales.filter((sale: any) => {
                    // Date range filter
                    if (salesFilterFrom) {
                      const saleDate = sale.created_at?.slice(0, 10) || ''
                      if (saleDate < salesFilterFrom) return false
                    }
                    if (salesFilterTo) {
                      const saleDate = sale.created_at?.slice(0, 10) || ''
                      if (saleDate > salesFilterTo) return false
                    }
                    // Customer name filter
                    if (salesFilterCustomer) {
                      const name = (sale.customer?.name || sale.customer_name || '').toLowerCase()
                      const phone = (sale.customer_phone || sale.customer?.phone || '').toLowerCase()
                      if (!name.includes(salesFilterCustomer.toLowerCase()) && !phone.includes(salesFilterCustomer.toLowerCase())) return false
                    }
                    // Vehicle number filter
                    if (salesFilterVehicle) {
                      const vehicle = (sale.vehicle_no || '').toLowerCase()
                      if (!vehicle.includes(salesFilterVehicle.toLowerCase().replace(/[-\s]/g, ''))) return false
                    }
    // Unified search: invoice, product name/sku, customer name, phone, vehicle
                    if (salesSearch) {
                      const sq = salesSearch.toLowerCase()
                      // A promoted sale answers to BOTH numbers: the gazette
                      // serial we now file under, and the receipt the customer
                      // walked out with and will quote on the phone.
                      const invoice = `${sale.invoice_no || ''} ${sale.receipt_no || ''} ${sale.promoted_from_receipt_no || ''}`.toLowerCase()
                      const items = (sale.items || []).map((i: any) => `${i.product_sku || ''} ${i.product_name || ''}`).join(' ').toLowerCase()
                      const name = (sale.customer?.name || sale.customer_name || '').toLowerCase()
                      const phone = (sale.customer_phone || sale.customer?.phone || '').toLowerCase()
                      const vehicle = (sale.vehicle_no || '').toLowerCase().replace(/[-\s]/g, '')
                      const sqVehicle = sq.replace(/[-\s]/g, '')
                      if (!invoice.includes(sq) && !items.includes(sq) && !name.includes(sq) && !phone.includes(sq) && !(sqVehicle && vehicle.includes(sqVehicle))) return false
                    }
                    return true
                  }).sort((a: any, b: any) => {
                    const numA = parseInt((a.invoice_no || '').replace(/\D/g, '') || '0')
                    const numB = parseInt((b.invoice_no || '').replace(/\D/g, '') || '0')
                    return numB - numA
                  })
                  const activeFilterCount = [salesFilterFrom, salesFilterTo, salesFilterCustomer, salesFilterVehicle].filter(Boolean).length
                  return (
                  <div>
                    {/* Search + Filter toggle */}
                    <div className="flex gap-2 mb-2">
                      <input type="text" value={salesSearch} onChange={e => setSalesSearch(e.target.value)} placeholder="Search invoice, customer, phone, vehicle, product..." className="flex-1 px-4 py-2 rounded-xl border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                      <button onClick={() => setShowSalesFilter(!showSalesFilter)} className={'px-3 py-2 rounded-xl border-2 text-sm font-bold transition ' + (showSalesFilter || activeFilterCount > 0 ? 'border-orange-400 bg-orange-50 text-orange-600' : 'border-slate-200 text-slate-500')}>
                        ☰ Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                      </button>
                    </div>
                    {/* Filter panel */}
                    {showSalesFilter && (
                      <div className="bg-white rounded-xl border border-slate-200 p-3 mb-3 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="block text-[10px] font-bold text-slate-400 mb-0.5">FROM</label><input type="date" value={salesFilterFrom} onChange={e => setSalesFilterFrom(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-orange-400" /></div>
                          <div><label className="block text-[10px] font-bold text-slate-400 mb-0.5">TO</label><input type="date" value={salesFilterTo} onChange={e => setSalesFilterTo(e.target.value)} className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-orange-400" /></div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div><label className="block text-[10px] font-bold text-slate-400 mb-0.5">CUSTOMER</label><input type="text" value={salesFilterCustomer} onChange={e => setSalesFilterCustomer(e.target.value)} placeholder="Name or phone" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-orange-400" /></div>
                          <div><label className="block text-[10px] font-bold text-slate-400 mb-0.5">VEHICLE NO</label><input type="text" value={salesFilterVehicle} onChange={e => setSalesFilterVehicle(e.target.value.toUpperCase())} placeholder="ABC-1234" className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:border-orange-400 uppercase font-mono" /></div>
                        </div>
                        {hasFilters && <button onClick={() => { setSalesFilterFrom(''); setSalesFilterTo(''); setSalesFilterCustomer(''); setSalesFilterVehicle(''); setSalesSearch('') }} className="text-[11px] font-bold text-red-500 px-2 py-1">✕ Clear all filters</button>}
                        <p className="text-[10px] text-slate-400">{filteredSales.length} of {salesData.sales.length} sales</p>
                      </div>
                    )}
                    {filteredSales.length === 0 ? (
                    <div className="text-center py-12"><p className="text-4xl opacity-30">📋</p><p className="text-sm text-slate-400 mt-2 font-semibold">{hasFilters ? 'No matching sales' : 'No sales in this period'}</p></div>
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead><tr className="bg-slate-50 text-left">
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400">DATE</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400">INVOICE</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400 hidden md:table-cell">ITEMS</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400 hidden sm:table-cell">VEHICLE</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400">CUSTOMER</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400 text-right">TOTAL</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400">STATUS</th>
                            <th className="px-2 sm:px-3 py-2.5 text-[10px] font-bold text-slate-400"></th>
                          </tr></thead>
                          <tbody>
                            {filteredSales.map((sale: any) => {
                              const isExpanded = expandedSale === sale.id
                              const hasReturns = (sale.items || []).some((i: any) => (i.returned_quantity || 0) > 0)
                              const totalReturned = (sale.items || []).reduce((s: number, i: any) => s + ((i.returned_quantity || 0) * parseFloat(i.unit_price || 0)), 0)
                              const saleCogs = (sale.items || []).reduce((s: number, i: any) => s + (parseInt(i.unit_cost || 0) * i.quantity), 0)
                              const saleGp = parseFloat(sale.total) - saleCogs
                              const saleGpPct = saleCogs > 0 && parseFloat(sale.total) > 0 ? Math.round(saleGp / parseFloat(sale.total) * 100) : null
                              return (<Fragment key={sale.id}>
                                <tr key={sale.id} onClick={() => setExpandedSale(isExpanded ? null : sale.id)} className={'border-t border-slate-100 cursor-pointer hover:bg-slate-50 transition ' + (sale.payment_status === 'voided' ? 'opacity-50' : '') + (hasReturns && sale.payment_status !== 'voided' ? ' bg-red-50/30' : '') + (isExpanded ? ' bg-orange-50/50' : '')}>
                                  <td className="px-2 sm:px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatDateShort(sale.created_at)}</td>
                                  <td className="px-2 sm:px-3 py-2.5"><span className="font-mono text-[10px] font-bold bg-slate-100 px-1.5 py-0.5 rounded">{sale.invoice_no}</span>{sale.promoted_from_receipt_no && <span className="block text-[8px] font-bold text-indigo-500 mt-0.5" title={`Re-issued from receipt ${sale.promoted_from_receipt_no}`}>⬆ was {sale.promoted_from_receipt_no}</span>}{hasReturns && <span className="block text-[8px] font-bold text-red-500 mt-0.5">↩ RETURN</span>}</td>
                                  <td className="px-2 sm:px-3 py-2.5 text-xs max-w-[300px] hidden md:table-cell">
                                    {(sale.items || []).map((i: any) => (
                                      <div key={i.id} className="truncate"><span className="font-mono text-slate-400 mr-1">{i.product_sku}</span>{i.product_name} <span className="text-slate-400">x{i.quantity}</span></div>
                                    )).slice(0, 2)}
                                    {(sale.items || []).length > 2 && <span className="text-[10px] text-slate-400">+{(sale.items || []).length - 2} more</span>}
                                  </td>
                                  <td className="px-2 sm:px-3 py-2.5 text-xs font-mono font-semibold text-slate-600 hidden sm:table-cell">
                                    {sale.vehicle_no || '—'}
                                    {sale.mileage_km != null && <span className="block text-[10px] font-normal text-slate-400">{Number(sale.mileage_km).toLocaleString()} km</span>}
                                  </td>
                                  <td className="px-2 sm:px-3 py-2.5 text-xs font-semibold whitespace-nowrap">{sale.customer?.name || sale.customer_name}</td>
                                  <td className="px-2 sm:px-3 py-2.5 text-right font-bold text-orange-600 whitespace-nowrap">Rs.{parseFloat(sale.total).toLocaleString()}</td>
                                  <td className="px-2 sm:px-3 py-2.5"><span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' + saleStatusChip(sale.payment_status, sale).cls}>{saleStatusChip(sale.payment_status, sale).label}</span>{hasReturns && <span className="block text-[9px] font-bold text-red-500 mt-0.5">-Rs.{totalReturned.toLocaleString()}</span>}</td>
                                  <td className="px-2 sm:px-3 py-2.5 text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</td>
                                </tr>
                                {isExpanded && (
                                  <tr key={sale.id + '-detail'}><td colSpan={8} className="px-3 pb-3 bg-slate-50/50 border-t border-slate-100">
                                    <table className="w-full text-xs mt-2"><tbody>{(sale.items || []).map((i: any) => { const returned = (i.returned_quantity || 0) >= i.quantity; const partialReturn = i.returned_quantity > 0 && i.returned_quantity < i.quantity; return (<tr key={i.id} className={'border-b border-slate-100 ' + (returned ? 'opacity-40' : '')}><td className="py-1.5"><span className="font-mono text-slate-400 mr-1">{i.product_sku}</span><span className={returned ? 'line-through' : ''}>{i.product_name}</span>{returned && <span className="ml-1.5 text-[9px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded">RETURNED</span>}{partialReturn && <span className="ml-1.5 text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">{i.returned_quantity} returned</span>}{!returned && !partialReturn && !sale.tax_serial && sale.payment_status !== 'voided' && i.product_id && <button onClick={e => { e.stopPropagation(); setFixItem({ sale, item: i }); setFixSearch(''); setFixPick(null); setFixReason('') }} title="Wrong item picked? Swap it without changing the date or the amount" className="ml-2 text-[9px] font-bold text-blue-600 border border-blue-200 rounded px-1.5 py-0.5 hover:bg-blue-50">fix SKU</button>}</td><td className="py-1.5 text-right text-slate-500">x{i.quantity}</td><td className="py-1.5 text-right font-semibold">Rs.{parseFloat(i.unit_price).toLocaleString()}</td><td className={'py-1.5 text-right font-semibold ' + (returned ? 'line-through text-slate-300' : '')}>Rs.{parseFloat(i.total).toLocaleString()}</td>
<td className="py-1.5 text-right">{parseFloat(i.unit_price || 0) === 0 && !returned && sale.payment_status !== 'voided' && (<button onClick={async e => { e.stopPropagation(); const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'move_to_approval', saleId: sale.id, saleItemId: i.id }) }); const j = await r.json(); if (j.success) { showToast(j.message); fetchSales() } else showToast(j.error || 'Error') }} className="text-[9px] font-bold text-amber-600 border border-amber-300 rounded px-1.5 py-0.5 bg-amber-50 hover:bg-amber-100 whitespace-nowrap">↩ On Approval</button>)}</td></tr>)})}</tbody></table>
                                    {parseFloat(sale.balance_due) > 0 && <p className="text-xs font-bold text-red-600 mt-2">Balance Due: Rs.{parseFloat(sale.balance_due).toLocaleString()}</p>}
                                    {saleCogs > 0 && sale.payment_status !== 'voided' && (
                                      <div className="flex gap-4 mt-2 text-xs">
                                        <span className="text-slate-400">COGS: Rs.{saleCogs.toLocaleString()}</span>
                                        <span className={`font-bold ${saleGp >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                                          GP: Rs.{saleGp.toLocaleString()} {saleGpPct !== null ? `(${saleGpPct}%)` : ''}
                                        </span>
                                      </div>
                                    )}
                                    <div className="flex gap-2 mt-3 flex-wrap">
                                      <div className="relative">
                                        <button onClick={e => { e.stopPropagation(); const el = document.getElementById('print-menu-' + sale.id); if (el) el.classList.toggle('hidden') }} className="text-[11px] font-semibold text-slate-600 px-3 py-1.5 rounded border border-slate-200 active:bg-slate-50">🖨️ Print ▾</button>
                                        <div id={'print-menu-' + sale.id} className="hidden absolute left-0 bottom-full mb-1 bg-white rounded-lg border border-slate-200 shadow-lg z-20 overflow-hidden min-w-[140px]">
                                          <button onClick={() => { printWithTotal(sale, salesData.vendor, 'thermal', vendorSettings); document.getElementById('print-menu-' + sale.id)?.classList.add('hidden') }} className="w-full text-left px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 border-b border-slate-100">🖨️ Thermal</button>
                                          <button onClick={() => { printWithTotal(sale, salesData.vendor, 'a4', vendorSettings); document.getElementById('print-menu-' + sale.id)?.classList.add('hidden') }} className="w-full text-left px-3 py-2.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 border-b border-slate-100">📄 {isLkTax ? 'A5' : 'A4'} Print</button>
                                          {(sale.customer_phone || sale.customer?.phone) && <button onClick={() => { sendWhatsAppBill(sale, salesData.vendor, sale.customer_phone || sale.customer?.phone); document.getElementById('print-menu-' + sale.id)?.classList.add('hidden') }} className="w-full text-left px-3 py-2.5 text-xs font-semibold text-green-600 hover:bg-green-50">💬 WhatsApp</button>}
                                        </div>
                                      </div>
                                      {!isNarrow && sale.payment_status !== 'voided' && <button onClick={e => { e.stopPropagation(); setReturnModal(sale); setReturnItems({}) }} className="text-[11px] font-semibold text-amber-600 px-3 py-1.5 rounded border border-amber-200 active:bg-amber-50">↩ Return</button>}
                                      {!isNarrow && sale.payment_status !== 'voided' && sale.payment_status !== 'draft' && !isLkTax && (
                                        <button onClick={e => { e.stopPropagation(); setVoidModal({ saleId: sale.id, total: parseFloat(sale.total || 0), paid: parseFloat(sale.paid_amount || 0), customerName: sale.customer?.name || sale.customer_name || 'Walk-in' }) }} className="text-[11px] font-semibold text-red-600 px-3 py-1.5 rounded border border-red-200 active:bg-red-50">🚫 Void</button>
                                      )}
                                      {!isNarrow && isLkTax && mayReverse && sale.promoted_at && sale.tax_serial && sale.payment_status !== 'voided' && (
                                        <button onClick={e => { e.stopPropagation(); openReverse(sale) }}
                                          className="text-[11px] font-semibold text-amber-700 px-3 py-1.5 rounded border border-amber-300 active:bg-amber-50">
                                          ↩ Withdraw Tax Invoice
                                        </button>
                                      )}
                                      {!isNarrow && isLkTax && !sale.tax_serial && sale.receipt_no && sale.payment_status !== 'voided' && sale.payment_status !== 'draft' && (
                                        <button onClick={e => { e.stopPropagation(); openPromote(sale) }}
                                          className="text-[11px] font-semibold text-indigo-600 px-3 py-1.5 rounded border border-indigo-200 active:bg-indigo-50">
                                          ⬆ Make Tax Invoice
                                        </button>
                                      )}
                                      {sale.customer_id && <button onClick={e => { e.stopPropagation(); setCustomerHistoryId(sale.customer_id); setCustomerHistoryName(sale.customer?.name || sale.customer_name) }} className="text-[11px] font-semibold text-purple-600 px-3 py-1.5 rounded border border-purple-200 active:bg-purple-50">👤 History</button>}
                                    </div>
                                  </td></tr>
                                )}
                              </Fragment>)
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}</div>)
                })()}

                {/* ─── CUSTOMERS ─── */}
                {salesSubTab === 'customers' && (
                  <div>
                    {salesData.topCustomers && salesData.topCustomers.length > 0 ? (
                      <div className="space-y-2">
                        {salesData.topCustomers.map((c: any, i: number) => (
                          <button key={i} onClick={() => { if (c.id !== 'walkin') { setCustomerHistoryId(c.id); setCustomerHistoryName(c.name) } }}
                            className={'w-full bg-white rounded-xl border border-slate-200 p-4 text-left transition ' + (c.id !== 'walkin' ? 'active:bg-orange-50 active:border-orange-300' : 'opacity-70')}>
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-bold text-sm text-slate-900">{c.name}</p>
                                {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                              </div>
                              <div className="text-right">
                                <p className="font-black text-green-600">Rs.{c.spent.toLocaleString()}</p>
                                <p className="text-[10px] text-slate-400">{c.count} invoices</p>
                              </div>
                            </div>
                            {c.id !== 'walkin' && <p className="text-[10px] text-orange-500 font-semibold mt-1">Tap to view purchase history →</p>}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12"><p className="text-4xl opacity-30">👥</p><p className="text-sm text-slate-400 mt-2 font-semibold">No customer data yet</p></div>
                    )}
                  </div>
                )}

                {/* ─── REPORTS ─── */}
                {salesSubTab === "reports" && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                      <h3 className="font-bold text-sm text-slate-800 mb-3">📅 Daily Report</h3>
                      <p className="text-xs text-slate-400 mb-3">Covers the full selected day (Asia/Colombo)</p>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <button disabled={dailyReportLoading} onClick={async () => {
                          setDailyReportLoading(true)
                          showToast('Fetching sales...')
                          // Fetch the previous UTC day too — early-morning Colombo sales
                          // (+5:30) are stored under yesterday's UTC date; the report then
                          // pins each row to its Colombo calendar day.
                          try {
                            const prev = new Date(reportDate + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1)
                            const r = await fetch(`/api/vendor/sales?from=${prev.toISOString().slice(0, 10)}&to=${reportDate}`)
                            if (!r.ok) { showToast(`Failed (${r.status})`) } else {
                              const j = await r.json()
                              generateDailyReport(j.sales || [], data?.vendor, reportDate, vendorSettings, j.collectionsToday || [], j.returnsInPeriod || [], undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, j.retroactive || [])
                            }
                          } catch { showToast('Failed') }
                          setDailyReportLoading(false)
                        }} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Generate PDF</button>
                        <button disabled={dailyReportLoading} onClick={async () => {
                          setDailyReportLoading(true)
                          showToast('Fetching sales...')
                          try {
                            const prev = new Date(reportDate + 'T00:00:00Z'); prev.setUTCDate(prev.getUTCDate() - 1)
                            const r = await fetch(`/api/vendor/sales?from=${prev.toISOString().slice(0, 10)}&to=${reportDate}`)
                            if (!r.ok) { showToast(`Failed (${r.status})`) } else {
                              const j = await r.json()
                              whatsAppDailyReport(j.sales || [], j.vendor || data?.vendor, reportDate, (j.vendor || data?.vendor)?.whatsapp || (j.vendor || data?.vendor)?.phone)
                            }
                          } catch { showToast('Failed') }
                          setDailyReportLoading(false)
                        }} className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">💬 WhatsApp Summary</button>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                      <h3 className="font-bold text-sm text-slate-800 mb-1">📆 Period Report</h3>
                      <p className="text-xs text-slate-400 mb-3">Customer-wise sales breakdown with selectable PDF</p>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label><input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label><input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <button onClick={() => openPeriodReport()} disabled={periodReportLoading} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-lg">{periodReportLoading ? '⏳ Loading…' : '📊 View Report'}</button>
                      </div>
                      <div className="flex gap-2 mt-3">
                        {[{l:"Last 7 Days",f:7},{l:"Last 30 Days",f:30},{l:"Last 3 Months",f:90}].map(p => (<button key={p.l} onClick={() => { setReportFrom(new Date(Date.now() - p.f * 86400000).toISOString().slice(0, 10)); setReportTo(colomboToday()) }} className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-100">{p.l}</button>))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ══ WHEEL MART ONLY ═══════════════════════════════════════════════════════
                    Tax Reports sub-tab (VAT register, SSCL report, input VAT, VAT summary).
                    Standard vendors (Sakura) never see this — gated by isLkTax.
                    To edit: changes here affect ONLY WHEEL MART. Safe to touch.
                    ════════════════════════════════════════════════════════════════════════ */}
                {/* WHEEL MART tax registers moved to their own Tax tab —
                    see _lk_tax/TaxRegisters.tsx, rendered by TabTax. */}

              </>)


            })()}

          </div>) : null}

          {/* Customer Purchase History Modal */}
          {customerHistoryId && (
            <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center" onClick={() => { setCustomerHistoryId(null); setCustomerHistory(null) }}>
              <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-10 rounded-t-2xl">
                  <div>
                    <h3 className="font-bold text-base">{customerHistoryName}</h3>
                    <p className="text-xs text-slate-400">Purchase History</p>
                  </div>
                  <button onClick={() => { setCustomerHistoryId(null); setCustomerHistory(null) }} className="w-8 h-8 flex items-center justify-center text-slate-400 active:text-slate-600 text-lg">✕</button>
                </div>
                <div className="p-4">
                  {!customerHistory ? (
                    <div className="text-center py-8"><div className="w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
                  ) : customerHistory.length === 0 ? (
                    <div className="text-center py-8"><p className="text-slate-400 text-sm">No purchases found</p></div>
                  ) : (
                    <div>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                          <p className="font-black text-green-600 text-sm">Rs.{customerHistory.reduce((s: number, sale: any) => s + parseFloat(sale.total || 0), 0).toLocaleString()}</p>
                          <p className="text-[10px] text-green-500">Total Spent</p>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3 text-center">
                          <p className="font-black text-blue-600 text-sm">{customerHistory.length}</p>
                          <p className="text-[10px] text-blue-500">Invoices</p>
                        </div>
                        <div className="bg-red-50 rounded-lg p-3 text-center">
                          <p className="font-black text-red-600 text-sm">Rs.{customerHistory.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0).toLocaleString()}</p>
                          <p className="text-[10px] text-red-500">Outstanding</p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {customerHistory.map((sale: any) => (
                          <div key={sale.id} className={'bg-slate-50 rounded-xl p-3 ' + (sale.payment_status === 'voided' ? 'opacity-50' : '')}>
                            <div className="flex items-center justify-between mb-2">
                              <div>
                                <span className="font-mono text-[10px] font-bold bg-white px-1.5 py-0.5 rounded">{sale.invoice_no}</span>
                                <span className="text-[10px] text-slate-400 ml-1.5">{formatDateShort(sale.created_at)}</span>
                                {sale.promoted_from_receipt_no && (
                                  <span className="block text-[10px] text-indigo-500 font-semibold mt-0.5">
                                    ⬆ re-issued from receipt {sale.promoted_from_receipt_no}
                                    {sale.promoted_at ? ` on ${formatDateShort(sale.promoted_at)}` : ''}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' + saleStatusChip(sale.payment_status, sale).cls}>{saleStatusChip(sale.payment_status, sale).label}</span>
                                <span className="font-black text-sm text-orange-600">Rs.{parseFloat(sale.total).toLocaleString()}</span>
                              </div>
                            </div>
                            <div className="text-xs text-slate-600">{(sale.items || []).map((i: any) => `${i.product_name} x${i.quantity}`).join(', ')}</div>
                            {parseFloat(sale.balance_due) > 0 && <p className="text-[10px] font-bold text-red-600 mt-1">Due: Rs.{parseFloat(sale.balance_due).toLocaleString()}</p>}
                            {sale.payments && sale.payments.length > 0 && (
                              <p className="text-[10px] text-slate-400 mt-1">Payments: {sale.payments.map((p: any) => `${PAY_LABELS[p.payment_method] || p.payment_method} Rs.${parseFloat(p.amount).toLocaleString()}`).join(', ')}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>)}

        {/* INSURANCE CLAIMS — WHEEL MART only */}
        {tab === 'claims' && isLkTax && (
          <TabClaims showToast={showToast} staffRole={staffRole} />
        )}

        {/* CREDIT */}
        {tab === 'credit' && (
          isLkTax ? (
            // WHEEL MART: CRN register only (tax credit notes for returns).
            // Customer receivables live in their own 'receivables' tab below.
            <TabCreditNotes
              vendor={vendor}
              products={data?.products || []}
              vendorSettings={vendorSettings}
              showToast={showToast}
              onDataChanged={fetchData}
            />
          ) : (
            // Sakura / other vendors: customer credit & advances only
            <TabCredit
              vendor={vendor}
              products={data?.products || []}
              vendorSettings={vendorSettings}
              showToast={showToast}
              onDataChanged={fetchData}
            />
          )
        )}

        {/* RECEIVABLES — WHEEL MART only: collect customer credit & advances */}
        {tab === 'receivables' && isLkTax && (
          <TabCredit
            key={receivablesShowAll ? 'registry' : 'credit'}
            vendor={vendor}
            products={data?.products || []}
            vendorSettings={vendorSettings}
            showToast={showToast}
            onDataChanged={fetchData}
            mode={receivablesShowAll ? 'registry' : 'credit'}
          />
        )}

        {/* PERIOD REPORT MODAL */}
        {periodReportModal && (() => {
          // Group sales by customer
          const byCustomer: Record<string, { key: string; name: string; phone: string; invoices: number; total: number; paid: number; balance: number; sales: any[] }> = {}
          periodReportSales.forEach((s: any) => {
            const key = s.customer_id || 'walkin-' + (s.customer_name || 'Unknown')
            if (!byCustomer[key]) byCustomer[key] = { key, name: s.customer_name || 'Walk-in', phone: s.customer_phone || '', invoices: 0, total: 0, paid: 0, balance: 0, sales: [] }
            byCustomer[key].invoices++
            byCustomer[key].total += parseFloat(s.total || 0)
            byCustomer[key].paid += parseFloat(s.paid_amount || 0)
            byCustomer[key].balance += parseFloat(s.balance_due || 0)
            byCustomer[key].sales.push(s)
          })
          const customers = Object.values(byCustomer).sort((a, b) => b.total - a.total)
          const allKeys = customers.map(c => c.key)
          const allSelected = allKeys.every(k => periodReportSelected.has(k))
          const selectedCustomers = customers.filter(c => periodReportSelected.has(c.key))
          const selTotal = selectedCustomers.reduce((s, c) => s + c.total, 0)
          const selPaid = selectedCustomers.reduce((s, c) => s + c.paid, 0)
          const selBalance = selectedCustomers.reduce((s, c) => s + c.balance, 0)
          const fromStr = new Date(reportFrom).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })
          const toStr = new Date(reportTo).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })

          return (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
              <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl flex flex-col max-h-[92vh]">

                {/* Header */}
                <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 shrink-0">
                  <div>
                    <h2 className="font-black text-slate-800 text-base">📊 Sales Report</h2>
                    <p className="text-xs text-slate-400 mt-0.5">{fromStr} — {toStr} · {customers.length} customers · {periodReportSales.length} invoices</p>
                  </div>
                  <button onClick={() => setPeriodReportModal(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold px-2">✕</button>
                </div>

                {/* Summary bar */}
                <div className="grid grid-cols-3 divide-x divide-slate-100 shrink-0 bg-slate-50 border-b border-slate-100">
                  {[['Total Sales', selTotal], ['Total Paid', selPaid], ['Balance Due', selBalance]].map(([lbl, val]) => (
                    <div key={lbl as string} className="px-4 py-3 text-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{lbl}</p>
                      <p className={'font-black text-sm mt-0.5 ' + (lbl === 'Balance Due' && (val as number) > 0 ? 'text-red-600' : 'text-slate-800')}>Rs.{(val as number).toLocaleString()}</p>
                    </div>
                  ))}
                </div>

                {/* Select all row */}
                <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 shrink-0">
                  <button onClick={() => setPeriodReportSelected(allSelected ? new Set() : new Set(allKeys))} className="text-xs font-bold text-orange-600 hover:text-orange-700">
                    {allSelected ? 'Deselect All' : 'Select All'}
                  </button>
                  <p className="text-xs text-slate-400">{periodReportSelected.size} of {customers.length} selected</p>
                </div>

                {/* Customer rows */}
                <div className="overflow-y-auto flex-1">
                  {customers.map(c => {
                    const checked = periodReportSelected.has(c.key)
                    return (
                      <label key={c.key} className={'flex items-center gap-3 px-5 py-3 border-b border-slate-50 cursor-pointer transition ' + (checked ? 'bg-orange-50/60' : 'hover:bg-slate-50')}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          const next = new Set(periodReportSelected)
                          checked ? next.delete(c.key) : next.add(c.key)
                          setPeriodReportSelected(next)
                        }} className="w-4 h-4 accent-orange-500 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm text-slate-800 truncate">{c.name}</p>
                          {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                        </div>
                        <div className="text-right shrink-0 space-y-0.5">
                          <p className="text-xs text-slate-400">{c.invoices} invoice{c.invoices !== 1 ? 's' : ''}</p>
                          <p className="font-bold text-sm text-slate-800">Rs.{c.total.toLocaleString()}</p>
                          {c.balance > 0 && <p className="text-xs font-bold text-red-500">Due Rs.{c.balance.toLocaleString()}</p>}
                        </div>
                      </label>
                    )
                  })}
                </div>

                {/* Footer */}
                <div className="px-5 py-4 border-t border-slate-100 shrink-0 flex gap-3 items-center">
                  <button
                    disabled={periodReportSelected.size === 0}
                    onClick={() => {
                      const selectedSales = periodReportSales.filter((s: any) => {
                        const key = s.customer_id || 'walkin-' + (s.customer_name || 'Unknown')
                        return periodReportSelected.has(key)
                      })
                      generatePeriodReport(selectedSales, data?.vendor, reportFrom, reportTo, vendorSettings)
                    }}
                    className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white font-black text-sm py-3 rounded-xl">
                    📄 Generate PDF ({periodReportSelected.size} customer{periodReportSelected.size !== 1 ? 's' : ''})
                  </button>
                  <button onClick={() => setPeriodReportModal(false)} className="px-4 py-3 rounded-xl border-2 border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50">Close</button>
                </div>
              </div>
            </div>
          )
        })()}

        {/* RETURN ITEMS MODAL */}
        {/* ─── Fix a mis-picked SKU ───────────────────────────────────────
            Swaps the product on the line. The date, quantity and price stay
            put, because nothing about the transaction changed — only which
            part left the shelf. Anything that also changes the price is a
            different sale and still needs a return. */}
        {fixItem && (
          <div className="fixed inset-0 bg-black/50 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setFixItem(null)}>
            <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="p-4 sm:p-5 border-b border-slate-100">
                <h3 className="text-lg font-bold text-slate-900">Fix the item on this line</h3>
                <p className="text-xs text-slate-500 mt-1">
                  {fixItem.sale.invoice_no} · {colomboBusinessDay(fixItem.sale.created_at)} — the date and the amount do not change.
                </p>
              </div>
              <div className="p-4 sm:p-5 space-y-3">
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">Billed by mistake</p>
                  <p className="text-sm font-bold text-slate-800 mt-0.5">
                    <span className="font-mono text-slate-400 mr-1.5">{fixItem.item.product_sku}</span>{fixItem.item.product_name}
                  </p>
                  <p className="text-[11px] text-slate-500">×{fixItem.item.quantity} at Rs.{Number(fixItem.item.unit_price || 0).toLocaleString()} — goes back on the shelf</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Should have been</label>
                  <input autoFocus value={fixSearch} onChange={e => { setFixSearch(e.target.value); setFixPick(null) }}
                    placeholder="Search by part ID or name…"
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-blue-400" />
                  {fixPick ? (
                    <div className="mt-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          <span className="font-mono text-slate-400 mr-1.5">{fixPick.sku}</span>{fixPick.name}
                        </p>
                        <p className="text-[11px] text-emerald-700 font-semibold">{fixPick.quantity} on hand — {fixItem.item.quantity} will come off</p>
                      </div>
                      <button onClick={() => { setFixPick(null); setFixSearch('') }} className="text-[11px] font-bold text-slate-400 shrink-0">change</button>
                    </div>
                  ) : fixSearch.trim().length >= 2 && (
                    <div className="mt-2 border border-slate-200 rounded-lg max-h-52 overflow-y-auto divide-y divide-slate-100">
                      {(products || []).filter((p: any) => {
                        if (p.id === fixItem.item.product_id) return false
                        const q = fixSearch.toLowerCase().trim()
                        return String(p.sku || '').toLowerCase().includes(q) || String(p.name || '').toLowerCase().includes(q)
                      }).slice(0, 30).map((p: any) => (
                        <button key={p.id} onClick={() => setFixPick(p)} className="w-full text-left px-3 py-2 hover:bg-slate-50">
                          <p className="text-xs font-semibold text-slate-800 truncate">
                            <span className="font-mono text-slate-400 mr-1.5">{p.sku}</span>{p.name}
                          </p>
                          <p className={'text-[10px] font-semibold ' + (p.quantity > 0 ? 'text-slate-400' : 'text-red-500')}>{p.quantity} on hand</p>
                        </button>
                      ))}
                      {(products || []).filter((p: any) => {
                        const q = fixSearch.toLowerCase().trim()
                        return p.id !== fixItem.item.product_id && (String(p.sku || '').toLowerCase().includes(q) || String(p.name || '').toLowerCase().includes(q))
                      }).length === 0 && <p className="px-3 py-3 text-xs text-slate-400">Nothing matches that.</p>}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Why <span className="font-normal text-slate-400">(recorded against your name)</span></label>
                  <input value={fixReason} onChange={e => setFixReason(e.target.value)}
                    placeholder="e.g. wrong SKU picked at the counter"
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-blue-400" />
                </div>

                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  The sale keeps its date, quantity and price. Only the stock moves — and the correction is listed on the daily report.
                </p>
              </div>
              <div className="p-4 sm:p-5 border-t border-slate-100 flex gap-2">
                <button onClick={() => setFixItem(null)} className="flex-1 px-4 py-2.5 rounded-lg border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
                <button disabled={!fixPick || fixSaving}
                  onClick={async () => {
                    if (!fixPick) return
                    setFixSaving(true)
                    try {
                      const r = await fetch('/api/vendor/sales', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ action: 'correct_item', saleId: fixItem.sale.id, saleItemId: fixItem.item.id, newProductId: fixPick.id, reason: fixReason }),
                      })
                      const j = await r.json()
                      if (!r.ok || j.error) { showToast('⚠️ ' + (j.error || 'Could not correct the line')) }
                      else { showToast('✅ ' + j.message); setFixItem(null); fetchSales(); fetchData(false, true) }
                    } catch { showToast('Network error') }
                    setFixSaving(false)
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-40">
                  {fixSaving ? 'Correcting…' : 'Correct the item'}
                </button>
              </div>
            </div>
          </div>
        )}

        {returnModal && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => { setReturnModal(null); setReturnReason('') }}>
            <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="bg-amber-50 px-5 py-4 border-b border-amber-100 flex-shrink-0">
                <h3 className="font-bold text-base text-amber-800">
                  {returnModal.tax_serial ? '🧾 Issue Credit Note' : '↩ Return Items'}
                </h3>
                <p className="text-xs text-amber-600 mt-1">{returnModal.invoice_no} · {returnModal.customer_name}</p>
                {returnModal.tax_serial && (
                  <p className="text-[10px] text-orange-500 mt-0.5 font-semibold">Credit Note (CRN) will be issued against {returnModal.tax_serial}</p>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Select items & quantities to return</p>
                <div className="space-y-3">
                  {(returnModal.items || []).map((item: any) => {
                    const maxReturn = item.quantity - (item.returned_quantity || 0)
                    const currentReturn = returnItems[item.id] || 0
                    if (maxReturn <= 0) return (
                      <div key={item.id} className="bg-slate-50 rounded-xl p-3 opacity-50">
                        <div className="flex justify-between items-center">
                          <div><p className="font-semibold text-xs text-slate-500 line-through">{item.product_name}</p></div>
                          <span className="text-[10px] font-bold text-slate-400">Fully returned</span>
                        </div>
                      </div>
                    )
                    return (
                      <div key={item.id} className={`rounded-xl p-3 border-2 transition ${currentReturn > 0 ? 'border-amber-300 bg-amber-50' : 'border-slate-100 bg-white'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm text-slate-800">{item.product_name}</p>
                            <p className="text-xs text-slate-400">{item.product_sku} · Rs.{parseFloat(item.unit_price).toLocaleString()} each</p>
                          </div>
                          <span className="text-xs font-semibold text-slate-400 flex-shrink-0 ml-2">Bought: {item.quantity}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-semibold text-slate-500">Return:</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setReturnItems(prev => ({ ...prev, [item.id]: Math.max(0, (prev[item.id] || 0) - 1) }))}
                              className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-600 active:bg-slate-200">−</button>
                            <span className="w-10 text-center font-black text-base">{currentReturn}</span>
                            <button onClick={() => setReturnItems(prev => ({ ...prev, [item.id]: Math.min(maxReturn, (prev[item.id] || 0) + 1) }))}
                              className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center font-bold text-amber-700 active:bg-amber-200">+</button>
                          </div>
                          <button onClick={() => setReturnItems(prev => ({ ...prev, [item.id]: maxReturn }))}
                            className="text-[10px] font-bold text-amber-600 active:text-amber-800 ml-auto">All ({maxReturn})</button>
                          {currentReturn > 0 && <span className="text-xs font-bold text-amber-600">Rs.{(currentReturn * parseFloat(item.unit_price)).toLocaleString()}</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Reason <span className="text-slate-300 font-normal normal-case">(optional)</span></label>
                  <input
                    type="text"
                    value={returnReason}
                    onChange={e => setReturnReason(e.target.value)}
                    placeholder="e.g. Wrong item, Defective, Customer changed mind"
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  />
                </div>
                {(() => {
                  const totalRefund = Object.entries(returnItems).reduce((sum, [itemId, qty]) => {
                    const item = (returnModal.items || []).find((i: any) => i.id === itemId)
                    return sum + (item ? qty * parseFloat(item.unit_price) : 0)
                  }, 0)
                  if (totalRefund <= 0) return null
                  return (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <div className="flex justify-between items-center mb-4">
                        <span className="text-sm font-bold text-slate-700">Total Refund</span>
                        <span className="text-xl font-black text-amber-600">Rs.{totalRefund.toLocaleString()}</span>
                      </div>
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Refund Method</p>
                      <div className="space-y-2">
                        {/* Advance only works for registered customers — for walk-ins the
                            server can't credit anyone and the money would vanish */}
                        {returnModal.customer_id && <button onClick={() => handleReturn('advance')} disabled={returnLoading}
                          className="w-full text-left px-4 py-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 active:bg-emerald-100 transition disabled:opacity-50">
                          <div className="font-bold text-sm text-emerald-800">💰 Add Rs.{totalRefund.toLocaleString()} to Advance</div>
                          <p className="text-xs text-emerald-600 mt-0.5">Customer can use it for future purchases</p>
                        </button>}
                        <button onClick={() => handleReturn('cash')} disabled={returnLoading}
                          className="w-full text-left px-4 py-3 rounded-xl border-2 border-slate-200 bg-slate-50 active:bg-slate-100 transition disabled:opacity-50">
                          <div className="font-bold text-sm text-slate-800">💵 Cash Refund Rs.{totalRefund.toLocaleString()}</div>
                          <p className="text-xs text-slate-500 mt-0.5">Give cash back to customer</p>
                        </button>
                      </div>
                    </div>
                  )
                })()}
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex-shrink-0">
                <button onClick={() => { setReturnModal(null); setReturnReason('') }} className="w-full text-sm font-semibold text-slate-500 py-2 active:text-slate-700">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* ── CREDIT NOTE PROMPT (after return on tax invoice) ── */}
        {pendingCreditNote && (
          <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl">
              <div className="bg-blue-50 px-5 py-4 border-b border-blue-100">
                <h3 className="font-bold text-base text-blue-800">🧾 Issue Credit Note?</h3>
                <p className="text-xs text-blue-600 mt-1">Return processed against tax invoice <strong>{pendingCreditNote.taxSerial}</strong></p>
              </div>
              <div className="px-5 py-4 space-y-3">
                <p className="text-sm text-slate-600">Sri Lankan tax law requires a <strong>Credit Note</strong> for any return against a gazette tax invoice. This reduces your output VAT for the period.</p>
                <div className="bg-slate-50 rounded-xl p-4 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Customer</span><span className="font-semibold">{pendingCreditNote.customerName || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Original Invoice</span><span className="font-mono text-xs">{pendingCreditNote.taxSerial}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Credit Amount</span><span className="font-black text-blue-700">Rs.{pendingCreditNote.refundAmount.toLocaleString()}</span></div>
                </div>
              </div>
              <div className="px-5 pb-5 space-y-2">
                <button onClick={issueCreditNote} disabled={creditNoteLoading} className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-xl">
                  {creditNoteLoading ? '⏳ Issuing…' : '✅ Issue Credit Note'}
                </button>
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-amber-700 font-semibold">⚠️ Required by law</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">A Credit Note is mandatory for returns against a gazette tax invoice. Skipping means your VAT register will show an overstated output VAT until a CRN is issued manually.</p>
                  <button onClick={() => setPendingCreditNote(null)} className="text-[11px] text-amber-700 underline mt-1">Dismiss — I will issue manually</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── ISSUED CREDIT NOTE — show number + print ── */}
        {issuedCreditNote && (
          <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => setIssuedCreditNote(null)}>
            <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="bg-green-50 px-5 py-4 border-b border-green-100">
                <h3 className="font-bold text-base text-green-800">✅ Credit Note Issued</h3>
                <p className="text-xs text-green-600 mt-1">Keep this for your VAT records</p>
              </div>
              <div className="px-5 py-5 space-y-3">
                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-slate-500">Credit Note No.</span><span className="font-black font-mono text-green-700 text-base">{issuedCreditNote.credit_note_no}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Against Invoice</span><span className="font-mono text-xs">{issuedCreditNote.original_serial}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">VAT Credited</span><span className="font-semibold">Rs.{parseInt(issuedCreditNote.vat_amount || 0).toLocaleString()}</span></div>
                  <div className="flex justify-between"><span className="text-slate-500">Total Credit</span><span className="font-black text-blue-700">Rs.{parseInt(issuedCreditNote.total || 0).toLocaleString()}</span></div>
                </div>
              </div>
              <div className="px-5 pb-5 space-y-2">
                <button onClick={() => printCreditNote(issuedCreditNote, posInvoiceEntities.find((e: any) => e.id === issuedCreditNote.invoice_entity_id))} className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm py-3 rounded-xl">🖨️ Print Credit Note</button>
                <button onClick={() => setIssuedCreditNote(null)} className="w-full text-sm font-semibold text-slate-400 py-2 active:text-slate-600">Done</button>
              </div>
            </div>
          </div>
        )}

        {/* VOID SALE MODAL */}
        {reverseSale && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setReverseSale(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">Withdraw this tax invoice</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">{reverseSale.tax_serial} · Rs.{parseFloat(reverseSale.total || 0).toLocaleString()}</p>

            {!reverseCheck ? (
              <p className="text-sm text-slate-400 py-4 text-center">Checking…</p>
            ) : !reverseCheck.eligible ? (
              <>
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700 font-semibold">
                  {reverseCheck.reason}
                </div>
                <button onClick={() => setReverseSale(null)}
                  className="w-full mt-4 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">Close</button>
              </>
            ) : (
              <>
                <div className="bg-amber-50 border-2 border-amber-300 rounded-lg px-3 py-2.5 text-xs text-amber-900 space-y-1">
                  <p><strong>{reverseCheck.taxSerial}</strong> is voided and stays in the ledger — the number is never reissued, because a printed copy may be with the customer.</p>
                  <p>The sale goes back to receipt <strong>{reverseCheck.receiptNo}</strong>, dated {reverseCheck.originalSaleDate}.</p>
                  <p>Output VAT of <strong>Rs.{(reverseCheck.vatAmount || 0).toLocaleString()}</strong> is removed. The total stays Rs.{(reverseCheck.total || 0).toLocaleString()}.</p>
                </div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mt-3 mb-1">Reason (recorded against your name) *</label>
                <input value={reverseReason} autoFocus onChange={e => setReverseReason(e.target.value)}
                  placeholder="e.g. promoted in error, wrong customer"
                  className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-amber-400" />
                <div className="flex gap-2 mt-4">
                  <button onClick={() => setReverseSale(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
                  <button onClick={confirmReverse} disabled={reversing || !reverseReason.trim()}
                    className="flex-1 bg-amber-600 hover:bg-amber-700 disabled:opacity-40 text-white font-black text-sm py-2.5 rounded-xl">
                    {reversing ? 'Working…' : 'Withdraw'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {promoteSale && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setPromoteSale(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black text-slate-900">Re-issue as a Pvt Ltd tax invoice</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">
              {promoteSale.receipt_no} · {promoteSale.customer_name || 'Walk-in'} · Rs.{parseFloat(promoteSale.total || 0).toLocaleString()}
            </p>

            {!promoteCheck ? (
              <p className="text-sm text-slate-400 py-4 text-center">Checking…</p>
            ) : !promoteCheck.eligible ? (
              <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm text-red-700 font-semibold">
                {promoteCheck.reason}
              </div>
            ) : (
              <>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-xs text-slate-600 space-y-1">
                  <p>Sold <strong>{promoteCheck.originalSaleDate}</strong> — {promoteCheck.ageDays} day{promoteCheck.ageDays !== 1 ? 's' : ''} ago, inside the {promoteCheck.windowDays}-day window.</p>
                  <p>Becomes a <strong>{promoteCheck.targetEntity?.serial_qqqq}</strong> invoice in period <strong>{promoteCheck.period}</strong>.</p>
                  <p>
                    Both dates will print as <strong>{promoteCheck.supplyDate}</strong>
                    {promoteCheck.supplyDate === promoteCheck.originalSaleDate
                      ? ' — the sale\u2019s own date, which is already on or after the last invoice.'
                      : <> — carried forward from {promoteCheck.datedFrom?.serial}.</>}
                  </p>
                  {/* The customer already paid — VAT comes OUT of that figure,
                      it is not added on top, or their receipt stops matching
                      the cash they handed over. */}
                  <p className="text-slate-500">
                    The total stays at Rs.{parseFloat(promoteSale.total || 0).toLocaleString()}. VAT is taken out of it, not added — the customer has already paid.
                  </p>
                </div>

                {promoteCheck.warnings?.length > 0 && (
                  <div className="mt-3 bg-amber-50 border-2 border-amber-300 rounded-lg px-3 py-2.5">
                    <p className="text-xs font-black text-amber-800 mb-1.5">⚠️ Numbering &amp; period</p>
                    {promoteCheck.warnings.map((w: any) => (
                      <p key={w.code} className="text-[11px] text-amber-800 leading-snug mb-1.5 last:mb-0">{w.text}</p>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setPromoteSale(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">Cancel</button>
                  <button onClick={confirmPromote} disabled={promoting}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-black text-sm py-2.5 rounded-xl">
                    {promoting ? 'Working…' : promoteCheck.warnings?.length > 0 ? 'Promote anyway' : 'Promote'}
                  </button>
                </div>
              </>
            )}
            {promoteCheck && !promoteCheck.eligible && (
              <button onClick={() => setPromoteSale(null)}
                className="w-full mt-4 px-4 py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600">Close</button>
            )}
          </div>
        </div>
      )}

      {voidModal && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setVoidModal(null)}>
            <div className="bg-white rounded-2xl max-w-sm w-full overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="bg-red-50 px-5 py-4 border-b border-red-100">
                <h3 className="font-bold text-base text-red-800">Void Sale</h3>
                <p className="text-xs text-red-600 mt-1">This will reverse the sale and restore stock</p>
              </div>
              <div className="px-5 py-4">
                <div className="bg-slate-50 rounded-xl p-3 mb-4">
                  <p className="text-sm font-bold text-slate-800">{voidModal.customerName}</p>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-slate-500">Sale Total</span>
                    <span className="text-sm font-black text-slate-800">Rs.{voidModal.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between mt-0.5">
                    <span className="text-xs text-slate-500">Amount Paid</span>
                    <span className="text-sm font-bold text-green-600">Rs.{voidModal.paid.toLocaleString()}</span>
                  </div>
                </div>
                {voidModal.paid > 0 ? (
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">How to refund Rs.{voidModal.paid.toLocaleString()}?</p>
                    <div className="space-y-2">
                      <button onClick={() => voidSale(voidModal.saleId, 'advance')}
                        className="w-full text-left px-4 py-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 transition">
                        <div className="font-bold text-sm text-emerald-800">💰 Add to Customer Advance</div>
                        <p className="text-xs text-emerald-600 mt-0.5">Rs.{voidModal.paid.toLocaleString()} will be added to their advance balance for future purchases</p>
                      </button>
                      <button onClick={() => voidSale(voidModal.saleId, 'cash')}
                        className="w-full text-left px-4 py-3 rounded-xl border-2 border-slate-200 bg-slate-50 hover:bg-slate-100 transition">
                        <div className="font-bold text-sm text-slate-800">💵 Cash Refund</div>
                        <p className="text-xs text-slate-500 mt-0.5">Record as cash refund — give Rs.{voidModal.paid.toLocaleString()} back to customer</p>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-xs text-slate-500 mb-3">No payments to refund. Stock will be restored.</p>
                    <button onClick={() => voidSale(voidModal.saleId, 'cash')}
                      className="w-full bg-red-500 hover:bg-red-600 text-white font-bold text-sm py-3 rounded-xl transition">Void Sale</button>
                  </div>
                )}
              </div>
              <div className="px-5 py-3 bg-slate-50 border-t border-slate-100">
                <button onClick={() => setVoidModal(null)} className="w-full text-sm font-semibold text-slate-500 py-2 hover:text-slate-700">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* STOCK TAKE */}
        {tab === 'stocktake' && isLkTax && (
          <TabStockLkTax
            vendor={data?.vendor}
            products={data?.products || []}
            vendorSettings={vendorSettings}
            showToast={showToast}
            onDataChanged={fetchData}
            initialView={stockInitialView}
            onInitialViewConsumed={() => setStockInitialView(null)}
            staffRole={staffRole}
            onNavigate={(t) => startTransition(() => setTab(t as VendorTab))}
          />
        )}
        {tab === 'stocktake' && !isLkTax && (
          <TabStockStandard
            vendor={data?.vendor}
            products={data?.products || []}
            vendorSettings={vendorSettings}
            showToast={showToast}
            onDataChanged={fetchData}
          />
        )}

        {/* SETTINGS */}
        {tab === 'settings' && (<div>
          <h1 className="text-2xl font-black text-slate-900 mb-4">⚙️ Settings</h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Feature 8: Pending Changes Banner */}
            {pendingChangeRequest && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 lg:col-span-2">
                <div className="flex items-start gap-2">
                  <span className="text-lg">⏳</span>
                  <div>
                    <h3 className="font-bold text-sm text-amber-800">Pending Changes Awaiting Admin Approval</h3>
                    <p className="text-xs text-amber-600 mt-1">You requested changes to: {Object.keys(pendingChangeRequest.requested_changes).join(', ')}</p>
                    <div className="mt-2 space-y-1">
                      {Object.entries(pendingChangeRequest.requested_changes).map(([key, value]) => (
                        <div key={key} className="text-xs flex items-center gap-2">
                          <span className="font-semibold text-slate-600 capitalize w-20">{key}:</span>
                          <span className="text-slate-400 line-through">{(pendingChangeRequest.current_values as any)[key]}</span>
                          <span className="text-orange-500">→</span>
                          <span className="font-semibold text-slate-800">{value as string}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-amber-500 mt-2">Submitted {new Date(pendingChangeRequest.requested_at).toLocaleDateString()}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Shop Info */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-sm mb-4">Shop Information</h3>
              <div className="space-y-3">
                <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Shop Name</label>
                  <input type="text" defaultValue={vendor?.name || ''} id="settings-name" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Location</label>
                  <input type="text" defaultValue={vendor?.location || ''} id="settings-location" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Address</label>
                  <input type="text" defaultValue={vendor?.address || ''} id="settings-address" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Phone</label>
                    <input type="tel" defaultValue={vendor?.phone || ''} id="settings-phone" maxLength={10} placeholder="0771234567"
                      onChange={() => setSettingsPhoneError('')}
                      onBlur={e => { const d = e.target.value.replace(/\D/g,''); setSettingsPhoneError(d && (d.length !== 10 || !d.startsWith('0')) ? 'Must be 10 digits starting with 0' : '') }}
                      className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none focus:border-orange-400 ${settingsPhoneError ? 'border-red-400' : 'border-slate-200'}`} />
                    {settingsPhoneError && <p className="text-red-500 text-[10px] mt-1 font-medium">{settingsPhoneError}</p>}
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">WhatsApp</label>
                    <input type="tel" defaultValue={vendor?.whatsapp || ''} id="settings-whatsapp" maxLength={10} placeholder="0771234567"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                </div>
                <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Description</label>
                  <textarea defaultValue={vendor?.description || ''} id="settings-description" rows={3} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" /></div>
                <button onClick={() => {
                  const v = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value || ''
                  const ph = v('settings-phone').replace(/\D/g,'')
                  if (ph && (ph.length !== 10 || !ph.startsWith('0'))) { setSettingsPhoneError('Must be 10 digits starting with 0 (e.g. 0771234567)'); return }
                  setSettingsPhoneError('')
                  updateShopInfo({ name: v('settings-name'), location: v('settings-location'), address: v('settings-address'), phone: formatPhoneSL(v('settings-phone')), whatsapp: formatPhoneSL(v('settings-whatsapp')), description: v('settings-description') })
                }} className="bg-orange-500 active:bg-orange-600 text-white text-sm font-bold px-5 py-2.5 rounded-lg w-full sm:w-auto">Save Shop Info</button>
              </div>
            </div>

            {/* Logo + Invoice */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-sm mb-4">Shop Logo</h3>
              <div className="flex items-start gap-4">
                <div className="w-24 h-24 rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden flex-shrink-0 bg-slate-50">
                  {vendorSettings.logo_url ? <img src={vendorSettings.logo_url} alt="Logo" className="w-full h-full object-contain" /> : <span className="text-3xl opacity-20">🏪</span>}
                </div>
                <div className="flex-1">
                  <p className="text-xs text-slate-500 mb-2">Appears on invoices and receipts.</p>
                  <p className="text-[10px] text-slate-400 mb-3">Square, PNG/JPG, under 500KB</p>
                  <input type="file" accept="image/*" onChange={handleLogoUpload} id="logo-upload" className="hidden" />
                  <button onClick={() => document.getElementById('logo-upload')?.click()} disabled={logoUploading} className="bg-blue-500 active:bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg disabled:opacity-50">{logoUploading ? 'Uploading...' : vendorSettings.logo_url ? 'Change Logo' : 'Upload Logo'}</button>
                  {vendorSettings.logo_url && <button onClick={() => setVendorSettings({ ...vendorSettings, logo_url: '' })} className="text-xs text-red-500 font-semibold ml-2">Remove</button>}
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100">
                <h3 className="font-bold text-sm mb-3">Invoice Customization</h3>
                <div className="space-y-3">
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Invoice Title (blank = shop name)</label>
                    <input type="text" value={vendorSettings.invoice_title || ''} onChange={e => setVendorSettings({ ...vendorSettings, invoice_title: e.target.value })} placeholder={vendor?.name || 'Shop Name'} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Tax/VAT Number</label>
                      <input type="text" value={vendorSettings.tax_id || ''} onChange={e => setVendorSettings({ ...vendorSettings, tax_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                    <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Email</label>
                      <input type="text" value={vendorSettings.email || ''} onChange={e => setVendorSettings({ ...vendorSettings, email: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                  </div>
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Invoice Footer</label>
                    <textarea value={vendorSettings.invoice_footer || ''} onChange={e => setVendorSettings({ ...vendorSettings, invoice_footer: e.target.value })} rows={2} placeholder="Thank you for your business!" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" /></div>
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Terms & Conditions (A4 only)</label>
                    <textarea value={vendorSettings.invoice_terms || ''} onChange={e => setVendorSettings({ ...vendorSettings, invoice_terms: e.target.value })} rows={3} placeholder="Goods once sold cannot be returned..." className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" /></div>
                  <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={vendorSettings.invoice_show_logo} onChange={e => setVendorSettings({ ...vendorSettings, invoice_show_logo: e.target.checked })} className="rounded" /><span className="text-sm text-slate-700">Show logo on invoices</span></label>
                  <button onClick={saveSettings} disabled={settingsLoading} className="bg-orange-500 active:bg-orange-600 text-white text-sm font-bold px-5 py-2.5 rounded-lg disabled:opacity-50 w-full sm:w-auto">{settingsLoading ? 'Saving...' : 'Save Invoice Settings'}</button>
                </div>
              </div>

              {/* Preview */}
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h3 className="font-bold text-sm mb-2">Preview</h3>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 text-center">
                  <div className="flex items-center justify-center gap-3 mb-2">
                    {vendorSettings.logo_url && vendorSettings.invoice_show_logo && <img src={vendorSettings.logo_url} alt="" className="w-10 h-10 object-contain" />}
                    <div>
                      <p className="font-black text-base">{vendorSettings.invoice_title || vendor?.name}</p>
                      <p className="text-[10px] text-slate-400">{vendor?.location} {vendor?.phone ? '· ' + vendor.phone : ''}</p>
                      {vendorSettings.tax_id && <p className="text-[10px] text-slate-400">Tax: {vendorSettings.tax_id}</p>}
                    </div>
                  </div>
                  <div className="border-t border-dashed border-slate-300 my-2" />
                  <p className="text-[10px] text-slate-400 italic">Items...</p>
                  <div className="border-t border-dashed border-slate-300 my-2" />
                  <p className="text-[10px] text-slate-500">{vendorSettings.invoice_footer || 'Thank you for your business!'}</p>
                  {vendorSettings.invoice_terms && <p className="text-[9px] text-slate-400 mt-1 italic">{vendorSettings.invoice_terms}</p>}
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-sm mb-4">Change Password</h3>
              <div className="space-y-3">
                <input type="password" value={passwordForm.new1} onChange={e => setPasswordForm({ ...passwordForm, new1: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="New password (min 6 chars)" />
                <input type="password" value={passwordForm.new2} onChange={e => setPasswordForm({ ...passwordForm, new2: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Confirm new password" />
                <button onClick={changePassword} disabled={passwordLoading || !passwordForm.new1} className="bg-slate-800 active:bg-slate-900 text-white text-sm font-bold px-5 py-2.5 rounded-lg disabled:opacity-50">{passwordLoading ? 'Changing...' : 'Update Password'}</button>
              </div>
            </div>

            {/* Staff logins — one panel: username, password, role, scope.
                Shared component so both vendors get the same behaviour, and
                WHEEL MART also reaches it from Staff → Logins. */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <StaffLogins showToast={showToast} isLkTax={isLkTax} />
            </div>

            {/* ══ WHEEL MART ONLY ═══════════════════════════════════════════════════════
                Tax Configuration panel (VAT rate, SSCL rate, liable base percentages).
                Standard vendors (Sakura) never see this.
                To edit: changes here affect ONLY WHEEL MART. Safe to touch.
                ════════════════════════════════════════════════════════════════════════ */}
            {/* ── Tax Configuration (lk_tax / Pvt Ltd only) ── */}
            {isLkTax && (() => {
              async function loadTaxConfig() {
                const r = await fetch('/api/vendor/tax-config')
                const j = await r.json()
                if (r.ok) setTaxConfigData(j.config)
              }
              if (taxConfigData === null) { loadTaxConfig(); return <div className="text-center py-6"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> }
              async function saveTaxConfig() {
                setTaxConfigSaving(true)
                try {
                  const r = await fetch('/api/vendor/tax-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taxConfigData) })
                  if (r.ok) showToast('Tax config saved!')
                  else { const j = await r.json(); showToast('⚠️ ' + (j.error || 'Failed')) }
                } finally { setTaxConfigSaving(false) }
              }
              const fields: Array<{key: string; label: string; unit: string; hint: string}> = [
                { key: 'vat_rate',        label: 'VAT Rate',                unit: '%',  hint: 'Standard rate (currently 18%)' },
                { key: 'sscl_rate',       label: 'SSCL Rate',               unit: '%',  hint: 'Rate on liable base (currently 2.5%)' },
                { key: 'liable_base_part',label: 'SSCL Liable Base — Parts',unit: '%',  hint: 'Portion of parts turnover liable for SSCL (currently 50%)' },
                { key: 'liable_base_svc', label: 'SSCL Liable Base — SVC',  unit: '%',  hint: 'Portion of service turnover liable for SSCL (currently 100%)' },
                { key: 'card_fee_pct', label: 'Card machine fee', unit: '%', hint: 'What the bank takes on card payments — the POS "+ fee" button uses this when the customer pays it' },
              ]
              return (
                <div className="bg-white rounded-xl border border-slate-200 p-5 lg:col-span-2">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-bold text-sm text-slate-800">🧾 Tax Rate Configuration</h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">MacForce Auto Engineering (Pvt) Ltd only — do not change without accountant advice</p>
                    </div>
                    <button onClick={saveTaxConfig} disabled={taxConfigSaving} className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
                      {taxConfigSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {fields.map(f => (
                      <div key={f.key}>
                        <label className="text-[11px] font-bold text-slate-500 uppercase block mb-1">{f.label}</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={taxConfigData[f.key] ?? ''}
                            onChange={e => setTaxConfigData({ ...taxConfigData!, [f.key]: parseFloat(e.target.value) || 0 })}
                            className="w-28 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400"
                          />
                          <span className="text-sm font-bold text-slate-400">{f.unit}</span>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1">{f.hint}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    <p className="text-[10px] text-amber-700">
                      Effective SSCL: Parts = {((taxConfigData['sscl_rate'] ?? 2.5) * (taxConfigData['liable_base_part'] ?? 50) / 100).toFixed(4)}% of turnover &nbsp;·&nbsp;
                      SVC = {((taxConfigData['sscl_rate'] ?? 2.5) * (taxConfigData['liable_base_svc'] ?? 100) / 100).toFixed(4)}% of turnover
                    </p>
                  </div>
                </div>
              )
            })()}

          </div>
        </div>)}

      {/* STOCKTAKE COST PROMPT MODAL moved into _lk_tax/TabStock and _standard/TabStock components */}

      </main>
    </div>
  )
}
