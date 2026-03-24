'use client'
import { toWhatsAppNumber, formatPhoneSL, validatePhoneSL } from '@/lib/constants'

import { useState, useEffect, useRef } from 'react'

type VendorTab = 'overview' | 'products' | 'add' | 'bulk' | 'pos' | 'sales' | 'credit' | 'settings'
const CATEGORIES = ['Engine Parts','Transmission & Drivetrain','Suspension & Steering','Brake System','Electrical & Electronics','Body Parts','Lighting','Interior Parts','A/C & Radiator','Wheels & Tires','Exhaust System','Filters & Fluids','Accessories','Hybrid & EV Parts','Other','Windscreen','Beading Belts & Rubber','Audio & Video','Safety']
const CONDITIONS = ['New-Genuine','New-Other','Reconditioned','Damaged']
const PAY_METHODS = ['cash','cheque','bank','card']
const PAY_LABELS: Record<string, string> = { cash:'Cash', cheque:'Cheque', bank:'Bank Transfer', card:'Card', advance:'Advance', credit:'Credit' }

async function compressImage(file: File, maxSizeKB = 125): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image(); const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url); const canvas = document.createElement('canvas')
      let { width, height } = img; if (width > 1200) { height = Math.round(height * (1200 / width)); width = 1200 }
      canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0, width, height)
      let lo = 0.1, hi = 0.92, bestBlob: Blob | null = null
      function tryQ() { const mid = (lo + hi) / 2; canvas.toBlob((blob) => { if (!blob) { resolve(file); return }; if (blob.size / 1024 <= maxSizeKB) { bestBlob = blob; lo = mid } else { hi = mid; if (!bestBlob) bestBlob = blob }; if (hi - lo > 0.02) tryQ(); else resolve(new File([bestBlob || blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' })) }, 'image/jpeg', mid) }
      tryQ()
    }; img.src = url
  })
}
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

function printInvoice(sale: any, vendor: any, format: 'a4' | 'thermal', settings?: any) {
  const items = sale.items || []; const payments = sale.payments || []; const isThermal = format === 'thermal'; const w = isThermal ? 300 : 800
  const s = settings || {}
  const shopName = s.invoice_title || vendor?.name || 'kuruma.lk'
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false && !isThermal) ? `<img src="${s.logo_url}" style="height:${isThermal ? '30px' : '60px'};max-width:${isThermal ? '60px' : '120px'};object-fit:contain;margin-bottom:4px" />` : ''
  const thermalLogoHtml = (s.logo_url && s.invoice_show_logo !== false && isThermal) ? `<img src="${s.logo_url}" style="height:30px;max-width:60px;object-fit:contain;margin-bottom:2px" />` : ''
  const taxLine = s.tax_id ? `<div style="font-size:${isThermal ? '9px' : '12px'};color:#000;font-weight:700">Tax/VAT: ${s.tax_id}</div>` : ''
  const emailLine = s.email ? `<div style="font-size:${isThermal ? '9px' : '12px'};color:#000;font-weight:700">${s.email}</div>` : ''
  const footerText = s.invoice_footer || 'Thank you for your business!'
  const termsHtml = (!isThermal && s.invoice_terms) ? `<div style="margin-top:12px;padding:10px;border:2px solid #000;border-radius:6px;font-size:13px;color:#000;font-weight:600;line-height:1.5"><strong>Terms & Conditions:</strong><br/>${s.invoice_terms.replace(/\n/g, '<br/>')}</div>` : ''
  const paymentLines = payments.map((p: any) => `<div style="display:flex;justify-content:space-between;font-size:${isThermal ? '10px' : '15px'};font-weight:700;color:#000"><span>${(p.payment_method || 'cash').toUpperCase()}${p.cheque_number ? ' #' + p.cheque_number : ''}</span><span>Rs.${parseFloat(p.amount).toLocaleString()}</span></div>`).join('')
  const a4Style = `@page{size:A4;margin:15mm 30mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:16px;color:#000;font-weight:700;width:520px;max-width:100%;margin:0 auto}.header{text-align:center;padding:20px 0 15px;margin-bottom:15px}.shop-name{font-size:28px;font-weight:900}table{width:100%;border-collapse:collapse;margin:15px 0}th{text-align:left;font-size:14px;font-weight:900;padding:10px 4px;border-bottom:1px dashed #000}td{padding:12px 4px;font-size:15px;font-weight:700}.text-right{text-align:right}.totals{padding-top:12px;margin-top:12px}.total-row{display:flex;justify-content:space-between;padding:6px 0;font-size:16px;font-weight:800}.grand-total{font-weight:900;font-size:26px;padding:14px 0;margin-top:8px;border-top:1px dashed #000}.balance-due{font-weight:900;font-size:20px;text-align:right;margin-top:15px;padding:12px;border:2px dashed #000}.footer{text-align:center;padding:25px 0;font-size:13px;font-weight:600;margin-top:25px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`
  const thermalStyle = `@page{size:80mm auto;margin:2mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;color:#000;width:300px;max-width:100%;margin:0 auto}.header{text-align:center;padding:5px 0;border-bottom:1px dashed #000}.shop-name{font-size:16px;font-weight:900}table{width:100%;border-collapse:collapse;margin:5px 0}th{text-align:left;font-size:10px;font-weight:900;padding:3px 2px;border-bottom:1px dashed #000}td{padding:3px 2px;font-size:11px;border-bottom:1px solid #ddd}.text-right{text-align:right}.totals{border-top:1px dashed #000;padding-top:5px}.total-row{display:flex;justify-content:space-between;padding:2px 0;font-size:12px;font-weight:700}.grand-total{font-weight:900;font-size:16px;border-top:1px dashed #000;border-bottom:1px dashed #000;padding:5px 0;margin-top:5px}.footer{text-align:center;padding:8px 0 5px;font-size:10px;border-top:1px dashed #000;margin-top:5px}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}`
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${sale.invoice_no}</title>
<style>${isThermal ? thermalStyle : a4Style}</style></head><body>
<div class="header">${isThermal ? thermalLogoHtml : logoHtml}<div class="shop-name">${shopName}</div>${vendor?.location ? `<div style="font-size:${isThermal ? '10px' : '13px'};font-weight:600">${vendor.location}${vendor?.address ? ', ' + vendor.address : ''}</div>` : ''}${vendor?.phone ? `<div style="font-size:${isThermal ? '10px' : '13px'};font-weight:600">Tel: ${vendor.phone}${vendor?.whatsapp && vendor.whatsapp !== vendor.phone ? ' | WhatsApp: ' + vendor.whatsapp : ''}</div>` : ''}${taxLine}${emailLine}</div>
<div style="padding:${isThermal ? '5px 0' : '12px 0'};font-size:${isThermal ? '11px' : '16px'};line-height:1.8"><div><strong>Invoice: </strong><strong style="font-size:${isThermal ? '12px' : '20px'}">${sale.invoice_no}</strong></div><div><strong>Date: </strong><strong>${formatDate(sale.created_at)}</strong></div><div><strong>Customer: </strong><strong>${sale.customer_name}${sale.customer_phone ? ' (' + sale.customer_phone + ')' : ''}</strong></div>${sale.vehicle_no ? `<div><strong>Vehicle: </strong><strong style="font-size:${isThermal ? '12px' : '20px'};letter-spacing:2px">${sale.vehicle_no}</strong></div>` : ''}</div>
<table><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead><tbody>${items.map((i: any) => `<tr><td>${i.product_sku ? i.product_sku + ' - ' : ''}${i.product_name}</td><td class="text-right">${i.quantity}</td><td class="text-right">Rs.${parseFloat(i.unit_price).toLocaleString()}</td><td class="text-right">Rs.${parseFloat(i.total).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<div class="totals">${parseFloat(sale.discount) > 0 ? `<div class="total-row"><span>Subtotal</span><span>Rs.${parseFloat(sale.subtotal).toLocaleString()}</span></div><div class="total-row" style="color:#000"><span>Discount</span><span>-Rs.${parseFloat(sale.discount).toLocaleString()}</span></div>` : ''}<div class="total-row grand-total"><span>TOTAL</span><span>Rs.${parseFloat(sale.total).toLocaleString()}</span></div></div>
${paymentLines ? `<div style="margin-top:6px"><div style="font-size:${isThermal ? '10px' : '11px'};font-weight:900;margin-bottom:3px">PAYMENTS</div>${paymentLines}</div>` : ''}
${parseFloat(sale.balance_due) > 0 ? (isThermal ? `<div style="text-align:center;font-weight:900;font-size:14px;margin-top:8px;padding:5px;border-top:1px dashed #000;border-bottom:1px dashed #000">BALANCE DUE: Rs.${parseFloat(sale.balance_due).toLocaleString()}</div>` : `<div class="balance-due">BALANCE DUE: Rs.${parseFloat(sale.balance_due).toLocaleString()}</div>`) : ''}
${termsHtml}
<div class="footer"><p>${footerText}</p><p style="margin-top:3px;font-size:${isThermal ? '8px' : '10px'}">Powered by kuruma.lk</p></div></body></html>`
  const win = window.open('', '_blank', `width=${w + 50},height=700`); if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
}

function sendWhatsAppBill(sale: any, vendor: any, phone: string) {
  const waPhone = toWhatsAppNumber(phone)
  const items = (sale.items || []).map((i: any) => `• ${i.product_sku || ''} ${i.product_name} x${i.quantity} = Rs.${parseFloat(i.total).toLocaleString()}`).join('%0A')
  const payments = (sale.payments || []).map((p: any) => `  ${(p.payment_method || 'cash').toUpperCase()}: Rs.${parseFloat(p.amount).toLocaleString()}`).join('%0A')
  let msg = `*Invoice: ${sale.invoice_no}*%0A${vendor?.name || 'kuruma.lk'}%0A${formatDate(sale.created_at)}${sale.vehicle_no ? '%0AVehicle: ' + sale.vehicle_no : ''}%0A%0A${items}%0A%0ASubtotal: Rs.${parseFloat(sale.subtotal).toLocaleString()}`
  if (parseFloat(sale.discount) > 0) msg += `%0ADiscount: -Rs.${parseFloat(sale.discount).toLocaleString()}`
  msg += `%0A*TOTAL: Rs.${parseFloat(sale.total).toLocaleString()}*`
  if (payments) msg += `%0A%0APayments:%0A${payments}`
  if (parseFloat(sale.balance_due) > 0) msg += `%0A%0A⚠️ *BALANCE DUE: Rs.${parseFloat(sale.balance_due).toLocaleString()}*`
  msg += `%0A%0AThank you! - ${vendor?.name || 'kuruma.lk'}`
  window.open(`https://wa.me/${waPhone}?text=${msg}`, '_blank')
}

export default function VendorDashboard() {
  const [tab, setTab] = useState<VendorTab>('overview')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [productSearch, setProductSearch] = useState('')
  const [showSoldOut, setShowSoldOut] = useState(false)

  const [newProduct, setNewProduct] = useState({ partId:'', name:'', description:'', category:'Other', make:'', model:'', modelCode:'', year:'', condition:'Reconditioned', side:'', color:'', oemCode:'', cost:'', price:'', quantity:'1', show_price:true })
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
  const [posCart, setPosCart] = useState<any[]>([])
  const [posSearch, setPosSearch] = useState('')
  const [posCustomer, setPosCustomer] = useState<any>({ id: null, name: '', phone: '', advance: 0 })
  const [customerSuggestions, setCustomerSuggestions] = useState<any[]>([])
  const [posDiscount, setPosDiscount] = useState('')
  const [posPayments, setPosPayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [posNotes, setPosNotes] = useState('')
  const [posDate, setPosDate] = useState(new Date().toISOString().split('T')[0])
  const [posVehicleNo, setPosVehicleNo] = useState('')
  const [posLoading, setPosLoading] = useState(false)
  const [posErrors, setPosErrors] = useState<{ name?: boolean; phone?: boolean }>({})
  const [posReceipt, setPosReceipt] = useState<any>(null)
  const [useAdvance, setUseAdvance] = useState(false)

  // Sales
  const [salesData, setSalesData] = useState<any>(null)
  const [salesPeriod, setSalesPeriod] = useState('today')
  const [salesLoading, setSalesLoading] = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [settingsPhoneError, setSettingsPhoneError] = useState('')
  const [posPhoneError, setPosPhoneError] = useState('')
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
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10))
  const [reportFrom, setReportFrom] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
  const [reportTo, setReportTo] = useState(new Date().toISOString().slice(0, 10))
  const [customerHistoryId, setCustomerHistoryId] = useState<string | null>(null)
  const [customerHistoryName, setCustomerHistoryName] = useState('')
  const [customerHistory, setCustomerHistory] = useState<any[] | null>(null)

  // Credit
  const [creditCustomers, setCreditCustomers] = useState<any[]>([])
  const [creditLoading, setCreditLoading] = useState(false)
  const [showAllCustomers, setShowAllCustomers] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<any>(null)
  const [outstandingSales, setOutstandingSales] = useState<any[]>([])
  const [settleSale, setSettleSale] = useState<any>(null)
  const [settlePayments, setSettlePayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [settleLoading, setSettleLoading] = useState(false)

  // Settings
  const [vendorSettings, setVendorSettings] = useState<any>({
    invoice_title: '', invoice_footer: '', invoice_terms: '', invoice_show_logo: true,
    logo_url: '', address_line1: '', address_line2: '', tax_id: '', email: ''
  })
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [logoUploading, setLogoUploading] = useState(false)
  const [passwordForm, setPasswordForm] = useState({ current: '', new1: '', new2: '' })
  const [passwordLoading, setPasswordLoading] = useState(false)

  // Staff / multi-user
  const [staffList, setStaffList] = useState<any[]>([])
  const [staffLoading, setStaffLoading] = useState(false)
  const [newStaff, setNewStaff] = useState({ email: '', name: '', role: 'cashier', pin: '' })
  const [staffTempPassword, setStaffTempPassword] = useState<{ name: string; email: string; password: string } | null>(null)
  const [editingCustomer, setEditingCustomer] = useState<any>(null)
  const [editCustomerLoading, setEditCustomerLoading] = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', whatsapp: '', email: '', address: '', notes: '', advance: '', credit: '' })
  const [addCustomerLoading, setAddCustomerLoading] = useState(false)
  const [adjustAdvanceAmount, setAdjustAdvanceAmount] = useState('')

  // Void sale modal
  const [voidModal, setVoidModal] = useState<{ saleId: string; total: number; paid: number; customerName: string } | null>(null)
  const [returnModal, setReturnModal] = useState<any>(null)
  const [returnItems, setReturnItems] = useState<Record<string, number>>({})
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

  // Primary image selection mode
  const [primaryMode, setPrimaryMode] = useState(false)
  const [primaryChanges, setPrimaryChanges] = useState<Map<string, { imageId: string, images: any[] }>>(new Map())

  // Feature 8: Vendor change request
  const [pendingChangeRequest, setPendingChangeRequest] = useState<any>(null)

  useEffect(() => { fetchData(); fetchSettings() }, [])
  useEffect(() => { if (tab === 'sales') fetchSales() }, [tab, salesPeriod])
  useEffect(() => { if (tab === 'credit') fetchCreditCustomers() }, [tab, showAllCustomers])
  useEffect(() => {
    if (!customerHistoryId) { setCustomerHistory(null); return }
    fetch(`/api/vendor/sales?customer_id=${customerHistoryId}`).then(r => r.json()).then(j => setCustomerHistory(j.sales || [])).catch(() => setCustomerHistory([]))
  }, [customerHistoryId])

  useEffect(() => {
    if (tab === 'settings') {
      fetchSettings()
      fetchStaff()
      // Feature 8: Check for pending change requests
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

  async function fetchSettings() {
    try {
      const res = await fetch('/api/vendor/settings')
      if (res.ok) {
        const j = await res.json()
        if (j.settings) setVendorSettings({ ...vendorSettings, ...j.settings })
        if (j.role) { setStaffRole(j.role); if (j.role === 'cashier') setTab('pos') }
      }
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

  async function updateShopInfo(fields: any) {
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
  }

  async function fetchStaff() {
    setStaffLoading(true)
    try {
      const res = await fetch('/api/vendor/settings?action=staff')
      if (res.ok) { const j = await res.json(); setStaffList(j.staff || []) }
    } catch {}
    setStaffLoading(false)
  }

  async function addStaffMember() {
    if (!newStaff.email || !newStaff.name) { showToast('Name and email required'); return }
    try {
      const res = await fetch('/api/vendor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_staff', ...newStaff }) })
      const j = await res.json()
      if (j.success) {
        if (j.tempPassword) setStaffTempPassword({ name: newStaff.name, email: newStaff.email, password: j.tempPassword })
        else showToast('Staff added!')
        setNewStaff({ email: '', name: '', role: 'cashier', pin: '' })
        fetchStaff()
      } else { showToast(j.error || 'Failed') }
    } catch { showToast('Error adding staff') }
  }

  async function removeStaff(staffId: string) {
    if (!confirm('Remove this staff member?')) return
    try {
      const res = await fetch('/api/vendor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove_staff', staff_id: staffId }) })
      if (res.ok) { showToast('Removed'); fetchStaff() }
    } catch {}
  }

  async function fetchData() { setLoading(true); try { const r = await fetch('/api/vendor/data'); if (r.status === 401 || r.status === 403) { window.location.href = '/login'; return }; if (r.ok) setData(await r.json()) } catch {} setLoading(false) }
  async function fetchSales() { setSalesLoading(true); try { const r = await fetch(`/api/vendor/sales?period=${salesPeriod}`); if (r.ok) setSalesData(await r.json()) } catch {} setSalesLoading(false) }
  async function fetchCreditCustomers() {
    setCreditLoading(true)
    try {
      const url = showAllCustomers ? '/api/vendor/customers?credit=true&all=true' : '/api/vendor/customers?credit=true'
      const r = await fetch(url)
      if (r.ok) {
        const j = await r.json()
        if (showAllCustomers) {
          setCreditCustomers(j.customers || [])
        } else {
          setCreditCustomers((j.customers || []).filter((c: any) => c.credit?.balance > 0 || c.advance > 0))
        }
      }
    } catch {}
    setCreditLoading(false)
  }

  async function registerCustomer() {
    if (!newCustomer.name.trim()) { showToast('Customer name required'); return }
    setAddCustomerLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', name: newCustomer.name, phone: newCustomer.phone,
          whatsapp: newCustomer.whatsapp || newCustomer.phone, email: newCustomer.email,
          address: newCustomer.address, notes: newCustomer.notes,
          advance_balance: newCustomer.advance ? parseFloat(newCustomer.advance) : 0,
        })
      })
      const j = await r.json()
      if (j.success) {
        // If opening credit amount, create a dummy sale to represent past debt
        if (newCustomer.credit && parseFloat(newCustomer.credit) > 0) {
          await fetch('/api/vendor/sales', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'create_sale', customerId: j.customer.id,
              items: [{ productId: null, productName: 'Opening Balance (Past Transactions)', productSku: 'OPENING-BAL', unitPrice: parseFloat(newCustomer.credit), quantity: 1 }],
              payments: [], notes: 'Opening credit balance from past transactions',
              skipStock: true,
            })
          })
        }
        showToast('Customer registered!')
        setNewCustomer({ name: '', phone: '', whatsapp: '', email: '', address: '', notes: '', advance: '', credit: '' })
        setShowAddCustomer(false)
        fetchCreditCustomers()
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setAddCustomerLoading(false)
  }

  async function adjustAdvance(customerId: string, type: 'add' | 'refund') {
    const amount = parseFloat(adjustAdvanceAmount)
    if (!amount || amount <= 0) { showToast('Enter a valid amount'); return }
    setEditCustomerLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: type === 'add' ? 'add_advance' : 'refund_advance', customerId, amount, paymentMethod: 'cash', notes: 'Manual adjustment' })
      })
      const j = await r.json()
      if (j.success) {
        showToast(type === 'add' ? 'Advance added!' : 'Advance refunded!')
        setAdjustAdvanceAmount('')
        fetchCreditCustomers()
        if (editingCustomer) setEditingCustomer({ ...editingCustomer, advance_balance: j.advance || (editingCustomer.advance_balance + (type === 'add' ? amount : -amount)) })
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setEditCustomerLoading(false)
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }
  async function handleSignOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = '/' }

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
    if (!confirm(`Delete ${selectedProducts.size} product${selectedProducts.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    try {
      const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk_delete', productIds: [...selectedProducts] }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); setSelectedProducts(new Set()); await fetchData() }
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
  async function handleAddProduct(e: React.FormEvent) { e.preventDefault(); if (!newProduct.name.trim()) { showToast('Name required'); return }; setAddLoading(true); const partId = newProduct.partId.trim() || generatePartId(); try { const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', data: { ...newProduct, sku: partId } }) }); const j = await r.json(); if (j.success && j.product) { if (productImages.length > 0) { showToast('Uploading images...'); await uploadImagesForProduct(j.product.id, productImages) }; showToast('Product added!'); setNewProduct({ partId:'', name:'', description:'', category:'Other', make:'', model:'', modelCode:'', year:'', condition:'Reconditioned', side:'', color:'', oemCode:'', cost:'', price:'', quantity:'1', show_price:true }); setProductImages([]); setImagePreviews([]); await fetchData(); setTab('products') } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setAddLoading(false) }
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
        products: importData.map(row => ({ sku: row.partId, added_date: row.addedDate || '', name: row.name, description: row.description, category: row.category, make: row.make, model: row.model, model_code: row.modelCode || null, year: row.year, condition: row.condition, side: row.side || null, color: row.color || null, oem_code: row.oemCode || null, cost: row.cost ? parseInt(row.cost) : null, price: row.price, quantity: row.quantity, show_price: row.show_price }))
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

  // POS - Customer search
  async function searchCustomers(query: string) {
    if (query.length < 2) { setCustomerSuggestions([]); return }
    try { const r = await fetch(`/api/vendor/customers?search=${encodeURIComponent(query)}`); if (r.ok) { const j = await r.json(); setCustomerSuggestions(j.customers || []) } } catch {}
  }

  function selectCustomer(customer: any) {
    const advance = parseFloat(customer.advance_balance || 0)
    setPosCustomer({ id: customer.id, name: customer.name, phone: customer.phone || '', advance, outstanding: 0 })
    setCustomerSuggestions([])
    if (advance > 0) setUseAdvance(true)
    // Fetch outstanding
    fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_outstanding', customerId: customer.id }) })
      .then(r => r.json()).then(j => {
        const outstanding = (j.sales || []).reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)
        setPosCustomer((prev: any) => ({ ...prev, outstanding }))
      }).catch(() => {})
  }

  function addToCart(product: any) {
    setPosCart(prev => { const ex = prev.find(i => i.productId === product.id); if (ex) return prev.map(i => i.productId === product.id ? { ...i, quantity: Math.min(i.quantity + 1, product.quantity) } : i); return [...prev, { productId: product.id, productName: product.name, productSku: product.sku, unitPrice: product.price || 0, quantity: 1, maxStock: product.quantity }] })
    setPosSearch('')
  }
  function updateCartQty(i: number, q: number) { setPosCart(p => p.map((item, x) => x === i ? { ...item, quantity: Math.max(1, Math.min(q, item.maxStock)) } : item)) }
  function updateCartPrice(i: number, price: number) { setPosCart(p => p.map((item, x) => x === i ? { ...item, unitPrice: price } : item)) }
  function removeFromCart(i: number) { setPosCart(p => p.filter((_, x) => x !== i)) }

  // Payment lines
  function addPaymentLine() { setPosPayments(p => [...p, { method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]) }
  function updatePaymentLine(i: number, field: string, value: string) { setPosPayments(p => p.map((line, x) => x === i ? { ...line, [field]: value } : line)) }
  function removePaymentLine(i: number) { setPosPayments(p => p.filter((_, x) => x !== i)) }

  const posSubtotal = posCart.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const posDiscountAmt = parseFloat(posDiscount) || 0
  const posTotal = Math.max(0, posSubtotal - posDiscountAmt)
  const posPaidAmount = posPayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)
  const posAdvanceApplied = useAdvance && posCustomer.advance > 0 ? Math.min(posCustomer.advance, Math.max(0, posTotal - posPaidAmount)) : 0
  const posTotalPaid = posPaidAmount + posAdvanceApplied
  const posBalance = Math.max(0, posTotal - posTotalPaid)
  const posOverpayment = Math.max(0, posTotalPaid - posTotal)

  async function handleCreateSale() {
    if (posCart.length === 0) { showToast('Add items'); return }
    const errors: { name?: boolean; phone?: boolean } = {}
    if (!posCustomer.name.trim()) errors.name = true
    if (!posCustomer.phone.trim()) errors.phone = true
    if (errors.name || errors.phone) { setPosErrors(errors); setTimeout(() => setPosErrors({}), 3000); return }
    setPosErrors({})
    setPosLoading(true)
    try {
      const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'create_sale', customerId: posCustomer.id, customerName: posCustomer.name || 'Walk-in Customer', customerPhone: posCustomer.phone,
        items: posCart.map(i => ({ productId: i.productId, productName: i.productName, productSku: i.productSku, quantity: i.quantity, unitPrice: i.unitPrice })),
        discount: posDiscountAmt, payments: posPayments.filter(p => parseFloat(p.amount) > 0), notes: posNotes || null, useAdvance, saleDate: posDate, vehicleNo: posVehicleNo || null,
      }) })
      const j = await r.json()
      if (j.success) { setPosReceipt({ sale: j.sale, vendor: data?.vendor, advanceUsed: j.advanceUsed, appliedToOutstanding: j.appliedToOutstanding, settledInvoices: j.settledInvoices, newAdvance: j.newAdvance }); showToast(j.message); setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0 }); setPosDiscount(''); setPosPayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]); setPosNotes(''); setPosDate(new Date().toISOString().split('T')[0]); setPosVehicleNo(''); setUseAdvance(false); await fetchData() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setPosLoading(false)
  }

  // Credit settlement
  async function loadOutstanding(customer: any) {
    setSelectedCreditCustomer(customer); setOutstandingSales([])
    try { const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_outstanding', customerId: customer.id }) }); if (r.ok) { const j = await r.json(); setOutstandingSales(j.sales || []) } } catch {}
  }

  async function handleSettle() {
    if (!settleSale) return; const totalPay = settlePayments.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0); if (totalPay <= 0) { showToast('Enter payment amount'); return }
    setSettleLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'settle_credit', customerId: selectedCreditCustomer.id, saleId: settleSale.id,
        payments: settlePayments.filter(p => parseFloat(p.amount) > 0),
      }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); setSettleSale(null); setSettlePayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]); await loadOutstanding(selectedCreditCustomer); await fetchCreditCustomers() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setSettleLoading(false)
  }

  async function handleReturn(refundMethod: 'advance' | 'cash') {
    if (!returnModal) return
    const items = Object.entries(returnItems).filter(([, qty]) => qty > 0).map(([saleItemId, quantity]) => ({ saleItemId, quantity }))
    if (items.length === 0) { showToast('Select items to return'); return }
    setReturnLoading(true)
    try {
      const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'return_items', saleId: returnModal.id, returnItems: items, refundMethod }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); setReturnModal(null); setReturnItems({}); fetchSales(); fetchData() }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setReturnLoading(false)
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

  async function handleEditCustomer() {
    if (!editingCustomer) return
    setEditCustomerLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'update', customerId: editingCustomer.id,
        data: { name: editingCustomer.name, phone: editingCustomer.phone, whatsapp: editingCustomer.whatsapp, email: editingCustomer.email, address: editingCustomer.address, notes: editingCustomer.notes },
      }) })
      const j = await r.json()
      if (j.success) { showToast('Customer updated'); setEditingCustomer(null); fetchCreditCustomers(); if (selectedCreditCustomer?.id === editingCustomer.id) setSelectedCreditCustomer({ ...selectedCreditCustomer, ...editingCustomer }) }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setEditCustomerLoading(false)
  }

  async function handleAutoOffset(customerId: string) {
    if (!confirm('Apply advance balance against outstanding invoices (oldest first)?')) return
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'auto_offset', customerId }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); fetchCreditCustomers(); if (selectedCreditCustomer?.id === customerId) loadOutstanding(selectedCreditCustomer) }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
  }

  const [bulkSettleMode, setBulkSettleMode] = useState(false)
  const [bulkSettlePayments, setBulkSettlePayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [bulkSettleLoading, setBulkSettleLoading] = useState(false)

  async function handleBulkSettle() {
    if (!selectedCreditCustomer) return
    const totalPay = bulkSettlePayments.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
    if (totalPay <= 0) { showToast('Enter payment amount'); return }
    setBulkSettleLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'bulk_settle', customerId: selectedCreditCustomer.id,
        payments: bulkSettlePayments.filter((p: any) => parseFloat(p.amount) > 0),
      }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); setBulkSettleMode(false); setBulkSettlePayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]); fetchCreditCustomers(); loadOutstanding(selectedCreditCustomer) }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setBulkSettleLoading(false)
  }

  function printCreditReport(customer: any, sales: any[], vendorInfo: any) {
    const totalDue = sales.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Report - ${customer.name}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 14px; color: #333; max-width: 800px; margin: 0 auto; }
  .header { text-align: center; padding: 20px 0; border-bottom: 3px solid #f97316; margin-bottom: 20px; }
  .shop-name { font-size: 24px; font-weight: 900; }
  .report-title { font-size: 18px; font-weight: 700; color: #dc2626; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px; }
  .customer-info { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; margin-bottom: 20px; }
  .customer-info h3 { font-size: 12px; color: #94a3b8; text-transform: uppercase; margin-bottom: 8px; }
  .customer-info p { font-size: 14px; margin: 3px 0; }
  .customer-name { font-size: 18px; font-weight: 800; }
  table { width: 100%; border-collapse: collapse; margin: 15px 0; }
  th { background: #f1f5f9; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 10px 8px; border-bottom: 2px solid #e2e8f0; }
  td { padding: 10px 8px; font-size: 13px; border-bottom: 1px solid #f1f5f9; }
  .text-right { text-align: right; }
  .amount-due { color: #dc2626; font-weight: 800; }
  .amount-paid { color: #16a34a; }
  .total-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 15px; margin-top: 20px; display: flex; justify-content: space-between; align-items: center; }
  .total-label { font-size: 16px; font-weight: 700; color: #dc2626; }
  .total-amount { font-size: 28px; font-weight: 900; color: #dc2626; }
  .footer { text-align: center; padding: 20px 0; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0; margin-top: 30px; }
  .date-generated { font-size: 11px; color: #94a3b8; text-align: right; margin-bottom: 15px; }
  .advance-box { background: #ecfdf5; border: 2px solid #10b981; border-radius: 8px; padding: 12px; margin-top: 10px; display: flex; justify-content: space-between; align-items: center; }
  .advance-label { font-size: 14px; font-weight: 700; color: #059669; }
  .advance-amount { font-size: 20px; font-weight: 900; color: #059669; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <div class="shop-name">${vendorInfo?.name || 'kuruma.lk'}</div>
  ${vendorInfo?.location ? `<div style="font-size:12px;color:#666">${vendorInfo.location} ${vendorInfo?.phone ? '| Tel: ' + vendorInfo.phone : ''}</div>` : ''}
  <div class="report-title">Credit Statement</div>
</div>
<div class="date-generated">Generated: ${new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
<div class="customer-info">
  <h3>Customer Details</h3>
  <p class="customer-name">${customer.name}</p>
  ${customer.phone ? `<p>Phone: ${customer.phone}</p>` : ''}
  ${customer.email ? `<p>Email: ${customer.email}</p>` : ''}
  ${customer.address ? `<p>Address: ${customer.address}</p>` : ''}
</div>
${sales.length > 0 ? `
<table>
  <thead><tr><th>Invoice #</th><th>Date</th><th>Items</th><th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Balance Due</th></tr></thead>
  <tbody>
    ${sales.map((s: any) => `<tr>
      <td><strong>${s.invoice_no}</strong></td>
      <td>${formatDateShort(s.created_at)}</td>
      <td style="font-size:11px;color:#666">${(s.items || []).map((i: any) => i.product_name).join(', ')}</td>
      <td class="text-right">Rs.${parseFloat(s.total).toLocaleString()}</td>
      <td class="text-right amount-paid">Rs.${parseFloat(s.paid_amount).toLocaleString()}</td>
      <td class="text-right amount-due">Rs.${parseFloat(s.balance_due).toLocaleString()}</td>
    </tr>`).join('')}
  </tbody>
</table>
` : '<p style="text-align:center;color:#94a3b8;padding:20px">No outstanding invoices</p>'}
<div class="total-box"><span class="total-label">TOTAL OUTSTANDING</span><span class="total-amount">Rs. ${totalDue.toLocaleString()}</span></div>
${parseFloat(customer.advance_balance || 0) > 0 ? `<div class="advance-box"><span class="advance-label">ADVANCE BALANCE</span><span class="advance-amount">Rs. ${parseFloat(customer.advance_balance || 0).toLocaleString()}</span></div>` : ''}
<div class="footer">
  <p>This is a computer-generated statement. Please settle outstanding amounts at your earliest convenience.</p>
  <p style="margin-top:5px">Contact: ${vendorInfo?.phone || ''} ${vendorInfo?.whatsapp ? '| WhatsApp: ' + vendorInfo.whatsapp : ''}</p>
  <p style="margin-top:8px;font-weight:700">Powered by kuruma.lk</p>
</div>
</body></html>`
    const win = window.open('', '_blank', 'width=850,height=700')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
  }

  function sendWhatsAppCreditReport(customer: any, sales: any[], vendorInfo: any) {
    const totalDue = sales.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)
    const rawPhone = customer.whatsapp || customer.phone
    if (!rawPhone) { showToast('No phone number for this customer'); return }
    const phone = toWhatsAppNumber(rawPhone)

    let msg = `*CREDIT STATEMENT*%0A${vendorInfo?.name || 'kuruma.lk'}%0ADate: ${new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })}%0A%0ADear ${customer.name},%0A%0AHere is your outstanding balance:%0A`
    sales.forEach((s: any) => {
      msg += `%0A📋 *${s.invoice_no}* (${formatDateShort(s.created_at)})%0A`
      msg += `   Total: Rs.${parseFloat(s.total).toLocaleString()} | Paid: Rs.${parseFloat(s.paid_amount).toLocaleString()}%0A`
      msg += `   *Due: Rs.${parseFloat(s.balance_due).toLocaleString()}*%0A`
    })
    msg += `%0A━━━━━━━━━━━━━━━━%0A*TOTAL OUTSTANDING: Rs.${totalDue.toLocaleString()}*%0A`
    if (parseFloat(customer.advance_balance || 0) > 0) msg += `Advance Balance: Rs.${parseFloat(customer.advance_balance || 0).toLocaleString()}%0A`
    msg += `%0APlease settle at your earliest convenience.%0AThank you! - ${vendorInfo?.name || 'kuruma.lk'}`

    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank')
  }

  // ─── REPORT GENERATORS ───
  function generateDailyReport(salesList: any[], vendorInfo: any, reportDate: string, settings?: any) {
    // 7:30 PM cutoff: sales after 19:30 go to next day
    const cutoffHour = 19, cutoffMin = 30
    const filtered = salesList.filter((s: any) => {
      if (s.payment_status === 'voided') return false
      const d = new Date(s.created_at)
      const saleDate = d.getHours() > cutoffHour || (d.getHours() === cutoffHour && d.getMinutes() >= cutoffMin)
        ? new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
        : d.toISOString().slice(0, 10)
      return saleDate === reportDate
    })

    const totalSales = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.total || 0), 0)
    const totalPaid = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.paid_amount || 0), 0)
    const totalCredit = filtered.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)

    // Payment method breakdown from actual payments
    const methodTotals: Record<string, number> = { cash: 0, cheque: 0, bank: 0, card: 0, advance: 0 }
    filtered.forEach((sale: any) => {
      if (sale.payments && sale.payments.length > 0) {
        sale.payments.forEach((p: any) => {
          const method = p.payment_method || 'cash'
          methodTotals[method] = (methodTotals[method] || 0) + parseFloat(p.amount || 0)
        })
      } else if (parseFloat(sale.paid_amount || 0) > 0) {
        // Fallback: use sale-level payment_method
        const method = sale.payment_method || 'cash'
        methodTotals[method] = (methodTotals[method] || 0) + parseFloat(sale.paid_amount || 0)
      }
    })

    const shopName = settings?.invoice_title || vendorInfo?.name || 'kuruma.lk'
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
<div class="header"><div class="shop">${shopName}</div>${vendorInfo?.location ? '<div style="font-size:12px;color:#666">' + vendorInfo.location + (vendorInfo?.phone ? ' | Tel: ' + vendorInfo.phone : '') + '</div>' : ''}<div class="report-title">Daily Sales Report</div><div class="date">${dateStr}</div><div style="font-size:10px;color:#999;margin-top:4px">Business day: 7:30 PM previous day to 7:30 PM</div></div>

<div class="summary">
<div class="summary-box"><div class="val orange">Rs.${totalSales.toLocaleString()}</div><div class="lbl">Total Sales</div></div>
<div class="summary-box"><div class="val green">Rs.${totalPaid.toLocaleString()}</div><div class="lbl">Collected</div></div>
<div class="summary-box"><div class="val red">Rs.${totalCredit.toLocaleString()}</div><div class="lbl">On Credit</div></div>
<div class="summary-box"><div class="val blue">${filtered.length}</div><div class="lbl">Invoices</div></div>
</div>

<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Payment Methods</h3>
<div class="method-grid">
${methodTotals.cash > 0 ? '<div class="method-box"><div class="val green">Rs.' + methodTotals.cash.toLocaleString() + '</div><div class="lbl">💵 Cash</div></div>' : ''}
${methodTotals.cheque > 0 ? '<div class="method-box"><div class="val blue">Rs.' + methodTotals.cheque.toLocaleString() + '</div><div class="lbl">📝 Cheque</div></div>' : ''}
${methodTotals.bank > 0 ? '<div class="method-box"><div class="val" style="color:#7c3aed">Rs.' + methodTotals.bank.toLocaleString() + '</div><div class="lbl">🏦 Bank Transfer</div></div>' : ''}
${methodTotals.card > 0 ? '<div class="method-box"><div class="val" style="color:#0891b2">Rs.' + methodTotals.card.toLocaleString() + '</div><div class="lbl">💳 Card</div></div>' : ''}
${methodTotals.advance > 0 ? '<div class="method-box"><div class="val" style="color:#059669">Rs.' + methodTotals.advance.toLocaleString() + '</div><div class="lbl">💰 From Advance</div></div>' : ''}
</div>

<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Transactions (${filtered.length})</h3>
<table><thead><tr><th>Invoice</th><th>Customer</th><th>Items</th><th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Due</th></tr></thead><tbody>
${filtered.map((s: any) => '<tr><td><strong>' + s.invoice_no + '</strong></td><td>' + (s.customer_name || 'Walk-in') + '</td><td style="font-size:11px;color:#666">' + (s.items || []).map((i: any) => i.product_name).join(', ') + '</td><td class="text-right">Rs.' + parseFloat(s.total).toLocaleString() + '</td><td class="text-right" style="color:#16a34a">Rs.' + parseFloat(s.paid_amount || 0).toLocaleString() + '</td><td class="text-right" style="color:' + (parseFloat(s.balance_due || 0) > 0 ? '#dc2626;font-weight:700' : '#94a3b8') + '">Rs.' + parseFloat(s.balance_due || 0).toLocaleString() + '</td></tr>').join('')}
</tbody></table>

<div class="footer"><p>Generated: ${new Date().toLocaleString('en-LK')}</p><p style="margin-top:4px;font-weight:700">Powered by kuruma.lk</p></div></body></html>`

    const win = window.open('', '_blank', 'width=850,height=700')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
  }

  function generatePeriodReport(salesList: any[], vendorInfo: any, fromDate: string, toDate: string, settings?: any) {
    const filtered = salesList.filter((s: any) => s.payment_status !== 'voided')
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
        const method = sale.payment_method || 'cash'
        methodTotals[method] = (methodTotals[method] || 0) + parseFloat(sale.paid_amount || 0)
      }
    })

    // Customer-wise credit breakdown
    const customerCredit: Record<string, { name: string; phone: string; total: number; paid: number; due: number; invoices: number }> = {}
    filtered.forEach((s: any) => {
      const due = parseFloat(s.balance_due || 0)
      if (due <= 0) return
      const id = s.customer_id || 'walkin'
      const name = s.customer_name || 'Walk-in'
      if (!customerCredit[id]) customerCredit[id] = { name, phone: s.customer_phone || '', total: 0, paid: 0, due: 0, invoices: 0 }
      customerCredit[id].total += parseFloat(s.total || 0)
      customerCredit[id].paid += parseFloat(s.paid_amount || 0)
      customerCredit[id].due += due
      customerCredit[id].invoices++
    })
    const creditList = Object.values(customerCredit).sort((a, b) => b.due - a.due)

    // Also include customers with advance balance from the sales data
    const customerAdvances: Record<string, { name: string; phone: string; advance: number }> = {}
    filtered.forEach((s: any) => {
      if (s.payments) {
        s.payments.forEach((p: any) => {
          if (p.payment_method === 'advance' && s.customer_id) {
            const id = s.customer_id
            if (!customerAdvances[id]) customerAdvances[id] = { name: s.customer_name || 'Unknown', phone: s.customer_phone || '', advance: 0 }
            customerAdvances[id].advance += parseFloat(p.amount || 0)
          }
        })
      }
    })
    const advanceList = Object.values(customerAdvances).filter(c => c.advance > 0).sort((a, b) => b.advance - a.advance)

    const shopName = settings?.invoice_title || vendorInfo?.name || 'kuruma.lk'
    const fromStr = new Date(fromDate).toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })
    const toStr = new Date(toDate).toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Sales Report ${fromDate} to ${toDate}</title>
<style>@page{size:A4;margin:15mm}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;font-size:13px;color:#333;max-width:800px;margin:0 auto}
.header{text-align:center;padding:20px 0;border-bottom:3px solid #ff6b35}.shop{font-size:24px;font-weight:900}.date{font-size:14px;color:#666;margin-top:4px}.report-title{font-size:18px;font-weight:800;color:#ff6b35;margin-top:8px;text-transform:uppercase;letter-spacing:1px}
.summary{display:flex;gap:12px;margin:20px 0;flex-wrap:wrap}.summary-box{flex:1;min-width:120px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:15px;text-align:center}.summary-box .val{font-size:22px;font-weight:900}.summary-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.green{color:#16a34a}.red{color:#dc2626}.orange{color:#ff6b35}.blue{color:#2563eb}
table{width:100%;border-collapse:collapse;margin:15px 0}th{background:#f1f5f9;text-align:left;font-size:11px;font-weight:700;padding:10px 8px;border-bottom:2px solid #e2e8f0;text-transform:uppercase}td{padding:10px 8px;font-size:12px;border-bottom:1px solid #f1f5f9}.text-right{text-align:right}
.method-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:15px 0}.method-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;text-align:center}.method-box .val{font-size:18px;font-weight:900}.method-box .lbl{font-size:10px;color:#94a3b8;text-transform:uppercase;margin-top:2px}
.credit-section{margin-top:20px;page-break-before:auto}.credit-box{background:#fef2f2;border:2px solid #fecaca;border-radius:8px;padding:12px 15px;margin-bottom:8px}
.footer{text-align:center;padding:20px 0;color:#94a3b8;font-size:10px;border-top:1px solid #e2e8f0;margin-top:20px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div class="header"><div class="shop">${shopName}</div>${vendorInfo?.location ? '<div style="font-size:12px;color:#666">' + vendorInfo.location + (vendorInfo?.phone ? ' | Tel: ' + vendorInfo.phone : '') + '</div>' : ''}<div class="report-title">Sales Report</div><div class="date">${fromStr} — ${toStr}</div></div>

<div class="summary">
<div class="summary-box"><div class="val orange">Rs.${totalSales.toLocaleString()}</div><div class="lbl">Total Sales</div></div>
<div class="summary-box"><div class="val green">Rs.${totalPaid.toLocaleString()}</div><div class="lbl">Collected</div></div>
<div class="summary-box"><div class="val red">Rs.${totalCredit.toLocaleString()}</div><div class="lbl">On Credit</div></div>
<div class="summary-box"><div class="val blue">${filtered.length}</div><div class="lbl">Invoices</div></div>
</div>

<h3 style="font-size:13px;font-weight:800;color:#64748b;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Payment Methods</h3>
<div class="method-grid">
${methodTotals.cash > 0 ? '<div class="method-box"><div class="val green">Rs.' + methodTotals.cash.toLocaleString() + '</div><div class="lbl">💵 Cash</div></div>' : ''}
${methodTotals.cheque > 0 ? '<div class="method-box"><div class="val blue">Rs.' + methodTotals.cheque.toLocaleString() + '</div><div class="lbl">📝 Cheque</div></div>' : ''}
${methodTotals.bank > 0 ? '<div class="method-box"><div class="val" style="color:#7c3aed">Rs.' + methodTotals.bank.toLocaleString() + '</div><div class="lbl">🏦 Bank Transfer</div></div>' : ''}
${methodTotals.card > 0 ? '<div class="method-box"><div class="val" style="color:#0891b2">Rs.' + methodTotals.card.toLocaleString() + '</div><div class="lbl">💳 Card</div></div>' : ''}
${methodTotals.advance > 0 ? '<div class="method-box"><div class="val" style="color:#059669">Rs.' + methodTotals.advance.toLocaleString() + '</div><div class="lbl">💰 From Advance</div></div>' : ''}
</div>

${creditList.length > 0 ? '<div class="credit-section"><h3 style="font-size:13px;font-weight:800;color:#dc2626;margin:15px 0 8px;text-transform:uppercase;letter-spacing:1px">Customer Credit Details (Rs.' + totalCredit.toLocaleString() + ' outstanding)</h3><table><thead><tr><th>Customer</th><th>Phone</th><th class="text-right">Total Sales</th><th class="text-right">Paid</th><th class="text-right">Outstanding</th><th class="text-right">Invoices</th></tr></thead><tbody>' + creditList.map(c => '<tr><td><strong>' + c.name + '</strong></td><td style="font-size:11px">' + c.phone + '</td><td class="text-right">Rs.' + c.total.toLocaleString() + '</td><td class="text-right" style="color:#16a34a">Rs.' + c.paid.toLocaleString() + '</td><td class="text-right" style="color:#dc2626;font-weight:700">Rs.' + c.due.toLocaleString() + '</td><td class="text-right">' + c.invoices + '</td></tr>').join('') + '</tbody></table></div>' : ''}

<div class="footer"><p>Generated: ${new Date().toLocaleString('en-LK')}</p><p style="margin-top:4px;font-weight:700">Powered by kuruma.lk</p></div></body></html>`

    const win = window.open('', '_blank', 'width=850,height=700')
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
  }

  function whatsAppDailyReport(salesList: any[], vendorInfo: any, reportDate: string, toPhone?: string) {
    const cutoffHour = 19, cutoffMin = 30
    const filtered = salesList.filter((s: any) => {
      if (s.payment_status === 'voided') return false
      const d = new Date(s.created_at)
      const saleDate = d.getHours() > cutoffHour || (d.getHours() === cutoffHour && d.getMinutes() >= cutoffMin)
        ? new Date(d.getTime() + 86400000).toISOString().slice(0, 10)
        : d.toISOString().slice(0, 10)
      return saleDate === reportDate
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

  // ── End of Day Report ───────────────────────────────────────────────────
  async function sendEODReport() {
    showToast('Fetching today\'s sales...')
    try {
      const r = await fetch('/api/vendor/sales?period=today')
      const j = await r.json()
      const sales = j.sales || []
      const vendor = j.vendor || data?.vendor
      if (!sales.length) { showToast('No sales today yet'); return }
      const phone = vendor?.whatsapp || vendor?.phone
      if (!phone) { showToast('No manager phone set'); return }
      whatsAppDailyReport(sales, vendor, new Date().toISOString().slice(0, 10), phone)
    } catch { showToast('Failed to fetch sales') }
  }

  // ── Sales Summary PDF ───────────────────────────────────────────────────
  async function handleExportSummaryPDF() {
    if (!exportFrom || !exportTo) { showToast('Please select both dates'); return }
    setExportLoading(true)
    try {
      const r = await fetch(`/api/vendor/sales?from=${exportFrom}&to=${exportTo}`)
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

      const rows = sales.map((s: any) => `
        <tr>
          <td>${new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
          <td class="mono">${s.invoice_no}</td>
          <td>${s.customer?.name || s.customer_name || 'Walk-in'}</td>
          <td>${s.customer?.phone || s.customer_phone || ''}</td>
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
          <div class="shop-name">${vendor?.name || 'kuruma.lk'}</div>
          <div class="shop-sub">${vendor?.location || ''}${vendor?.phone ? ' | ' + vendor.phone : ''}</div>
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
      const j = await r.json()
      const sales = (j.sales || []).filter((s: any) => s.payment_status !== 'voided')
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

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!data) return null
  const { vendor, products, stats } = data
  const filteredProducts = products.filter((p: any) => {
    const s = productSearch.toLowerCase()
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
  const posFilteredProducts = products.filter((p: any) => { if (!posSearch || posSearch.length < 2) return false; const s = posSearch.toLowerCase(); return (p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.make || '').toLowerCase().includes(s)) && p.quantity > 0 })

  // Payment lines are rendered inline to avoid focus loss

  return (
    <div className="min-h-screen bg-slate-50">
      {toast && <div className="fixed top-4 right-4 z-[100] bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold max-w-sm">{toast}</div>}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-50"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-3"><a href="/" className="text-xl font-black text-orange-500">kuruma.lk</a><span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">VENDOR</span><span className="text-sm font-semibold text-slate-600 hidden sm:inline">{vendor.name}</span></div><div className="flex items-center gap-3"><a href="/" className="text-sm text-slate-400 hover:text-slate-600">View Store</a><button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-600 font-semibold">Log Out</button></div></div></header>

      <div className="bg-white border-b border-slate-200"><div className="max-w-7xl mx-auto px-2 sm:px-4 flex gap-0 overflow-x-auto scrollbar-hide" style={{WebkitOverflowScrolling:'touch'}}>
        {([{key:'overview' as VendorTab,l:'Overview'},{key:'products' as VendorTab,l:'Products'},{key:'add' as VendorTab,l:'+ Add'},{key:'bulk' as VendorTab,l:'Bulk'},{key:'pos' as VendorTab,l:'POS'},{key:'sales' as VendorTab,l:'Sales'},{key:'credit' as VendorTab,l:'Credit'},{key:'settings' as VendorTab,l:'⚙️'}])
        .filter((t) => staffRole === 'cashier' ? t.key === 'pos' : true).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-2.5 sm:px-4 py-3.5 text-xs sm:text-sm font-bold border-b-2 transition whitespace-nowrap ${tab === t.key ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>{t.l}</button>
        ))}
      </div></div>

      <main className="max-w-7xl mx-auto px-4 py-6">

        {/* OVERVIEW */}
        {tab === 'overview' && (<div>
          <h1 className="text-2xl font-black text-slate-900 mb-6">Dashboard</h1>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-orange-500">{stats.totalProducts}</p><p className="text-xs text-slate-400 mt-1">Products</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-emerald-500">{stats.activeProducts}</p><p className="text-xs text-slate-400 mt-1">Active</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-blue-500">{stats.totalStock}</p><p className="text-xs text-slate-400 mt-1">Stock</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-purple-500">Rs.{stats.stockValue.toLocaleString()}</p><p className="text-xs text-slate-400 mt-1">Stock Value</p></div>
            <div className="bg-white rounded-xl border border-slate-200 p-4"><p className="text-2xl font-black text-green-600">Rs.{stats.totalSales.toLocaleString()}</p><p className="text-xs text-slate-400 mt-1">Sales</p></div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5"><h3 className="font-bold text-slate-900 mb-3">Quick Actions</h3><div className="space-y-2">
              <button onClick={() => setTab('pos')} className="w-full text-left px-4 py-3 rounded-lg bg-green-50 hover:bg-green-100 text-green-700 font-semibold text-sm">🧾 Open POS</button>
              <button onClick={() => setTab('credit')} className="w-full text-left px-4 py-3 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-700 font-semibold text-sm">💳 Credit & Settlements</button>
              <button onClick={() => setTab('add')} className="w-full text-left px-4 py-3 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-700 font-semibold text-sm">+ Add Product</button>
              <button onClick={() => setTab('sales')} className="w-full text-left px-4 py-3 rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 font-semibold text-sm">📊 Sales History</button>
            </div></div>
            <div className="bg-white rounded-xl border border-slate-200 p-5"><h3 className="font-bold text-slate-900 mb-3">Shop Info</h3><div className="space-y-2 text-sm">
              <p><span className="text-slate-400">Name:</span> <span className="font-semibold">{vendor.name}</span></p>
              <p><span className="text-slate-400">Phone:</span> <span className="font-semibold">{vendor.phone}</span></p>
              <p><span className="text-slate-400">Location:</span> <span className="font-semibold">{vendor.location}</span></p>
              <p><span className="text-slate-400">Status:</span> <span className={'font-bold ' + (vendor.status === 'approved' ? 'text-emerald-600' : 'text-amber-600')}>{vendor.status.toUpperCase()}</span></p>
            </div></div>
          </div>
        </div>)}

        {/* PRODUCTS */}
        {tab === 'products' && (<div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3"><h1 className="text-2xl font-black text-slate-900">Products</h1><div className="flex gap-2"><button onClick={() => setTab('add')} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg">+ Add</button></div></div>
          {/* Feature 3: Selection toolbar */}
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <input type="text" placeholder="Search..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 w-56" />
              <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-500"><input type="checkbox" checked={showSoldOut} onChange={e => setShowSoldOut(e.target.checked)} className="w-3.5 h-3.5 accent-orange-500" />Show Sold Out</label>
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
                  const products = (data?.products || []).filter((p: any) => selectedProducts.has(p.id) && p.quantity > 0)
                  if (!products.length) { showToast('No in-stock products selected'); return }
                  products.forEach((p: any) => addToCart(p))
                  setSelectedProducts(new Set())
                  setTab('pos')
                  showToast(`${products.length} item${products.length > 1 ? 's' : ''} added to POS`)
                }} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5">🛒 Send to POS ({selectedProducts.size})</button>
                <button onClick={deleteSelectedProducts} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-1.5">🗑️ Delete {selectedProducts.size}</button>
              </>)}
            </div>
          </div>
          {editingProduct && (<div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setEditingProduct(null)}><div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}><h3 className="text-lg font-bold mb-4">Edit Product</h3><div className="space-y-3"><div className="bg-blue-50 border border-blue-200 rounded-lg p-3"><label className="block text-xs font-bold text-blue-800 mb-1">Part ID</label><input value={editingProduct.sku || ''} onChange={e => setEditingProduct({...editingProduct, sku: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-blue-200 text-sm outline-none font-mono font-bold bg-white" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Name</label><input value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Description</label><textarea value={editingProduct.description || ''} onChange={e => setEditingProduct({...editingProduct, description: e.target.value})} rows={2} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none resize-none" /></div><div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Category</label><select value={editingProduct.category} onChange={e => setEditingProduct({...editingProduct, category: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Condition</label><select value={editingProduct.condition} onChange={e => setEditingProduct({...editingProduct, condition: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div></div><div className="grid grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Make</label><input value={editingProduct.make || ''} onChange={e => setEditingProduct({...editingProduct, make: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Toyota" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Model</label><input value={editingProduct.model || ''} onChange={e => setEditingProduct({...editingProduct, model: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Year</label><input value={editingProduct.year || ''} onChange={e => setEditingProduct({...editingProduct, year: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div><div className="grid grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Model Code</label><input value={editingProduct.model_code || ''} onChange={e => setEditingProduct({...editingProduct, model_code: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="ZRE172" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Side</label><select value={editingProduct.side || ''} onChange={e => setEditingProduct({...editingProduct, side: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none"><option value="">Any</option><option>Front</option><option>Rear</option><option>Left</option><option>Right</option><option>Front Left</option><option>Front Right</option><option>Rear Left</option><option>Rear Right</option></select></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Color</label><input value={editingProduct.color || ''} onChange={e => setEditingProduct({...editingProduct, color: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Black" /></div></div><div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">OEM Code</label><input value={editingProduct.oem_code || ''} onChange={e => setEditingProduct({...editingProduct, oem_code: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none font-mono" placeholder="A12345" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Cost (Rs.)</label><input type="number" value={editingProduct.cost || ''} onChange={e => setEditingProduct({...editingProduct, cost: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Internal cost" /></div></div><div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Price (Rs.)</label><input type="number" value={editingProduct.price || ''} onChange={e => setEditingProduct({...editingProduct, price: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Qty</label><input type="number" value={editingProduct.quantity} onChange={e => setEditingProduct({...editingProduct, quantity: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div><div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3"><div><p className="text-xs font-semibold text-slate-700">Show Price Publicly</p><p className="text-[11px] text-slate-400 mt-0.5">Customers will see the price on the listing</p></div><button type="button" onClick={() => setEditingProduct({...editingProduct, show_price: !editingProduct.show_price})} className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (editingProduct.show_price ? 'bg-orange-500' : 'bg-slate-300')}><span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (editingProduct.show_price ? 'translate-x-6' : 'translate-x-1')} /></button></div>
            {/* Feature 5: Existing Images with Delete */}
            {editProductImages.length > 0 && (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2">Current Images ({editProductImages.length})</label>
                <div className="flex gap-2 flex-wrap">
                  {editProductImages.sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)).map((img: any, idx: number) => (
                    <div key={img.id} className="relative group w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                      <img src={img.url} alt={`Image ${idx + 1}`} className="w-full h-full object-cover" />
                      <button onClick={() => deleteProductImage(img.id)} disabled={deletingImageId === img.id}
                        className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
                        {deletingImageId === img.id
                          ? <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          : <span className="bg-red-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center shadow-lg">✕</span>}
                      </button>
                      {idx === 0 && <span className="absolute bottom-0.5 left-0.5 bg-orange-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">PRIMARY</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-slate-400 mt-1">Hover and click ✕ to delete</p>
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
          </div><div className="flex gap-2 mt-5"><button onClick={() => productAction('update', editingProduct.id, { sku: editingProduct.sku, name: editingProduct.name, description: editingProduct.description, price: editingProduct.price, quantity: editingProduct.quantity, make: editingProduct.make, model: editingProduct.model, year: editingProduct.year, model_code: editingProduct.model_code, condition: editingProduct.condition, side: editingProduct.side, color: editingProduct.color, oem_code: editingProduct.oem_code, cost: editingProduct.cost, category: editingProduct.category, show_price: editingProduct.show_price })} disabled={actionLoading === editingProduct.id} className="bg-orange-500 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">Save</button><button onClick={() => setEditingProduct(null)} className="text-slate-500 text-sm px-4 py-2">Cancel</button></div></div></div>)}
          {products.length === 0 ? <div className="text-center py-16 bg-white rounded-xl border border-slate-200"><p className="text-4xl mb-3">📦</p><p className="text-slate-500 font-semibold">No products</p></div> : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="px-3 py-3 w-10"><input type="checkbox" checked={selectedProducts.size > 0 && selectedProducts.size === filteredProducts.length} onChange={() => toggleSelectAll(filteredProducts)} className="w-4 h-4 accent-orange-500" /></th><th className="px-4 py-3 text-xs font-bold text-slate-500">Image</th><th className="px-4 py-3 text-xs font-bold text-slate-500">ID</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Product</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Price</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Stock</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Status</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Actions</th></tr></thead><tbody>
              {filteredProducts.map((p: any, i: number) => { const sortedImages = (p.images || []).slice().sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)); const pendingChange = primaryChanges.get(p.id); const effectivePrimaryId = pendingChange ? pendingChange.imageId : sortedImages[0]?.id; return (<tr key={p.id} className={'border-t border-slate-100 ' + (pendingChange ? 'bg-blue-50/50' : selectedProducts.has(p.id) ? 'bg-orange-50' : i % 2 ? 'bg-slate-50/50' : '')}><td className="px-3 py-2.5"><input type="checkbox" checked={selectedProducts.has(p.id)} onChange={() => toggleProductSelect(p.id)} className="w-4 h-4 accent-orange-500" /></td><td className="px-4 py-2.5"><div className={'flex gap-1.5 overflow-x-auto ' + (primaryMode ? 'max-w-[420px]' : 'max-w-[300px]')}>{sortedImages.length > 0 ? sortedImages.slice(0, 6).map((img: any) => { const isPrimary = img.id === effectivePrimaryId; const size = primaryMode ? 'w-20 h-20' : 'w-14 h-14'; return (<img key={img.id} src={img.url} alt="" loading="lazy" title={isPrimary ? 'Primary image' : primaryMode ? 'Click to set as primary' : ''} onClick={() => { if (primaryMode && !isPrimary) markAsPrimary(p.id, img.id, p.images) }} className={size + ' rounded-lg object-cover shrink-0 transition-all ' + (isPrimary ? 'ring-2 ring-orange-500' : 'border border-slate-200') + (primaryMode && !isPrimary ? ' cursor-pointer hover:ring-2 hover:ring-blue-400 hover:opacity-80' : '')} />) }) : <div className={(primaryMode ? 'w-20 h-20' : 'w-14 h-14') + ' rounded-lg bg-slate-100 flex items-center justify-center text-lg'}>🔧</div>}{sortedImages.length > 6 && <span className="text-[10px] text-slate-400 self-center shrink-0">+{sortedImages.length - 6}</span>}</div></td><td className="px-4 py-2.5"><span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded font-semibold">{p.sku}</span></td><td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{p.name}</div><div className="text-xs text-slate-400">{p.make && p.make + ' ' + (p.model || '')}</div></td><td className="px-4 py-2.5 font-bold text-orange-600">{p.price ? 'Rs.' + p.price.toLocaleString() : 'Ask'}</td><td className={'px-4 py-2.5 font-semibold ' + (p.quantity <= 0 ? 'text-red-500' : '')}>{p.quantity <= 0 ? <span className="bg-red-50 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">0 - Sold</span> : p.quantity}</td><td className="px-4 py-2.5"><span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{p.is_active ? 'ACTIVE' : 'HIDDEN'}</span></td><td className="px-4 py-2.5"><div className="flex gap-1"><button onClick={() => { setEditingProduct({...p}); setEditProductImages(p.images || []) }} className="text-[11px] font-semibold text-blue-600 px-2 py-1 rounded border border-blue-200">Edit</button><button onClick={() => productAction('toggle', p.id)} disabled={actionLoading === p.id} className={'text-[11px] font-semibold px-2 py-1 rounded border disabled:opacity-50 ' + (p.is_active ? 'text-amber-600 border-amber-200' : 'text-emerald-600 border-emerald-200')}>{p.is_active ? 'Hide' : 'Show'}</button><button onClick={() => { if (confirm('Delete?')) productAction('delete', p.id) }} className="text-[11px] font-semibold text-red-500 px-2 py-1 rounded border border-red-200">Del</button></div></td></tr>) })}
            </tbody></table></div></div>
          )}
        </div>)}

        {/* ADD PRODUCT */}
        {tab === 'add' && (<div className="max-w-2xl">
          <h1 className="text-2xl font-black text-slate-900 mb-6">Add Product</h1>
          <form onSubmit={handleAddProduct} className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3"><label className="block text-xs font-bold text-blue-800 mb-1">Part ID</label><input value={newProduct.partId} onChange={e => setNewProduct({...newProduct, partId: e.target.value.toUpperCase()})} className="w-full px-3 py-2.5 rounded-lg border-2 border-blue-200 text-sm outline-none font-mono font-bold bg-white" placeholder="Auto-generated if blank" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Name *</label><input required value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Description</label><textarea value={newProduct.description} onChange={e => setNewProduct({...newProduct, description: e.target.value})} rows={2} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none resize-none" /></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Category</label><select value={newProduct.category} onChange={e => setNewProduct({...newProduct, category: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Condition</label><select value={newProduct.condition} onChange={e => setNewProduct({...newProduct, condition: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none">{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div></div>
            <div className="grid grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Make</label><input value={newProduct.make} onChange={e => setNewProduct({...newProduct, make: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Toyota" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Model</label><input value={newProduct.model} onChange={e => setNewProduct({...newProduct, model: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Year</label><input value={newProduct.year} onChange={e => setNewProduct({...newProduct, year: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div>
            <div className="grid grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Model Code</label><input value={newProduct.modelCode} onChange={e => setNewProduct({...newProduct, modelCode: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="ZRE172" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Side</label><select value={newProduct.side} onChange={e => setNewProduct({...newProduct, side: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none"><option value="">Any</option><option>Front</option><option>Rear</option><option>Left</option><option>Right</option><option>Front Left</option><option>Front Right</option><option>Rear Left</option><option>Rear Right</option></select></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Color</label><input value={newProduct.color} onChange={e => setNewProduct({...newProduct, color: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Black" /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">OEM Code</label><input value={newProduct.oemCode} onChange={e => setNewProduct({...newProduct, oemCode: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none font-mono" placeholder="A12345" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Cost (Rs.)</label><input type="number" value={newProduct.cost} onChange={e => setNewProduct({...newProduct, cost: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Internal cost" /></div></div>
            <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Price (Rs.)</label><input type="number" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Quantity</label><input type="number" value={newProduct.quantity} onChange={e => setNewProduct({...newProduct, quantity: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div>
            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-4 py-3"><div><p className="text-xs font-semibold text-slate-700">Show Price Publicly</p><p className="text-[11px] text-slate-400 mt-0.5">Customers will see the price on the listing</p></div><button type="button" onClick={() => setNewProduct({...newProduct, show_price: !newProduct.show_price})} className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (newProduct.show_price ? 'bg-orange-500' : 'bg-slate-300')}><span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (newProduct.show_price ? 'translate-x-6' : 'translate-x-1')} /></button></div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-2">Images</label><input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleImageSelect} className="hidden" /><div className="flex flex-wrap gap-3">{imagePreviews.map((p, i) => (<div key={i} className="relative w-20 h-20 rounded-lg overflow-hidden border-2 border-slate-200"><img src={p} alt="" className="w-full h-full object-cover" /><button type="button" onClick={() => removeImage(i)} className="absolute top-0.5 right-0.5 w-5 h-5 bg-red-500 text-white rounded-full text-xs font-bold flex items-center justify-center">x</button></div>))}<button type="button" onClick={() => fileInputRef.current?.click()} className="w-20 h-20 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 hover:border-orange-400"><span className="text-xl">+</span></button></div></div>
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
                const csv = 'Added Date,stock no,Part name,Part Description,Category,Make,Model,Model Code,Condition,Side,Color,OEM Code,Quantity,Cost,Price,show price\n12-Mar-2026,BRK-001,Front Brake Pads Set,OEM quality brake pads,Brake System,Toyota,Corolla,ZRE172,Reconditioned,Front,Black,,10,,4500,YES\n12-Mar-2026,ENG-002,Timing Belt Kit,Complete kit with tensioner,Engine Parts,Honda,Civic,FK7,New,,,A4567,5,8000,12500,YES\n12-Mar-2026,SUS-003,Front Shock Absorber LH,Gas-filled absorber,Suspension & Steering,Nissan,X-Trail,NT32,Reconditioned,Left,,12340,8,,8900,NO'
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
                <p><strong>Columns:</strong> Added Date, stock no, Part name, Part Description, Category, Make, Model, Model Code, Condition, Side, Color, OEM Code, Quantity, Cost, Price, show price</p>
                <p className="mt-1"><strong>show price:</strong> YES or NO</p>
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

        {/* POS */}
        {tab === 'pos' && (<div>
          {posReceipt ? (
            <div>
              <div className="flex items-center justify-between mb-4"><h1 className="text-2xl font-black">Invoice Created!</h1><button onClick={() => setPosReceipt(null)} className="text-sm text-slate-500 px-3 py-1.5 rounded-lg border border-slate-200">+ New Sale</button></div>
              <div className="bg-white rounded-2xl border border-slate-200 p-6 max-w-2xl">
                <div className="text-center mb-4"><p className="text-4xl mb-2">✅</p><p className="text-2xl font-black">{posReceipt.sale.invoice_no}</p><p className="text-sm text-slate-500">{posReceipt.sale.customer_name}</p><p className="text-3xl font-black text-orange-600 mt-2">Rs.{parseFloat(posReceipt.sale.total).toLocaleString()}</p>
                  {parseFloat(posReceipt.sale.balance_due) > 0 && <p className="text-lg font-bold text-red-600 mt-1">Balance Due: Rs.{parseFloat(posReceipt.sale.balance_due).toLocaleString()}</p>}
                  {posReceipt.advanceUsed > 0 && <p className="text-sm font-bold text-cyan-600 mt-1">Rs.{posReceipt.advanceUsed.toLocaleString()} used from advance</p>}
                  {posReceipt.appliedToOutstanding > 0 && <p className="text-sm font-bold text-amber-600 mt-1">Rs.{posReceipt.appliedToOutstanding.toLocaleString()} applied to old invoices{posReceipt.settledInvoices?.length > 0 ? ` (cleared: ${posReceipt.settledInvoices.join(', ')})` : ''}</p>}
                  {posReceipt.newAdvance > 0 && <p className="text-sm font-bold text-emerald-600 mt-1">Rs.{posReceipt.newAdvance.toLocaleString()} added to advance</p>}
                </div>
                <div className="flex gap-2 flex-wrap justify-center">
                  <button onClick={() => printInvoice(posReceipt.sale, posReceipt.vendor, 'thermal', vendorSettings)} className="bg-slate-800 text-white text-sm font-bold px-5 py-2.5 rounded-xl">🖨️ Thermal</button>
                  <button onClick={() => printInvoice(posReceipt.sale, posReceipt.vendor, 'a4', vendorSettings)} className="bg-blue-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">📄 A4</button>
                  {posReceipt.sale.customer_phone && <button onClick={() => sendWhatsAppBill(posReceipt.sale, posReceipt.vendor, posReceipt.sale.customer_phone)} className="bg-green-500 text-white text-sm font-bold px-5 py-2.5 rounded-xl">💬 WhatsApp</button>}
                  {data?.vendor?.whatsapp && <button onClick={sendEODReport} className="bg-purple-600 text-white text-sm font-bold px-5 py-2.5 rounded-xl">📊 End of Day → Manager</button>}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-4">
              <h1 className="text-2xl font-black text-slate-900">🧾 POS</h1>
              {data?.vendor?.whatsapp && (
                <button onClick={sendEODReport}
                  className="flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg bg-purple-50 border border-purple-200 text-purple-700 hover:bg-purple-100">
                  📊 End of Day → Manager
                </button>
              )}
            </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-4">
                  {/* Product Search */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <label className="block text-xs font-bold text-slate-500 mb-2">Search Products</label>
                    <input value={posSearch} onChange={e => setPosSearch(e.target.value)} className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Part name, SKU, make..." />
                    {posFilteredProducts.length > 0 && (<div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 rounded-lg">{posFilteredProducts.slice(0, 10).map((p: any) => (<button key={p.id} onClick={() => addToCart(p)} className="w-full text-left px-3 py-2 hover:bg-orange-50 border-b border-slate-100 flex items-center justify-between text-sm"><div><span className="font-mono text-xs text-slate-400 mr-2">{p.sku}</span><span className="font-semibold">{p.name}</span><span className="text-xs text-slate-400 ml-2">({p.quantity})</span></div><span className="font-bold text-orange-600">Rs.{p.price?.toLocaleString() || 'N/A'}</span></button>))}</div>)}
                  </div>
                  {/* Cart */}
                  {posCart.length === 0 ? <div className="bg-white rounded-xl border border-slate-200 p-8 text-center"><p className="text-3xl opacity-30">🛒</p><p className="text-slate-400 font-semibold">Add products above</p></div> : (
                    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="px-4 py-2 text-left text-xs font-bold text-slate-500">Item</th><th className="px-4 py-2 text-xs font-bold text-slate-500 w-20">Qty</th><th className="px-4 py-2 text-xs font-bold text-slate-500 w-28">Price</th><th className="px-4 py-2 text-right text-xs font-bold text-slate-500 w-24">Total</th><th className="w-8"></th></tr></thead><tbody>
                      {posCart.map((item, i) => (<tr key={i} className="border-t border-slate-100"><td className="px-4 py-2"><span className="font-mono text-xs text-slate-400 mr-1">{item.productSku}</span><span className="font-semibold">{item.productName}</span></td><td className="px-4 py-2"><input type="number" min="1" max={item.maxStock} value={item.quantity} onChange={e => updateCartQty(i, parseInt(e.target.value) || 1)} className="w-16 px-2 py-1 border border-slate-200 rounded text-center text-sm" /></td><td className="px-4 py-2"><input type="text" inputMode="numeric" value={item.unitPrice || ''} onChange={e => { const v = e.target.value.replace(/[^0-9]/g, ''); updateCartPrice(i, v ? parseInt(v) : 0) }} onFocus={e => { if (e.target.value === '0') e.target.value = '' }} className="w-24 px-2 py-1 border border-slate-200 rounded text-sm" /></td><td className="px-4 py-2 text-right font-bold">Rs.{(item.quantity * item.unitPrice).toLocaleString()}</td><td className="px-2"><button onClick={() => removeFromCart(i)} className="text-red-400 hover:text-red-600">✕</button></td></tr>))}
                    </tbody></table></div>
                  )}
                </div>

                {/* Right sidebar */}
                <div className="space-y-4">
                  {/* Customer */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
                    <h3 className="font-bold text-slate-800 text-sm">Customer</h3>
                    <div className="relative">
                      <input value={posCustomer.name} onChange={e => { setPosCustomer({ ...posCustomer, id: null, name: e.target.value }); searchCustomers(e.target.value); if (posErrors.name) setPosErrors(prev => ({ ...prev, name: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none transition-all duration-200 ${posErrors.name ? 'border-red-400 bg-red-50 animate-[shake_0.3s_ease-in-out]' : 'border-slate-200 focus:border-orange-400'}`} placeholder="Customer name (type to search)" />
                      {customerSuggestions.length > 0 && (<div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto mt-1">{customerSuggestions.map((c: any) => (<button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm border-b border-slate-100"><span className="font-semibold">{c.name}</span>{c.phone && <span className="text-xs text-slate-400 ml-2">{c.phone}</span>}</button>))}</div>)}
                    </div>
                    <input value={posCustomer.phone} onChange={e => { setPosCustomer({...posCustomer, phone: e.target.value}); if (posErrors.phone) setPosErrors(prev => ({ ...prev, phone: false })) }} className={`w-full px-3 py-2 rounded-lg border-2 text-sm outline-none transition-all duration-200 ${posErrors.phone ? 'border-red-400 bg-red-50 animate-[shake_0.3s_ease-in-out]' : 'border-slate-200 focus:border-orange-400'}`} placeholder="Phone / WhatsApp" />
                    {posCustomer.id && <p className="text-[10px] text-green-600 font-semibold">✓ Existing customer selected</p>}
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
                    <input type="text" value={posVehicleNo} onChange={e => { let v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); const m = v.match(/^([A-Z]{2,3})(\d{1,4})$/); if (m) v = m[1] + '-' + m[2]; setPosVehicleNo(v) }} placeholder="ABC-1234" maxLength={8} className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 font-mono font-bold tracking-wider" />
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
                          <input type="text" inputMode="numeric" pattern="[0-9]*" value={line.amount} onChange={e => { const val = e.target.value.replace(/[^0-9.]/g, ''); const u = [...posPayments]; u[i] = { ...u[i], amount: val }; setPosPayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Amount" />
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

                  {/* Total */}
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-4 text-white">
                    {posDiscountAmt > 0 && <div className="flex justify-between text-sm mb-1"><span className="text-red-300">Discount</span><span>-Rs.{posDiscountAmt.toLocaleString()}</span></div>}
                    <div className="flex justify-between text-2xl font-black"><span>TOTAL</span><span>Rs.{posTotal.toLocaleString()}</span></div>
                    {posAdvanceApplied > 0 && <div className="flex justify-between text-sm"><span className="text-cyan-300">From Advance</span><span className="text-cyan-300">Rs.{posAdvanceApplied.toLocaleString()}</span></div>}
                    {posOverpayment > 0 && posCustomer.outstanding > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-600">
                        <div className="flex justify-between text-sm"><span className="text-amber-300">→ To Outstanding</span><span className="text-amber-300">Rs.{Math.min(posOverpayment, posCustomer.outstanding).toLocaleString()}</span></div>
                        {posOverpayment > posCustomer.outstanding && <div className="flex justify-between text-sm"><span className="text-emerald-300">→ To Advance</span><span className="text-emerald-300">Rs.{(posOverpayment - posCustomer.outstanding).toLocaleString()}</span></div>}
                      </div>
                    )}
                    {posOverpayment > 0 && posCustomer.outstanding <= 0 && <div className="flex justify-between text-sm font-bold mt-1"><span className="text-emerald-300">→ To Advance</span><span className="text-emerald-300">+Rs.{posOverpayment.toLocaleString()}</span></div>}
                    {posBalance > 0 && <div className="flex justify-between text-sm font-bold mt-1"><span className="text-red-300">On Credit</span><span className="text-red-300">Rs.{posBalance.toLocaleString()}</span></div>}
                  </div>

                  <button onClick={handleCreateSale} disabled={posLoading || posCart.length === 0} className="w-full bg-green-500 hover:bg-green-600 text-white font-black text-lg py-4 rounded-xl disabled:opacity-50 shadow-lg">{posLoading ? 'Creating...' : posBalance > 0 ? '💳 Complete (Credit: Rs.' + posBalance.toLocaleString() + ')' : posOverpayment > 0 && posCustomer.outstanding > 0 ? '💰 Complete & Settle Outstanding' : posOverpayment > 0 ? '💰 Complete (+Rs.' + posOverpayment.toLocaleString() + ' advance)' : '💰 Complete Sale'}</button>
                </div>
              </div>
            </div>
          )}
        </div>)}

        {/* SALES */}
        {tab === 'sales' && (<div>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <h1 className="text-2xl font-black">📊 Sales & Analytics</h1>
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={() => { const today = new Date().toISOString().slice(0,10); setExportFrom(today); setExportTo(today); setShowExportModal(true) }} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100">⬇ Export CSV</button>
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
                  {[{v:'overview',l:'Overview'},{v:'transactions',l:'Transactions'},{v:'customers',l:'Customers'},{v:'reports',l:'📊 Reports'}].map(t => (
                    <button key={t.v} onClick={() => setSalesSubTab(t.v)} className={`flex-1 py-2 text-xs font-bold rounded-md transition ${salesSubTab === t.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{t.l}</button>
                  ))}
                </div>

                {/* ─── OVERVIEW ─── */}
                {salesSubTab === 'overview' && (<div>
                  {/* Stats cards — 2 cols mobile, 3 cols desktop */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 sm:gap-4 mb-5">
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-green-600">Rs.{salesData.stats.totalRevenue.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Revenue</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-emerald-600">Rs.{salesData.stats.totalPaid.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Collected</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-red-600">Rs.{salesData.stats.totalCredit.toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Outstanding</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-blue-600">{salesData.stats.totalSales}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Invoices</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-purple-600">{salesData.stats.totalItems}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Items Sold</p>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3.5 sm:p-4">
                      <p className="text-lg sm:text-xl font-black text-orange-600">Rs.{Math.round(salesData.stats.avgSale).toLocaleString()}</p>
                      <p className="text-[11px] text-slate-400 font-semibold">Avg Invoice</p>
                    </div>
                  </div>

                  {/* Revenue chart — simple bar chart with CSS */}
                  {salesData.dailyRevenue && salesData.dailyRevenue.length > 1 && (
                    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
                      <h3 className="font-bold text-sm mb-3">Daily Revenue</h3>
                      <div className="flex items-end gap-1 h-32 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                        {(() => {
                          const maxRev = Math.max(...salesData.dailyRevenue.map((d: any) => d.revenue))
                          return salesData.dailyRevenue.map((day: any) => {
                            const h = maxRev > 0 ? (day.revenue / maxRev) * 100 : 0
                            const dateStr = new Date(day.date + 'T00:00:00').toLocaleDateString('en-LK', { day: 'numeric', month: 'short' })
                            return (
                              <div key={day.date} className="flex flex-col items-center gap-1 flex-1 min-w-[28px] group relative">
                                <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition pointer-events-none z-10">
                                  Rs.{day.revenue.toLocaleString()} ({day.count} sales)
                                </div>
                                <div className="w-full bg-gradient-to-t from-orange-500 to-orange-400 rounded-t-sm transition-all" style={{ height: `${Math.max(h, 2)}%` }} />
                                <span className="text-[8px] text-slate-400 -rotate-45 origin-center whitespace-nowrap">{dateStr}</span>
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
                                  <div className="h-full bg-orange-400 rounded-full" style={{ width: `${pct}%` }} />
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
                    // General search (invoice, product name/sku)
                    if (salesSearch) {
                      const sq = salesSearch.toLowerCase()
                      const invoice = (sale.invoice_no || '').toLowerCase()
                      const items = (sale.items || []).map((i: any) => `${i.product_sku || ''} ${i.product_name || ''}`).join(' ').toLowerCase()
                      const name = (sale.customer?.name || sale.customer_name || '').toLowerCase()
                      if (!invoice.includes(sq) && !items.includes(sq) && !name.includes(sq)) return false
                    }
                    return true
                  })
                  const activeFilterCount = [salesFilterFrom, salesFilterTo, salesFilterCustomer, salesFilterVehicle].filter(Boolean).length
                  return (
                  <div>
                    {/* Search + Filter toggle */}
                    <div className="flex gap-2 mb-2">
                      <input type="text" value={salesSearch} onChange={e => setSalesSearch(e.target.value)} placeholder="Search invoice, product, customer..." className="flex-1 px-4 py-2 rounded-xl border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
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
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400">DATE</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400">INVOICE</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400">ITEMS</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400">VEHICLE</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400">CUSTOMER</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400 text-right">TOTAL</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400">STATUS</th>
                            <th className="px-3 py-2.5 text-[10px] font-bold text-slate-400"></th>
                          </tr></thead>
                          <tbody>
                            {filteredSales.map((sale: any) => {
                              const isExpanded = expandedSale === sale.id
                              return (<>
                                <tr key={sale.id} onClick={() => setExpandedSale(isExpanded ? null : sale.id)} className={'border-t border-slate-100 cursor-pointer hover:bg-slate-50 transition ' + (sale.payment_status === 'voided' ? 'opacity-50' : '') + (isExpanded ? ' bg-orange-50/50' : '')}>
                                  <td className="px-3 py-2.5 text-xs text-slate-500 whitespace-nowrap">{formatDateShort(sale.created_at)}</td>
                                  <td className="px-3 py-2.5"><span className="font-mono text-[10px] font-bold bg-slate-100 px-1.5 py-0.5 rounded">{sale.invoice_no}</span></td>
                                  <td className="px-3 py-2.5 text-xs max-w-[300px]">
                                    {(sale.items || []).map((i: any) => (
                                      <div key={i.id} className="truncate"><span className="font-mono text-slate-400 mr-1">{i.product_sku}</span>{i.product_name} <span className="text-slate-400">x{i.quantity}</span></div>
                                    )).slice(0, 2)}
                                    {(sale.items || []).length > 2 && <span className="text-[10px] text-slate-400">+{(sale.items || []).length - 2} more</span>}
                                  </td>
                                  <td className="px-3 py-2.5 text-xs font-mono font-semibold text-slate-600">{sale.vehicle_no || '—'}</td>
                                  <td className="px-3 py-2.5 text-xs font-semibold whitespace-nowrap">{sale.customer?.name || sale.customer_name}</td>
                                  <td className="px-3 py-2.5 text-right font-bold text-orange-600 whitespace-nowrap">Rs.{parseFloat(sale.total).toLocaleString()}</td>
                                  <td className="px-3 py-2.5"><span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' + (sale.payment_status === 'voided' ? 'bg-red-100 text-red-600' : sale.payment_status === 'paid' ? 'bg-green-100 text-green-600' : sale.payment_status === 'partial' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600')}>{sale.payment_status === 'voided' ? 'VOID' : sale.payment_status.toUpperCase()}</span></td>
                                  <td className="px-3 py-2.5 text-slate-400 text-xs">{isExpanded ? '▲' : '▼'}</td>
                                </tr>
                                {isExpanded && (
                                  <tr key={sale.id + '-detail'}><td colSpan={8} className="px-3 pb-3 bg-slate-50/50 border-t border-slate-100">
                                    <table className="w-full text-xs mt-2"><tbody>{(sale.items || []).map((i: any) => { const returned = (i.returned_quantity || 0) >= i.quantity; const partialReturn = i.returned_quantity > 0 && i.returned_quantity < i.quantity; return (<tr key={i.id} className={'border-b border-slate-100 ' + (returned ? 'opacity-40' : '')}><td className="py-1.5"><span className="font-mono text-slate-400 mr-1">{i.product_sku}</span><span className={returned ? 'line-through' : ''}>{i.product_name}</span>{returned && <span className="ml-1.5 text-[9px] font-bold text-red-400 bg-red-50 px-1.5 py-0.5 rounded">RETURNED</span>}{partialReturn && <span className="ml-1.5 text-[9px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">{i.returned_quantity} returned</span>}</td><td className="py-1.5 text-right text-slate-500">x{i.quantity}</td><td className="py-1.5 text-right font-semibold">Rs.{parseFloat(i.unit_price).toLocaleString()}</td><td className={'py-1.5 text-right font-semibold ' + (returned ? 'line-through text-slate-300' : '')}>Rs.{parseFloat(i.total).toLocaleString()}</td></tr>)})}</tbody></table>
                                    {parseFloat(sale.balance_due) > 0 && <p className="text-xs font-bold text-red-600 mt-2">Balance Due: Rs.{parseFloat(sale.balance_due).toLocaleString()}</p>}
                                    <div className="flex gap-2 mt-3 flex-wrap">
                                      <div className="relative">
                                        <button onClick={e => { e.stopPropagation(); const el = document.getElementById('print-menu-' + sale.id); if (el) el.classList.toggle('hidden') }} className="text-[11px] font-semibold text-slate-600 px-3 py-1.5 rounded border border-slate-200 active:bg-slate-50">🖨️ Print ▾</button>
                                        <div id={'print-menu-' + sale.id} className="hidden absolute left-0 bottom-full mb-1 bg-white rounded-lg border border-slate-200 shadow-lg z-20 overflow-hidden min-w-[140px]">
                                          <button onClick={() => { printInvoice(sale, salesData.vendor, 'thermal', vendorSettings); document.getElementById('print-menu-' + sale.id)?.classList.add('hidden') }} className="w-full text-left px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 border-b border-slate-100">🖨️ Thermal</button>
                                          <button onClick={() => { printInvoice(sale, salesData.vendor, 'a4', vendorSettings); document.getElementById('print-menu-' + sale.id)?.classList.add('hidden') }} className="w-full text-left px-3 py-2.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 border-b border-slate-100">📄 A4 Print</button>
                                          {(sale.customer_phone || sale.customer?.phone) && <button onClick={() => { sendWhatsAppBill(sale, salesData.vendor, sale.customer_phone || sale.customer?.phone); document.getElementById('print-menu-' + sale.id)?.classList.add('hidden') }} className="w-full text-left px-3 py-2.5 text-xs font-semibold text-green-600 hover:bg-green-50">💬 WhatsApp</button>}
                                        </div>
                                      </div>
                                      {sale.payment_status !== 'voided' && <button onClick={e => { e.stopPropagation(); setReturnModal(sale); setReturnItems({}) }} className="text-[11px] font-semibold text-amber-600 px-3 py-1.5 rounded border border-amber-200 active:bg-amber-50">↩ Return</button>}
                                      {sale.customer_id && <button onClick={e => { e.stopPropagation(); setCustomerHistoryId(sale.customer_id); setCustomerHistoryName(sale.customer?.name || sale.customer_name) }} className="text-[11px] font-semibold text-purple-600 px-3 py-1.5 rounded border border-purple-200 active:bg-purple-50">👤 History</button>}
                                    </div>
                                  </td></tr>
                                )}
                              </>)
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
                      <p className="text-xs text-slate-400 mb-3">Business day: 7:30 PM previous day to 7:30 PM selected day</p>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <button onClick={() => generateDailyReport(salesData?.sales || [], data?.vendor, reportDate, vendorSettings)} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Generate PDF</button>
                        <button onClick={() => whatsAppDailyReport(salesData?.sales || [], data?.vendor, reportDate)} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">💬 WhatsApp Summary</button>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                      <h3 className="font-bold text-sm text-slate-800 mb-3">📆 Period Report</h3>
                      <p className="text-xs text-slate-400 mb-3">Includes customer-wise credit details</p>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label><input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label><input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <button onClick={() => { const allSales = (salesData?.sales || []).filter((s: any) => { const d = s.created_at.slice(0, 10); return d >= reportFrom && d <= reportTo }); generatePeriodReport(allSales, data?.vendor, reportFrom, reportTo, vendorSettings) }} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Generate PDF</button>
                      </div>
                      <div className="flex gap-2 mt-3">
                        {[{l:"This Week",f:7},{l:"This Month",f:30},{l:"Last 3 Months",f:90}].map(p => (<button key={p.l} onClick={() => { setReportFrom(new Date(Date.now() - p.f * 86400000).toISOString().slice(0, 10)); setReportTo(new Date().toISOString().slice(0, 10)) }} className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-100">{p.l}</button>))}
                      </div>
                    </div>
                  </div>
                )}
              </>)


                {salesSubTab === "reports" && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                      <h3 className="font-bold text-sm text-slate-800 mb-3">📅 Daily Report</h3>
                      <p className="text-xs text-slate-400 mb-3">Business day: 7:30 PM previous day to 7:30 PM selected day</p>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Date</label><input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <button onClick={() => generateDailyReport(salesData?.sales || [], data?.vendor, reportDate, vendorSettings)} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Generate PDF</button>
                        <button onClick={() => whatsAppDailyReport(salesData?.sales || [], data?.vendor, reportDate)} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">💬 WhatsApp Summary</button>
                      </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-5">
                      <h3 className="font-bold text-sm text-slate-800 mb-3">📆 Period Report</h3>
                      <p className="text-xs text-slate-400 mb-3">Includes customer-wise credit details</p>
                      <div className="flex items-end gap-3 flex-wrap">
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">From</label><input type="date" value={reportFrom} onChange={e => setReportFrom(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <div><label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">To</label><input type="date" value={reportTo} onChange={e => setReportTo(e.target.value)} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                        <button onClick={() => { const allSales = (salesData?.sales || []).filter((s: any) => { const d = s.created_at.slice(0, 10); return d >= reportFrom && d <= reportTo }); generatePeriodReport(allSales, data?.vendor, reportFrom, reportTo, vendorSettings) }} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-4 py-2.5 rounded-lg">📄 Generate PDF</button>
                      </div>
                      <div className="flex gap-2 mt-3">
                        {[{l:"This Week",f:7},{l:"This Month",f:30},{l:"Last 3 Months",f:90}].map(p => (<button key={p.l} onClick={() => { setReportFrom(new Date(Date.now() - p.f * 86400000).toISOString().slice(0, 10)); setReportTo(new Date().toISOString().slice(0, 10)) }} className="text-[10px] font-bold text-slate-500 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 active:bg-slate-100">{p.l}</button>))}
                      </div>
                    </div>
                  </div>
                )}
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
                              </div>
                              <div className="flex items-center gap-1.5">
                                <span className={'text-[9px] font-bold px-1.5 py-0.5 rounded-full ' + (sale.payment_status === 'voided' ? 'bg-red-100 text-red-600' : sale.payment_status === 'paid' ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600')}>{sale.payment_status.toUpperCase()}</span>
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

        {/* CREDIT */}
        {tab === 'credit' && (<div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-black text-slate-900">💳 Credit & Customers</h1>
            <button onClick={() => setShowAddCustomer(!showAddCustomer)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg">{showAddCustomer ? 'Cancel' : '+ Add Customer'}</button>
          </div>

          {/* Register Customer Form */}
          {showAddCustomer && (
            <div className="bg-white rounded-xl border-2 border-orange-200 p-5 mb-4">
              <h3 className="font-bold text-sm text-slate-800 mb-3">Register New Customer</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div><label className="block text-[11px] font-semibold text-slate-500 mb-1">Name *</label><input value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Customer name" /></div>
                <div><label className="block text-[11px] font-semibold text-slate-500 mb-1">Phone *</label><input value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="07XXXXXXXX" /></div>
                <div><label className="block text-[11px] font-semibold text-slate-500 mb-1">WhatsApp</label><input value={newCustomer.whatsapp} onChange={e => setNewCustomer({...newCustomer, whatsapp: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Same as phone if blank" /></div>
                <div><label className="block text-[11px] font-semibold text-slate-500 mb-1">Email</label><input value={newCustomer.email} onChange={e => setNewCustomer({...newCustomer, email: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Optional" /></div>
                <div className="col-span-2"><label className="block text-[11px] font-semibold text-slate-500 mb-1">Address</label><input value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Optional" /></div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-3">
                <div><label className="block text-[11px] font-semibold text-slate-500 mb-1">Notes</label><input value={newCustomer.notes} onChange={e => setNewCustomer({...newCustomer, notes: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Internal notes" /></div>
                <div><label className="block text-[11px] font-semibold text-emerald-600 mb-1">Opening Advance (Rs.)</label><input type="text" inputMode="numeric" value={newCustomer.advance} onChange={e => setNewCustomer({...newCustomer, advance: e.target.value.replace(/[^0-9.]/g, '')})} className="w-full px-3 py-2 rounded-lg border-2 border-emerald-200 text-sm outline-none focus:border-emerald-400 bg-emerald-50" placeholder="0" /></div>
                <div><label className="block text-[11px] font-semibold text-red-600 mb-1">Opening Credit Owed (Rs.)</label><input type="text" inputMode="numeric" value={newCustomer.credit} onChange={e => setNewCustomer({...newCustomer, credit: e.target.value.replace(/[^0-9.]/g, '')})} className="w-full px-3 py-2 rounded-lg border-2 border-red-200 text-sm outline-none focus:border-red-400 bg-red-50" placeholder="0" /></div>
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={registerCustomer} disabled={addCustomerLoading} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-6 py-2 rounded-lg disabled:opacity-50">{addCustomerLoading ? 'Registering...' : 'Register Customer'}</button>
                <button onClick={() => setShowAddCustomer(false)} className="text-slate-500 text-sm px-4 py-2">Cancel</button>
              </div>
            </div>
          )}

            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <svg className="absolute left-3 top-[10px] text-[#bbb]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input type="text" placeholder="Search customers..." value={customerSearch} onChange={e => setCustomerSearch(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                {customerSearch && <button onClick={() => setCustomerSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">✕</button>}
              </div>
              <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-lg border border-slate-200">
                <input type="checkbox" checked={showAllCustomers} onChange={e => setShowAllCustomers(e.target.checked)} className="w-4 h-4 accent-orange-500" />
                <span className="text-xs font-semibold text-slate-600">Show All Customers</span>
              </label>
            </div>

          {/* Settle modal */}
          {settleSale && selectedCreditCustomer && (<div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setSettleSale(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-1">Settle Payment</h3>
              <p className="text-sm text-slate-500 mb-1">{selectedCreditCustomer.name} — Invoice {settleSale.invoice_no}</p>
              <p className="text-lg font-black text-red-600 mb-4">Balance Due: Rs.{parseFloat(settleSale.balance_due).toLocaleString()}</p>
              <div className="space-y-2">
                {settlePayments.map((line, i) => (
                  <div key={`settle-pay-${i}`} className="flex gap-2 items-start flex-wrap">
                    <select value={line.method} onChange={e => { const u = [...settlePayments]; u[i] = { ...u[i], method: e.target.value }; setSettlePayments(u) }} className="px-2 py-2 rounded-lg border-2 border-slate-200 text-xs font-bold outline-none flex-shrink-0">
                      {PAY_METHODS.map(m => <option key={m} value={m}>{PAY_LABELS[m]}</option>)}
                    </select>
                    <input type="text" inputMode="numeric" pattern="[0-9]*" value={line.amount} onChange={e => { const val = e.target.value.replace(/[^0-9.]/g, ''); const u = [...settlePayments]; u[i] = { ...u[i], amount: val }; setSettlePayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Amount" />
                    {line.method === 'cheque' && (<>
                      <input type="text" value={line.chequeNumber} onChange={e => { const u = [...settlePayments]; u[i] = { ...u[i], chequeNumber: e.target.value }; setSettlePayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Cheque #" />
                      <input type="date" value={line.chequeDate} onChange={e => { const u = [...settlePayments]; u[i] = { ...u[i], chequeDate: e.target.value }; setSettlePayments(u) }} className="px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" />
                    </>)}
                    {line.method === 'bank' && <input type="text" value={line.bankRef} onChange={e => { const u = [...settlePayments]; u[i] = { ...u[i], bankRef: e.target.value }; setSettlePayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Ref #" />}
                    {settlePayments.length > 1 && <button onClick={() => setSettlePayments(settlePayments.filter((_, x) => x !== i))} className="text-red-400 hover:text-red-600 text-sm font-bold px-1">✕</button>}
                  </div>
                ))}
                <div className="flex gap-3">
                  <button onClick={() => setSettlePayments([...settlePayments, { method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])} className="text-xs font-bold text-blue-600">+ Add Payment Method</button>
                  {settleSale && parseFloat(settleSale.balance_due) > 0 && <button onClick={() => { const u = [...settlePayments]; u[u.length - 1] = { ...u[u.length - 1], amount: String(parseFloat(settleSale.balance_due)) }; setSettlePayments(u) }} className="text-xs font-bold text-orange-600">Fill full balance (Rs.{parseFloat(settleSale.balance_due).toLocaleString()})</button>}
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={handleSettle} disabled={settleLoading} className="bg-green-500 hover:bg-green-600 text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">{settleLoading ? 'Processing...' : 'Record Payment'}</button>
                <button onClick={() => setSettleSale(null)} className="text-slate-500 text-sm px-4 py-2">Cancel</button>
              </div>
            </div>
          </div>)}

          {/* Edit Customer Modal */}
          {editingCustomer && (<div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setEditingCustomer(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Edit Customer</h3>
              <div className="space-y-3">
                <div><label className="block text-xs font-semibold text-slate-500 mb-1">Name *</label><input value={editingCustomer.name || ''} onChange={e => setEditingCustomer({...editingCustomer, name: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-semibold text-slate-500 mb-1">Phone</label><input value={editingCustomer.phone || ''} onChange={e => setEditingCustomer({...editingCustomer, phone: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="0771234567" /></div>
                  <div><label className="block text-xs font-semibold text-slate-500 mb-1">WhatsApp</label><input value={editingCustomer.whatsapp || ''} onChange={e => setEditingCustomer({...editingCustomer, whatsapp: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="94771234567" /></div>
                </div>
                <div><label className="block text-xs font-semibold text-slate-500 mb-1">Email</label><input type="email" value={editingCustomer.email || ''} onChange={e => setEditingCustomer({...editingCustomer, email: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="customer@email.com" /></div>
                <div><label className="block text-xs font-semibold text-slate-500 mb-1">Address</label><textarea value={editingCustomer.address || ''} onChange={e => setEditingCustomer({...editingCustomer, address: e.target.value})} rows={2} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" placeholder="Street, City, District" /></div>
                <div><label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label><textarea value={editingCustomer.notes || ''} onChange={e => setEditingCustomer({...editingCustomer, notes: e.target.value})} rows={2} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" placeholder="Internal notes about this customer" /></div>
                {/* Advance Balance Adjustment */}
                <div className="border-t border-slate-200 pt-3 mt-3">
                  <label className="block text-xs font-bold text-slate-700 mb-2">Advance Balance: <span className="text-emerald-600">Rs.{parseFloat(editingCustomer.advance_balance || 0).toLocaleString()}</span></label>
                  <div className="flex gap-2">
                    <input type="text" inputMode="numeric" value={adjustAdvanceAmount} onChange={e => setAdjustAdvanceAmount(e.target.value.replace(/[^0-9.]/g, ''))} className="flex-1 px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-emerald-400" placeholder="Amount (Rs.)" />
                    <button onClick={() => adjustAdvance(editingCustomer.id, 'add')} disabled={editCustomerLoading} className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50">+ Add</button>
                    <button onClick={() => adjustAdvance(editingCustomer.id, 'refund')} disabled={editCustomerLoading || parseFloat(editingCustomer.advance_balance || 0) <= 0} className="bg-red-500 hover:bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-lg disabled:opacity-50">− Refund</button>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-5">
                <div className="flex gap-2">
                  <button onClick={handleEditCustomer} disabled={editCustomerLoading} className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">{editCustomerLoading ? 'Saving...' : 'Save Changes'}</button>
                  <button onClick={() => { setEditingCustomer(null); setAdjustAdvanceAmount('') }} className="text-slate-500 text-sm px-4 py-2">Cancel</button>
                </div>
                <button onClick={async () => { if (!confirm(`Delete customer "${editingCustomer.name}"? This cannot be undone.`)) return; setEditCustomerLoading(true); try { const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', customerId: editingCustomer.id }) }); const j = await r.json(); if (j.success) { showToast('Customer deleted'); setEditingCustomer(null); fetchCreditCustomers(); if (selectedCreditCustomer?.id === editingCustomer.id) setSelectedCreditCustomer(null) } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setEditCustomerLoading(false) }} disabled={editCustomerLoading} className="text-red-500 hover:text-red-700 text-xs font-bold px-3 py-2 rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-50">Delete Customer</button>
              </div>
            </div>
          </div>)}

          {creditLoading ? <div className="text-center py-8"><div className="w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Customer list */}
              <div className="space-y-2">
                <h3 className="font-bold text-slate-800 text-sm mb-2">Customers with Credit ({creditCustomers.length})</h3>
                {(() => { const filtered = creditCustomers.filter((c: any) => { if (!customerSearch) return true; const s = customerSearch.toLowerCase(); return c.name?.toLowerCase().includes(s) || c.phone?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) }); return filtered.length === 0 })() ? <div className="bg-white rounded-xl border border-slate-200 p-6 text-center"><p className="text-2xl opacity-30">✅</p><p className="text-slate-400 text-sm font-semibold mt-2">No outstanding credit or advances</p></div> : creditCustomers.filter((c: any) => { if (!customerSearch) return true; const s = customerSearch.toLowerCase(); return c.name?.toLowerCase().includes(s) || c.phone?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) }).map((c: any) => (
                  <button key={c.id} onClick={() => loadOutstanding(c)} className={'w-full text-left bg-white rounded-xl border px-4 py-3 hover:shadow-md transition ' + (selectedCreditCustomer?.id === c.id ? 'border-orange-500 bg-orange-50' : 'border-slate-200')}>
                    <div className="flex items-center justify-between">
                      <div><p className="font-bold text-sm">{c.name}</p>{c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}</div>
                      <div className="text-right">
                        {c.credit?.balance > 0 && <p className="font-black text-red-600">Owes: Rs.{c.credit.balance.toLocaleString()}</p>}
                        {c.advance > 0 && <p className="font-bold text-emerald-600">Advance: Rs.{c.advance.toLocaleString()}</p>}
                        <p className="text-[10px] text-slate-400">{c.credit?.salesCount || 0} invoices</p>
                      </div>
                    </div>
                  </button>
                ))}
                <div className="mt-2 space-y-2">
                  <div className="bg-red-800 rounded-xl p-3 text-white"><div className="flex justify-between"><span className="text-sm">Total Outstanding</span><span className="font-black">Rs.{creditCustomers.reduce((s: number, c: any) => s + (c.credit?.balance || 0), 0).toLocaleString()}</span></div></div>
                  <div className="bg-emerald-800 rounded-xl p-3 text-white"><div className="flex justify-between"><span className="text-sm">Total Advances</span><span className="font-black">Rs.{creditCustomers.reduce((s: number, c: any) => s + (c.advance || 0), 0).toLocaleString()}</span></div></div>
                </div>
              </div>

              {/* Outstanding invoices */}
              <div className="lg:col-span-2">
                {selectedCreditCustomer ? (<div>
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-slate-800">{selectedCreditCustomer.name}</h3>
                    <button onClick={() => setEditingCustomer({...selectedCreditCustomer})} className="text-xs font-semibold text-blue-600 px-3 py-1.5 rounded border border-blue-200 hover:bg-blue-50">✏️ Edit</button>
                  </div>
                  {(selectedCreditCustomer.phone || selectedCreditCustomer.email || selectedCreditCustomer.address) && (
                    <div className="text-xs text-slate-400 mb-2 space-y-0.5">
                      {selectedCreditCustomer.phone && <p>📞 {selectedCreditCustomer.phone}</p>}
                      {selectedCreditCustomer.email && <p>📧 {selectedCreditCustomer.email}</p>}
                      {selectedCreditCustomer.address && <p>📍 {selectedCreditCustomer.address}</p>}
                    </div>
                  )}
                  <div className="flex gap-3 mb-4 flex-wrap">
                    {selectedCreditCustomer.credit?.balance > 0 && <span className="text-sm font-bold text-red-600 bg-red-50 px-3 py-1 rounded-lg">Owes: Rs.{selectedCreditCustomer.credit.balance.toLocaleString()}</span>}
                    {selectedCreditCustomer.advance > 0 && <span className="text-sm font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-lg">Advance: Rs.{selectedCreditCustomer.advance.toLocaleString()}</span>}
                  </div>

                  {/* Report buttons */}
                  {outstandingSales.length > 0 && (
                    <div className="flex gap-2 mb-4 flex-wrap">
                      <button onClick={() => printCreditReport(selectedCreditCustomer, outstandingSales, data?.vendor)} className="text-xs font-semibold text-slate-600 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">📄 Print Statement</button>
                      <button onClick={() => sendWhatsAppCreditReport(selectedCreditCustomer, outstandingSales, data?.vendor)} className="text-xs font-semibold text-green-600 px-3 py-2 rounded-lg border border-green-200 hover:bg-green-50">💬 WhatsApp Statement</button>
                      {selectedCreditCustomer.advance > 0 && selectedCreditCustomer.credit?.balance > 0 && (
                        <button onClick={() => handleAutoOffset(selectedCreditCustomer.id)} className="text-xs font-semibold text-cyan-700 px-3 py-2 rounded-lg border border-cyan-300 bg-cyan-50 hover:bg-cyan-100">⚡ Auto-Offset (Apply Rs.{Math.min(selectedCreditCustomer.advance, selectedCreditCustomer.credit.balance).toLocaleString()} advance)</button>
                      )}
                      <button onClick={() => setBulkSettleMode(!bulkSettleMode)} className="text-xs font-semibold text-purple-700 px-3 py-2 rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100">{bulkSettleMode ? '✕ Cancel' : '💰 Lump Payment'}</button>
                    </div>
                  )}

                  {/* Bulk settle UI */}
                  {bulkSettleMode && outstandingSales.length > 0 && (
                    <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 mb-4">
                      <h4 className="font-bold text-sm text-purple-800 mb-2">Lump Settlement — applies to oldest invoices first</h4>
                      <p className="text-xs text-purple-600 mb-3">Total outstanding: Rs.{outstandingSales.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0).toLocaleString()}</p>
                      <div className="space-y-2">
                        {bulkSettlePayments.map((line, i) => (
                          <div key={`bulk-pay-${i}`} className="flex gap-2 items-start flex-wrap">
                            <select value={line.method} onChange={e => { const u = [...bulkSettlePayments]; u[i] = { ...u[i], method: e.target.value }; setBulkSettlePayments(u) }} className="px-2 py-2 rounded-lg border-2 border-slate-200 text-xs font-bold outline-none flex-shrink-0">
                              {PAY_METHODS.map(m => <option key={m} value={m}>{PAY_LABELS[m]}</option>)}
                            </select>
                            <input type="text" inputMode="numeric" value={line.amount} onChange={e => { const val = e.target.value.replace(/[^0-9.]/g, ''); const u = [...bulkSettlePayments]; u[i] = { ...u[i], amount: val }; setBulkSettlePayments(u) }} className="w-32 px-2 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-purple-400" placeholder="Amount" />
                            {line.method === 'cheque' && (<>
                              <input type="text" value={line.chequeNumber} onChange={e => { const u = [...bulkSettlePayments]; u[i] = { ...u[i], chequeNumber: e.target.value }; setBulkSettlePayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Cheque #" />
                              <input type="date" value={line.chequeDate} onChange={e => { const u = [...bulkSettlePayments]; u[i] = { ...u[i], chequeDate: e.target.value }; setBulkSettlePayments(u) }} className="px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" />
                            </>)}
                            {line.method === 'bank' && <input type="text" value={line.bankRef} onChange={e => { const u = [...bulkSettlePayments]; u[i] = { ...u[i], bankRef: e.target.value }; setBulkSettlePayments(u) }} className="w-28 px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none" placeholder="Ref #" />}
                            {bulkSettlePayments.length > 1 && <button onClick={() => setBulkSettlePayments(bulkSettlePayments.filter((_, x) => x !== i))} className="text-red-400 hover:text-red-600 text-sm font-bold px-1">✕</button>}
                          </div>
                        ))}
                        <div className="flex gap-3">
                          <button onClick={() => setBulkSettlePayments([...bulkSettlePayments, { method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])} className="text-xs font-bold text-blue-600">+ Add Method</button>
                          <button onClick={() => { const total = outstandingSales.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0); const u = [...bulkSettlePayments]; u[u.length - 1] = { ...u[u.length - 1], amount: String(total) }; setBulkSettlePayments(u) }} className="text-xs font-bold text-orange-600">Fill full balance</button>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button onClick={handleBulkSettle} disabled={bulkSettleLoading} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">{bulkSettleLoading ? 'Processing...' : '💰 Apply Payment'}</button>
                        <p className="text-xs text-purple-500 self-center">Excess amount will be added to advance</p>
                      </div>
                    </div>
                  )}

                  {/* Outstanding invoices */}
                  {outstandingSales.length > 0 && (<div className="mb-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Outstanding Invoices</h4>
                    <div className="space-y-3">{outstandingSales.map((sale: any) => (
                      <div key={sale.id} className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div><span className="font-mono text-xs font-bold bg-slate-100 px-2 py-1 rounded">{sale.invoice_no}</span><span className="text-xs text-slate-400 ml-2">{formatDateShort(sale.created_at)}</span></div>
                          <div className="text-right"><p className="text-xs text-slate-400">Total: Rs.{parseFloat(sale.total).toLocaleString()}</p><p className="text-xs text-green-600">Paid: Rs.{parseFloat(sale.paid_amount).toLocaleString()}</p><p className="font-black text-red-600">Due: Rs.{parseFloat(sale.balance_due).toLocaleString()}</p></div>
                        </div>
                        <div className="text-xs text-slate-500 mb-2">{(sale.items || []).map((i: any) => `${i.product_name} x${i.quantity}`).join(', ')}</div>
                        {sale.payments && sale.payments.length > 0 && (<div className="text-xs text-slate-400 mb-2">Payments: {sale.payments.map((p: any) => `${PAY_LABELS[p.payment_method] || p.payment_method} Rs.${parseFloat(p.amount).toLocaleString()}${p.cheque_number ? ' #' + p.cheque_number : ''}`).join(' + ')}</div>)}
                        <button onClick={() => { setSettleSale(sale); setSettlePayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]) }} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-4 py-2 rounded-lg">💰 Record Payment</button>
                      </div>
                    ))}</div>
                  </div>)}

                  {outstandingSales.length === 0 && selectedCreditCustomer.credit?.balance <= 0 && (
                    <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center mb-4">
                      <p className="text-emerald-600 font-semibold">No outstanding invoices</p>
                    </div>
                  )}

                </div>) : (<div className="bg-white rounded-xl border border-slate-200 p-8 text-center"><p className="text-3xl opacity-20">👈</p><p className="text-slate-400 font-semibold mt-2">Select a customer</p></div>)}
              </div>
            </div>
          )}
        </div>)}

        {/* RETURN ITEMS MODAL */}
        {returnModal && (
          <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setReturnModal(null)}>
            <div className="bg-white rounded-2xl max-w-md w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="bg-amber-50 px-5 py-4 border-b border-amber-100 flex-shrink-0">
                <h3 className="font-bold text-base text-amber-800">↩ Return Items</h3>
                <p className="text-xs text-amber-600 mt-1">{returnModal.invoice_no} · {returnModal.customer_name}</p>
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
                        <button onClick={() => handleReturn('advance')} disabled={returnLoading}
                          className="w-full text-left px-4 py-3 rounded-xl border-2 border-emerald-200 bg-emerald-50 active:bg-emerald-100 transition disabled:opacity-50">
                          <div className="font-bold text-sm text-emerald-800">💰 Add Rs.{totalRefund.toLocaleString()} to Advance</div>
                          <p className="text-xs text-emerald-600 mt-0.5">Customer can use it for future purchases</p>
                        </button>
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
                <button onClick={() => setReturnModal(null)} className="w-full text-sm font-semibold text-slate-500 py-2 active:text-slate-700">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* VOID SALE MODAL */}
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

            {/* Staff */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-sm mb-1">Staff / Multi-User</h3>
              <p className="text-xs text-slate-400 mb-3">Add cashiers who can use POS.</p>
              <div className="bg-slate-50 rounded-lg p-3 mb-3">
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <input type="text" value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })} placeholder="Name" className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  <input type="email" value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })} placeholder="Email" className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })} className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">
                    <option value="cashier">Cashier (POS only)</option>
                    <option value="manager">Manager (Full access)</option>
                  </select>
                  <input type="text" value={newStaff.pin} onChange={e => setNewStaff({ ...newStaff, pin: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="4-digit PIN" className="px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" maxLength={4} />
                </div>
                <button onClick={addStaffMember} className="bg-blue-500 active:bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg w-full">+ Add Staff</button>
              </div>
              {staffLoading ? <div className="text-center py-4"><div className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> :
                staffList.length === 0 ? <p className="text-xs text-slate-400 text-center py-3">No staff yet — you're the sole owner.</p> :
                <div className="space-y-2">{staffList.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2.5">
                    <div><p className="font-semibold text-sm">{s.name}</p><p className="text-[10px] text-slate-400">{s.email}</p></div>
                    <div className="flex gap-2 items-center">
                      <span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (s.role === 'manager' ? 'bg-purple-100 text-purple-600' : 'bg-blue-100 text-blue-600')}>{s.role}</span>
                      <button onClick={() => removeStaff(s.id)} className="text-red-400 text-xs font-bold">✕</button>
                    </div>
                  </div>
                ))}</div>
              }
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <p className="text-[10px] text-amber-700"><strong>Cashiers</strong> can only use POS. <strong>Managers</strong> get full access except settings. All actions are logged.</p>
              </div>

              {staffTempPassword && (
                <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setStaffTempPassword(null)}>
                  <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
                    <div className="text-center mb-4">
                      <div className="text-4xl mb-2">🔐</div>
                      <h3 className="text-lg font-black text-slate-900">Staff Account Ready</h3>
                      <p className="text-xs text-slate-400 mt-1">Share these login details with <strong>{staffTempPassword.name}</strong></p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-4 space-y-3 mb-4">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Login URL</p>
                        <p className="text-sm font-mono font-semibold text-slate-700">kuruma.lk/login</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Email</p>
                        <p className="text-sm font-mono font-semibold text-slate-700">{staffTempPassword.email}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Temporary Password</p>
                        <div className="flex items-center gap-2">
                          <p className="text-lg font-mono font-black text-orange-600 tracking-wider">{staffTempPassword.password}</p>
                          <button onClick={() => { navigator.clipboard.writeText(staffTempPassword.password); showToast('Copied!') }} className="text-[10px] font-bold text-slate-400 hover:text-slate-600 px-2 py-1 rounded border border-slate-200">Copy</button>
                        </div>
                      </div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 mb-4">
                      <p className="text-[10px] text-amber-700">Save this password — it won't be shown again. Staff should change it after first login.</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { const msg = encodeURIComponent('Hi ' + staffTempPassword.name + ',\n\nYour kuruma.lk staff account is ready:\n\nLogin: https://kuruma.lk/login\nEmail: ' + staffTempPassword.email + '\nPassword: ' + staffTempPassword.password + '\n\nPlease change your password after first login.'); window.open('https://wa.me/?text=' + msg, '_blank') }} className="flex-1 bg-green-500 text-white font-bold text-sm py-2.5 rounded-xl">Send via WhatsApp</button>
                      <button onClick={() => setStaffTempPassword(null)} className="px-4 text-slate-500 text-sm font-semibold">Done</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>)}

      </main>
    </div>
  )
}
