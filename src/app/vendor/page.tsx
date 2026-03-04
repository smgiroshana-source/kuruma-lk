'use client'

import { useState, useEffect, useRef } from 'react'

type VendorTab = 'overview' | 'products' | 'add' | 'bulk' | 'pos' | 'sales' | 'credit' | 'settings'
const CATEGORIES = ['Engine Parts','Transmission','Brakes','Suspension','Electrical','Body Parts','Interior','Exhaust','Cooling System','Fuel System','Steering','Wheels & Tires','Lighting','AC & Heating','Other']
const CONDITIONS = ['Excellent','Good','Fair','Salvage']
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
  const partId = row.id || row.part_id || row.sku || row.partid || row.part_no || ''
  return { partId: partId.trim(), name: row.name || row.product_name || row.part_name || '', description: row.description || row.desc || '', category: row.category || 'Other', make: row.make || row.vehicle_make || row.brand || '', model: row.model || row.vehicle_model || '', year: row.year || row.vehicle_year || '', condition: row.condition || 'Good', price: row.price || row.unit_price || '', quantity: row.quantity || row.qty || row.stock || '1', show_price: (row.show_price || 'true').toLowerCase() !== 'false', hasImage: false, imageCount: 0, imageFiles: [] as File[], autoId: false }
}
async function extractZipImages(file: File): Promise<Map<string, File[]>> {
  const JSZip = (await import('jszip')).default; const zip = await JSZip.loadAsync(file); const map = new Map<string, File[]>()
  for (const [path, entry] of Object.entries(zip.files)) { if (entry.dir || path.startsWith('__MACOSX') || path.includes('/._') || path.startsWith('.')) continue; const ext = path.split('.').pop()?.toLowerCase() || ''; if (!['jpg','jpeg','png','gif','webp','bmp'].includes(ext)) continue; const parts = path.split('/').filter(p => p.length > 0); if (parts.length < 2) continue; const folder = parts[parts.length - 2]; const blob = await entry.async('blob'); const f = new File([blob], parts[parts.length - 1], { type: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) }); if (!map.has(folder)) map.set(folder, []); map.get(folder)!.push(f) }
  return map
}
function formatDate(d: string) { return new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function formatDateShort(d: string) { return new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' }) }

function printInvoice(sale: any, vendor: any, format: 'a4' | 'thermal', settings?: any) {
  const items = sale.items || []; const payments = sale.payments || []; const isThermal = format === 'thermal'; const w = isThermal ? 300 : 800
  const s = settings || {}
  const shopName = s.invoice_title || vendor?.name || 'kuruma.lk'
  const logoHtml = (s.logo_url && s.invoice_show_logo !== false && !isThermal) ? `<img src="${s.logo_url}" style="height:${isThermal ? '30px' : '60px'};max-width:${isThermal ? '60px' : '120px'};object-fit:contain;margin-bottom:4px" />` : ''
  const thermalLogoHtml = (s.logo_url && s.invoice_show_logo !== false && isThermal) ? `<img src="${s.logo_url}" style="height:30px;max-width:60px;object-fit:contain;margin-bottom:2px" />` : ''
  const taxLine = s.tax_id ? `<div style="font-size:${isThermal ? '9px' : '11px'};color:#888">Tax/VAT: ${s.tax_id}</div>` : ''
  const emailLine = s.email ? `<div style="font-size:${isThermal ? '9px' : '11px'};color:#888">${s.email}</div>` : ''
  const footerText = s.invoice_footer || 'Thank you for your business!'
  const termsHtml = (!isThermal && s.invoice_terms) ? `<div style="margin-top:12px;padding:10px;background:#f8fafc;border-radius:6px;font-size:10px;color:#94a3b8;line-height:1.5"><strong style="color:#64748b">Terms & Conditions:</strong><br/>${s.invoice_terms.replace(/\n/g, '<br/>')}</div>` : ''
  const paymentLines = payments.map((p: any) => `<div style="display:flex;justify-content:space-between;font-size:${isThermal ? '10px' : '12px'}"><span>${(p.payment_method || 'cash').toUpperCase()}${p.cheque_number ? ' #' + p.cheque_number : ''}</span><span>Rs.${parseFloat(p.amount).toLocaleString()}</span></div>`).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${sale.invoice_no}</title>
<style>@page{size:${isThermal ? '80mm auto' : 'A4'};margin:${isThermal ? '2mm' : '15mm'}}*{margin:0;padding:0;box-sizing:border-box}body{font-family:${isThermal ? "'Courier New',monospace" : "'Segoe UI',Arial,sans-serif"};font-size:${isThermal ? '12px' : '14px'};color:#333;width:${w}px;max-width:100%;margin:0 auto}.header{text-align:center;padding:${isThermal ? '5px 0' : '20px 0'};border-bottom:${isThermal ? '1px dashed #000' : '2px solid #f97316'}}.shop-name{font-size:${isThermal ? '16px' : '24px'};font-weight:900}table{width:100%;border-collapse:collapse;margin:${isThermal ? '5px 0' : '15px 0'}}th{text-align:left;font-size:${isThermal ? '10px' : '12px'};padding:${isThermal ? '3px 2px' : '8px 5px'};border-bottom:${isThermal ? '1px dashed #000' : '2px solid #eee'}}td{padding:${isThermal ? '3px 2px' : '8px 5px'};font-size:${isThermal ? '11px' : '13px'};border-bottom:1px solid ${isThermal ? '#ddd' : '#f0f0f0'}}.text-right{text-align:right}.totals{${isThermal ? 'border-top:1px dashed #000;' : 'border-top:2px solid #eee;'}padding-top:${isThermal ? '5px' : '10px'}}.total-row{display:flex;justify-content:space-between;padding:${isThermal ? '2px 0' : '5px 0'}}.grand-total{font-weight:900;font-size:${isThermal ? '16px' : '22px'};${isThermal ? 'border-top:1px dashed #000;border-bottom:1px dashed #000;' : 'border-top:2px solid #333;'}padding:${isThermal ? '5px 0' : '10px 0'};margin-top:5px}.footer{text-align:center;padding:${isThermal ? '8px 0 5px' : '20px 0'};color:#888;font-size:${isThermal ? '10px' : '12px'};border-top:${isThermal ? '1px dashed #000' : '1px solid #eee'};margin-top:${isThermal ? '5px' : '15px'}}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<div class="header">${isThermal ? thermalLogoHtml : logoHtml}<div class="shop-name">${shopName}</div>${vendor?.location ? `<div style="font-size:${isThermal ? '10px' : '12px'};color:#666">${vendor.location}${vendor?.address ? ', ' + vendor.address : ''}</div>` : ''}${vendor?.phone ? `<div style="font-size:${isThermal ? '10px' : '12px'};color:#666">Tel: ${vendor.phone}${vendor?.whatsapp && vendor.whatsapp !== vendor.phone ? ' | WhatsApp: ' + vendor.whatsapp : ''}</div>` : ''}${taxLine}${emailLine}</div>
<div style="padding:${isThermal ? '5px 0' : '15px 0'}"><div><small style="color:#888">Invoice:</small> <strong>${sale.invoice_no}</strong></div><div><small style="color:#888">Date:</small> ${formatDate(sale.created_at)}</div><div><small style="color:#888">Customer:</small> ${sale.customer_name}${sale.customer_phone ? ' (' + sale.customer_phone + ')' : ''}</div></div>
<table><thead><tr><th>Item</th><th class="text-right">Qty</th><th class="text-right">Price</th><th class="text-right">Total</th></tr></thead><tbody>${items.map((i: any) => `<tr><td>${i.product_sku ? i.product_sku + ' - ' : ''}${i.product_name}</td><td class="text-right">${i.quantity}</td><td class="text-right">Rs.${parseFloat(i.unit_price).toLocaleString()}</td><td class="text-right">Rs.${parseFloat(i.total).toLocaleString()}</td></tr>`).join('')}</tbody></table>
<div class="totals"><div class="total-row"><span>Subtotal</span><span>Rs.${parseFloat(sale.subtotal).toLocaleString()}</span></div>${parseFloat(sale.discount) > 0 ? `<div class="total-row" style="color:#e11d48"><span>Discount</span><span>-Rs.${parseFloat(sale.discount).toLocaleString()}</span></div>` : ''}<div class="total-row grand-total"><span>TOTAL</span><span>Rs.${parseFloat(sale.total).toLocaleString()}</span></div></div>
${paymentLines ? `<div style="margin-top:8px"><div style="font-size:${isThermal ? '10px' : '12px'};font-weight:bold;color:#888;margin-bottom:3px">PAYMENTS</div>${paymentLines}</div>` : ''}
${parseFloat(sale.balance_due) > 0 ? `<div style="text-align:center;font-weight:900;color:#dc2626;font-size:${isThermal ? '14px' : '18px'};margin-top:8px;padding:5px;border:2px solid #dc2626;border-radius:4px">BALANCE DUE: Rs.${parseFloat(sale.balance_due).toLocaleString()}</div>` : ''}
${termsHtml}
<div class="footer"><p>${footerText}</p><p style="margin-top:3px;font-size:${isThermal ? '8px' : '10px'};color:#ccc">Powered by kuruma.lk</p></div></body></html>`
  const win = window.open('', '_blank', `width=${w + 50},height=700`); if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 300) }
}

function sendWhatsAppBill(sale: any, vendor: any, phone: string) {
  const items = (sale.items || []).map((i: any) => `• ${i.product_sku || ''} ${i.product_name} x${i.quantity} = Rs.${parseFloat(i.total).toLocaleString()}`).join('%0A')
  const payments = (sale.payments || []).map((p: any) => `  ${(p.payment_method || 'cash').toUpperCase()}: Rs.${parseFloat(p.amount).toLocaleString()}`).join('%0A')
  let msg = `*Invoice: ${sale.invoice_no}*%0A${vendor?.name || 'kuruma.lk'}%0A${formatDate(sale.created_at)}%0A%0A${items}%0A%0ASubtotal: Rs.${parseFloat(sale.subtotal).toLocaleString()}`
  if (parseFloat(sale.discount) > 0) msg += `%0ADiscount: -Rs.${parseFloat(sale.discount).toLocaleString()}`
  msg += `%0A*TOTAL: Rs.${parseFloat(sale.total).toLocaleString()}*`
  if (payments) msg += `%0A%0APayments:%0A${payments}`
  if (parseFloat(sale.balance_due) > 0) msg += `%0A%0A⚠️ *BALANCE DUE: Rs.${parseFloat(sale.balance_due).toLocaleString()}*`
  msg += `%0A%0AThank you! - ${vendor?.name || 'kuruma.lk'}`
  window.open(`https://wa.me/${phone.replace(/[^0-9+]/g, '')}?text=${msg}`, '_blank')
}

export default function VendorDashboard() {
  const [tab, setTab] = useState<VendorTab>('overview')
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [toast, setToast] = useState('')
  const [editingProduct, setEditingProduct] = useState<any>(null)
  const [productSearch, setProductSearch] = useState('')

  const [newProduct, setNewProduct] = useState({ partId:'', name:'', description:'', category:'Other', make:'', model:'', year:'', condition:'Good', price:'', quantity:'1', show_price:true })
  const [productImages, setProductImages] = useState<File[]>([])
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [addLoading, setAddLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [bulkData, setBulkData] = useState<any[]>([])
  const [bulkFile, setBulkFile] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [zipFile, setZipFile] = useState('')
  const [zipProcessing, setZipProcessing] = useState(false)
  const [zipSummary, setZipSummary] = useState<any>(null)
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
  const [posLoading, setPosLoading] = useState(false)
  const [posReceipt, setPosReceipt] = useState<any>(null)
  const [useAdvance, setUseAdvance] = useState(false)

  // Sales
  const [salesData, setSalesData] = useState<any>(null)
  const [salesPeriod, setSalesPeriod] = useState('today')
  const [salesLoading, setSalesLoading] = useState(false)
  const [expandedSale, setExpandedSale] = useState<string | null>(null)
  const [salesView, setSalesView] = useState('overview')
  const [customerHistoryId, setCustomerHistoryId] = useState<string | null>(null)
  const [customerHistoryName, setCustomerHistoryName] = useState('')
  const [customerHistory, setCustomerHistory] = useState<any[] | null>(null)

  // Credit
  const [creditCustomers, setCreditCustomers] = useState<any[]>([])
  const [creditLoading, setCreditLoading] = useState(false)
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
  const [editingCustomer, setEditingCustomer] = useState<any>(null)
  const [editCustomerLoading, setEditCustomerLoading] = useState(false)

  useEffect(() => { fetchData(); fetchSettings() }, [])
  useEffect(() => { if (tab === 'sales') fetchSales() }, [tab, salesPeriod])
  useEffect(() => { if (tab === 'credit') fetchCreditCustomers() }, [tab])
  useEffect(() => {
    if (!customerHistoryId) { setCustomerHistory(null); return }
    fetch(`/api/vendor/sales?customer_id=${customerHistoryId}`).then(r => r.json()).then(j => setCustomerHistory(j.sales || [])).catch(() => setCustomerHistory([]))
  }, [customerHistoryId])

  useEffect(() => {
    if (tab === 'settings') {
      fetchSettings()
      fetchStaff()
    }
  }, [tab])

  async function fetchSettings() {
    try {
      const res = await fetch('/api/vendor/settings')
      if (res.ok) { const j = await res.json(); if (j.settings) setVendorSettings({ ...vendorSettings, ...j.settings }) }
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
      const res = await fetch('/api/vendor/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_vendor', ...fields }) })
      if (res.ok) { showToast('Shop info updated!'); fetchData() }
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
      if (res.ok) { showToast('Staff added!'); setNewStaff({ email: '', name: '', role: 'cashier', pin: '' }); fetchStaff() }
      else { const j = await res.json(); showToast(j.error || 'Failed') }
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
  async function fetchCreditCustomers() { setCreditLoading(true); try { const r = await fetch('/api/vendor/customers?credit=true'); if (r.ok) { const j = await r.json(); setCreditCustomers((j.customers || []).filter((c: any) => c.credit?.balance > 0 || c.advance > 0)) } } catch {} setCreditLoading(false) }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(''), 4000) }
  async function handleSignOut() { await fetch("/api/auth/logout", { method: "POST" }); window.location.href = '/' }

  async function productAction(action: string, productId: string, updateData?: any) {
    setActionLoading(productId); try { const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, productId, data: updateData }) }); const j = await r.json(); if (j.success) { showToast(j.message); await fetchData(); setEditingProduct(null) } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setActionLoading(null)
  }
  async function uploadImagesForProduct(productId: string, images: File[]) { for (let i = 0; i < images.length; i++) { const c = await compressImage(images[i]); const fd = new FormData(); fd.append('image', c); fd.append('productId', productId); fd.append('isPrimary', i === 0 ? 'true' : 'false'); await fetch('/api/vendor/upload', { method: 'POST', body: fd }) } }

  // Product handlers
  async function handleAddProduct(e: React.FormEvent) { e.preventDefault(); if (!newProduct.name.trim()) { showToast('Name required'); return }; setAddLoading(true); const partId = newProduct.partId.trim() || generatePartId(); try { const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', data: { ...newProduct, sku: partId } }) }); const j = await r.json(); if (j.success && j.product) { if (productImages.length > 0) { showToast('Uploading images...'); await uploadImagesForProduct(j.product.id, productImages) }; showToast('Product added!'); setNewProduct({ partId:'', name:'', description:'', category:'Other', make:'', model:'', year:'', condition:'Good', price:'', quantity:'1', show_price:true }); setProductImages([]); setImagePreviews([]); await fetchData(); setTab('products') } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setAddLoading(false) }
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) { const files = Array.from(e.target.files || []); setProductImages(p => [...p, ...files]); files.forEach(f => { const r = new FileReader(); r.onload = ev => setImagePreviews(p => [...p, ev.target?.result as string]); r.readAsDataURL(f) }) }
  function removeImage(i: number) { setProductImages(p => p.filter((_, x) => x !== i)); setImagePreviews(p => p.filter((_, x) => x !== i)) }

  // Bulk handlers
  function handleBulkFileUpload(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f) return; setBulkFile(f.name); setZipFile(''); setZipSummary(null); const r = new FileReader(); r.onload = ev => { const rows = parseCSV(ev.target?.result as string).map(mapCSVRow); setBulkData(rows.map(row => ({ ...row, partId: row.partId || generatePartId(), autoId: !row.partId }))) }; r.readAsText(f) }
  async function handleZipUpload(e: React.ChangeEvent<HTMLInputElement>) { const f = e.target.files?.[0]; if (!f || bulkData.length === 0) { showToast('Upload CSV first'); return }; setZipFile(f.name); setZipProcessing(true); try { const map = await extractZipImages(f); const idMap = new Map<string, number>(); bulkData.forEach((r, i) => idMap.set(r.partId.toLowerCase(), i)); let matched = 0, unmatched = 0, totalImages = 0; const unmatchedFolders: string[] = []; const ud = bulkData.map(r => ({ ...r, imageFiles: [] as File[], hasImage: false, imageCount: 0 })); for (const [folder, files] of map) { const idx = idMap.get(folder.toLowerCase()); if (idx !== undefined) { ud[idx].imageFiles = files; ud[idx].hasImage = true; ud[idx].imageCount = files.length; matched++; totalImages += files.length } else { unmatched++; unmatchedFolders.push(folder) } }; setBulkData(ud); setZipSummary({ matched, unmatched, unmatchedFolders, totalImages }); showToast(matched + ' matched') } catch { showToast('ZIP error') } setZipProcessing(false) }
  function updateBulkRow(i: number, k: string, v: string) { setBulkData(p => { const u = [...p]; u[i] = { ...u[i], [k]: v }; return u }) }
  function removeBulkRow(i: number) { setBulkData(p => p.filter((_, x) => x !== i)) }
  async function handleBulkImport() { if (!bulkData.length) return; const noImg = bulkData.filter(r => !r.hasImage).length; if (noImg > 0 && !confirm(noImg + ' without images. Continue?')) return; setBulkLoading(true); try { const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk_create', products: bulkData.map(row => ({ sku: row.partId, name: row.name, description: row.description, category: row.category, make: row.make, model: row.model, year: row.year, condition: row.condition, price: row.price, quantity: row.quantity, show_price: row.show_price })) }) }); const j = await r.json(); if (j.success && j.products) { let ic = 0; for (let i = 0; i < j.products.length; i++) { const row = bulkData[i]; if (row?.imageFiles?.length > 0) { await uploadImagesForProduct(j.products[i].id, row.imageFiles); ic += row.imageFiles.length } }; showToast(j.count + ' products, ' + ic + ' images!'); setBulkData([]); setBulkFile(''); setZipFile(''); setZipSummary(null); await fetchData(); setTab('products') } else showToast('Error: ' + j.error) } catch { showToast('Network error') } setBulkLoading(false) }

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
    setPosLoading(true)
    try {
      const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'create_sale', customerId: posCustomer.id, customerName: posCustomer.name || 'Walk-in Customer', customerPhone: posCustomer.phone,
        items: posCart.map(i => ({ productId: i.productId, productName: i.productName, productSku: i.productSku, quantity: i.quantity, unitPrice: i.unitPrice })),
        discount: posDiscountAmt, payments: posPayments.filter(p => parseFloat(p.amount) > 0), notes: posNotes || null, useAdvance,
      }) })
      const j = await r.json()
      if (j.success) { setPosReceipt({ sale: j.sale, vendor: data?.vendor, advanceUsed: j.advanceUsed, appliedToOutstanding: j.appliedToOutstanding, settledInvoices: j.settledInvoices, newAdvance: j.newAdvance }); showToast(j.message); setPosCart([]); setPosCustomer({ id: null, name: '', phone: '', advance: 0, outstanding: 0 }); setPosDiscount(''); setPosPayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]); setPosNotes(''); setUseAdvance(false); await fetchData() }
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

  async function voidSale(saleId: string) { if (!confirm('Void this sale?')) return; try { const r = await fetch('/api/vendor/sales', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'void_sale', saleId }) }); const j = await r.json(); if (j.success) { showToast(j.message); fetchSales(); fetchData() } else showToast('Error: ' + j.error) } catch { showToast('Network error') } }

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
    const phone = customer.whatsapp || customer.phone
    if (!phone) { showToast('No phone number for this customer'); return }

    let msg = `*CREDIT STATEMENT*%0A${vendorInfo?.name || 'kuruma.lk'}%0ADate: ${new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })}%0A%0ADear ${customer.name},%0A%0AHere is your outstanding balance:%0A`
    sales.forEach((s: any) => {
      msg += `%0A📋 *${s.invoice_no}* (${formatDateShort(s.created_at)})%0A`
      msg += `   Total: Rs.${parseFloat(s.total).toLocaleString()} | Paid: Rs.${parseFloat(s.paid_amount).toLocaleString()}%0A`
      msg += `   *Due: Rs.${parseFloat(s.balance_due).toLocaleString()}*%0A`
    })
    msg += `%0A━━━━━━━━━━━━━━━━%0A*TOTAL OUTSTANDING: Rs.${totalDue.toLocaleString()}*%0A`
    if (parseFloat(customer.advance_balance || 0) > 0) msg += `Advance Balance: Rs.${parseFloat(customer.advance_balance || 0).toLocaleString()}%0A`
    msg += `%0APlease settle at your earliest convenience.%0AThank you! - ${vendorInfo?.name || 'kuruma.lk'}`

    window.open(`https://wa.me/${phone.replace(/[^0-9+]/g, '')}?text=${msg}`, '_blank')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /></div>
  if (!data) return null
  const { vendor, products, stats } = data
  const filteredProducts = products.filter((p: any) => { if (!productSearch) return true; const s = productSearch.toLowerCase(); return p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.make || '').toLowerCase().includes(s) })
  const posFilteredProducts = products.filter((p: any) => { if (!posSearch || posSearch.length < 2) return false; const s = posSearch.toLowerCase(); return (p.name.toLowerCase().includes(s) || (p.sku || '').toLowerCase().includes(s) || (p.make || '').toLowerCase().includes(s)) && p.quantity > 0 })

  // Payment lines are rendered inline to avoid focus loss

  return (
    <div className="min-h-screen bg-slate-50">
      {toast && <div className="fixed top-4 right-4 z-[100] bg-slate-900 text-white px-4 py-2.5 rounded-lg shadow-lg text-sm font-semibold max-w-sm">{toast}</div>}

      <header className="bg-white border-b border-slate-200 sticky top-0 z-50"><div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-3"><a href="/" className="text-xl font-black text-orange-500">kuruma.lk</a><span className="bg-purple-100 text-purple-700 text-xs font-bold px-2 py-0.5 rounded-full">VENDOR</span><span className="text-sm font-semibold text-slate-600 hidden sm:inline">{vendor.name}</span></div><div className="flex items-center gap-3"><a href="/" className="text-sm text-slate-400 hover:text-slate-600">View Store</a><button onClick={handleSignOut} className="text-sm text-red-500 hover:text-red-600 font-semibold">Log Out</button></div></div></header>

      <div className="bg-white border-b border-slate-200"><div className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto">
        {([{key:'overview' as VendorTab,l:'Overview'},{key:'products' as VendorTab,l:'Products'},{key:'add' as VendorTab,l:'+ Add'},{key:'bulk' as VendorTab,l:'Bulk'},{key:'pos' as VendorTab,l:'🧾 POS'},{key:'sales' as VendorTab,l:'📊 Sales'},{key:'credit' as VendorTab,l:'💳 Credit'},{key:'settings' as VendorTab,l:'⚙️'}]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-3 text-sm font-bold border-b-2 transition whitespace-nowrap ${tab === t.key ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>{t.l}</button>
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
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3"><h1 className="text-2xl font-black text-slate-900">Products</h1><div className="flex gap-2"><input type="text" placeholder="Search..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="px-4 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 w-56" /><button onClick={() => setTab('add')} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg">+ Add</button></div></div>
          {editingProduct && (<div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={() => setEditingProduct(null)}><div className="bg-white rounded-2xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}><h3 className="text-lg font-bold mb-4">Edit Product</h3><div className="space-y-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Part ID</label><input value={editingProduct.sku || ''} onChange={e => setEditingProduct({...editingProduct, sku: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none font-mono" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Name</label><input value={editingProduct.name} onChange={e => setEditingProduct({...editingProduct, name: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Price</label><input type="number" value={editingProduct.price || ''} onChange={e => setEditingProduct({...editingProduct, price: e.target.value ? parseInt(e.target.value) : null})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Qty</label><input type="number" value={editingProduct.quantity} onChange={e => setEditingProduct({...editingProduct, quantity: parseInt(e.target.value) || 0})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div><div className="grid grid-cols-3 gap-3"><div><label className="block text-xs font-semibold text-slate-500 mb-1">Make</label><input value={editingProduct.make || ''} onChange={e => setEditingProduct({...editingProduct, make: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Model</label><input value={editingProduct.model || ''} onChange={e => setEditingProduct({...editingProduct, model: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Condition</label><select value={editingProduct.condition} onChange={e => setEditingProduct({...editingProduct, condition: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">{CONDITIONS.map(c => <option key={c}>{c}</option>)}</select></div></div><div><label className="block text-xs font-semibold text-slate-500 mb-1">Category</label><select value={editingProduct.category} onChange={e => setEditingProduct({...editingProduct, category: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></div></div><div className="flex gap-2 mt-5"><button onClick={() => productAction('update', editingProduct.id, { sku: editingProduct.sku, name: editingProduct.name, price: editingProduct.price, quantity: editingProduct.quantity, make: editingProduct.make, model: editingProduct.model, condition: editingProduct.condition, category: editingProduct.category })} disabled={actionLoading === editingProduct.id} className="bg-orange-500 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">Save</button><button onClick={() => setEditingProduct(null)} className="text-slate-500 text-sm px-4 py-2">Cancel</button></div></div></div>)}
          {products.length === 0 ? <div className="text-center py-16 bg-white rounded-xl border border-slate-200"><p className="text-4xl mb-3">📦</p><p className="text-slate-500 font-semibold">No products</p></div> : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50 text-left"><th className="px-4 py-3 text-xs font-bold text-slate-500">Image</th><th className="px-4 py-3 text-xs font-bold text-slate-500">ID</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Product</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Price</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Stock</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Status</th><th className="px-4 py-3 text-xs font-bold text-slate-500">Actions</th></tr></thead><tbody>
              {filteredProducts.map((p: any, i: number) => { const img = p.images?.find((x: any) => x.sort_order === 0) || p.images?.[0]; return (<tr key={p.id} className={'border-t border-slate-100 ' + (i % 2 ? 'bg-slate-50/50' : '')}><td className="px-4 py-2.5">{img ? <img src={img.url} alt="" className="w-12 h-12 rounded-lg object-cover" /> : <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center text-xl">🔧</div>}</td><td className="px-4 py-2.5"><span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded font-semibold">{p.sku}</span></td><td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{p.name}</div><div className="text-xs text-slate-400">{p.make && p.make + ' ' + (p.model || '')}</div></td><td className="px-4 py-2.5 font-bold text-orange-600">{p.price ? 'Rs.' + p.price.toLocaleString() : 'Ask'}</td><td className="px-4 py-2.5">{p.quantity}</td><td className="px-4 py-2.5"><span className={'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (p.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>{p.is_active ? 'ACTIVE' : 'HIDDEN'}</span></td><td className="px-4 py-2.5"><div className="flex gap-1"><button onClick={() => setEditingProduct({...p})} className="text-[11px] font-semibold text-blue-600 px-2 py-1 rounded border border-blue-200">Edit</button><button onClick={() => productAction('toggle', p.id)} disabled={actionLoading === p.id} className={'text-[11px] font-semibold px-2 py-1 rounded border disabled:opacity-50 ' + (p.is_active ? 'text-amber-600 border-amber-200' : 'text-emerald-600 border-emerald-200')}>{p.is_active ? 'Hide' : 'Show'}</button><button onClick={() => { if (confirm('Delete?')) productAction('delete', p.id) }} className="text-[11px] font-semibold text-red-500 px-2 py-1 rounded border border-red-200">Del</button></div></td></tr>) })}
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
            <div className="grid grid-cols-2 gap-3"><div><label className="block text-xs font-semibold text-slate-600 mb-1">Price (Rs.)</label><input type="number" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div><div><label className="block text-xs font-semibold text-slate-600 mb-1">Quantity</label><input type="number" value={newProduct.quantity} onChange={e => setNewProduct({...newProduct, quantity: e.target.value})} className="w-full px-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none" /></div></div>
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
                const csv = 'part_id,name,description,category,make,model,year,condition,price,quantity,show_price\nBRK-001,Front Brake Pads Set,OEM quality brake pads,Brakes,Toyota,Corolla,2018,Good,4500,10,true\nENG-002,Timing Belt Kit,Complete kit with tensioner,Engine Parts,Honda,Civic,2020,Excellent,12500,5,true\nSUS-003,Front Shock Absorber,Gas-filled left side,Suspension,Nissan,X-Trail,2019,Good,8900,8,true'
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
                <p><strong>Columns:</strong> part_id, name, description, category, make, model, year, condition, price, quantity, show_price</p>
                <p className="mt-1"><strong>Categories:</strong> {CATEGORIES.join(', ')}</p>
                <p><strong>Conditions:</strong> Excellent, Good, Fair, Salvage</p>
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
              <div className="flex items-center gap-2 mb-3"><span className={'text-[10px] font-black px-2.5 py-1 rounded-full ' + (bulkData.length ? 'bg-cyan-100 text-cyan-600' : 'bg-slate-100 text-slate-400')}>STEP 4</span><h3 className="font-bold text-sm">Upload ZIP Images</h3></div>
              <input ref={zipFileRef} type="file" accept=".zip" onChange={handleZipUpload} className="hidden" />
              <button onClick={() => { if (!bulkData.length) { showToast('Upload CSV first (Step 3)'); return }; zipFileRef.current?.click() }} disabled={zipProcessing} className="w-full py-8 border-2 border-dashed border-slate-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition disabled:opacity-50">
                <span className="text-3xl block mb-2">📦</span>
                <span className="font-bold text-sm text-slate-600">{zipProcessing ? 'Extracting...' : zipFile || 'Click to select compressed ZIP'}</span>
                {zipSummary && <span className="block text-xs text-green-600 font-semibold mt-1">✓ {zipSummary.matched} products matched ({zipSummary.totalImages} images)</span>}
                {zipSummary && zipSummary.unmatched > 0 && <span className="block text-xs text-amber-500 font-semibold mt-0.5">⚠ {zipSummary.unmatched} folders didn't match any Part ID</span>}
              </button>
              {!bulkData.length && <p className="text-[10px] text-slate-400 mt-2 text-center">Upload CSV first to enable this step</p>}
            </div>
          </div>

          {/* Step 5: Review & Import */}
          {bulkData.length > 0 && (<div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><span className="bg-orange-100 text-orange-600 text-[10px] font-black px-2.5 py-1 rounded-full">STEP 5</span><h3 className="font-bold">Review & Import ({bulkData.length} products)</h3></div>
              <div className="flex gap-2">
                <button onClick={() => { setBulkData([]); setBulkFile(''); setZipFile(''); setZipSummary(null) }} className="text-sm text-slate-500 px-3 py-1.5 rounded-lg border border-slate-200">Clear All</button>
                <button onClick={handleBulkImport} disabled={bulkLoading} className="bg-orange-500 text-white text-sm font-bold px-5 py-1.5 rounded-lg disabled:opacity-50 hover:bg-orange-600">{bulkLoading ? 'Importing...' : '🚀 Import All'}</button>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Part ID</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Name</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Category</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Make</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Price</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Qty</th><th className="px-3 py-2 text-xs font-bold text-slate-500 text-left">Images</th><th className="px-3 py-2"></th></tr></thead><tbody>{bulkData.map((r, i) => (<tr key={i} className={'border-t ' + (!r.hasImage ? 'bg-amber-50/50' : '')}><td className="px-3 py-2"><span className="font-mono text-xs px-2 py-0.5 rounded font-bold bg-slate-100">{r.partId}</span></td><td className="px-3 py-2"><input value={r.name} onChange={e => updateBulkRow(i,'name',e.target.value)} className="w-full px-2 py-1 border border-slate-200 rounded text-xs" /></td><td className="px-3 py-2"><select value={r.category} onChange={e => updateBulkRow(i,'category',e.target.value)} className="px-2 py-1 border border-slate-200 rounded text-xs">{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></td><td className="px-3 py-2 text-xs text-slate-500">{r.make || '-'}</td><td className="px-3 py-2"><input type="number" value={r.price} onChange={e => updateBulkRow(i,'price',e.target.value)} className="w-20 px-2 py-1 border border-slate-200 rounded text-xs" /></td><td className="px-3 py-2"><input type="number" value={r.quantity} onChange={e => updateBulkRow(i,'quantity',e.target.value)} className="w-14 px-2 py-1 border border-slate-200 rounded text-xs" /></td><td className="px-3 py-2">{r.hasImage ? <span className="text-[10px] font-bold text-green-600 bg-green-100 px-2 py-0.5 rounded-full">✓ {r.imageCount}</span> : <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">No images</span>}</td><td className="px-3 py-2"><button onClick={() => removeBulkRow(i)} className="text-red-400 hover:text-red-600 text-xs font-bold">✕</button></td></tr>))}</tbody></table></div></div>
          </div>)}
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
                </div>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-black text-slate-900 mb-4">🧾 POS</h1>
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
                      {posCart.map((item, i) => (<tr key={i} className="border-t border-slate-100"><td className="px-4 py-2"><span className="font-mono text-xs text-slate-400 mr-1">{item.productSku}</span><span className="font-semibold">{item.productName}</span></td><td className="px-4 py-2"><input type="number" min="1" max={item.maxStock} value={item.quantity} onChange={e => updateCartQty(i, parseInt(e.target.value) || 1)} className="w-16 px-2 py-1 border border-slate-200 rounded text-center text-sm" /></td><td className="px-4 py-2"><input type="number" value={item.unitPrice} onChange={e => updateCartPrice(i, parseFloat(e.target.value) || 0)} className="w-24 px-2 py-1 border border-slate-200 rounded text-sm" /></td><td className="px-4 py-2 text-right font-bold">Rs.{(item.quantity * item.unitPrice).toLocaleString()}</td><td className="px-2"><button onClick={() => removeFromCart(i)} className="text-red-400 hover:text-red-600">✕</button></td></tr>))}
                    </tbody></table></div>
                  )}
                </div>

                {/* Right sidebar */}
                <div className="space-y-4">
                  {/* Customer */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
                    <h3 className="font-bold text-slate-800 text-sm">Customer</h3>
                    <div className="relative">
                      <input value={posCustomer.name} onChange={e => { setPosCustomer({ ...posCustomer, id: null, name: e.target.value }); searchCustomers(e.target.value) }} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" placeholder="Customer name (type to search)" />
                      {customerSuggestions.length > 0 && (<div className="absolute top-full left-0 right-0 bg-white border border-slate-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto mt-1">{customerSuggestions.map((c: any) => (<button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-orange-50 text-sm border-b border-slate-100"><span className="font-semibold">{c.name}</span>{c.phone && <span className="text-xs text-slate-400 ml-2">{c.phone}</span>}</button>))}</div>)}
                    </div>
                    <input value={posCustomer.phone} onChange={e => setPosCustomer({...posCustomer, phone: e.target.value})} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none" placeholder="Phone / WhatsApp" />
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

                  {/* Payments */}
                  <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
                    <h3 className="font-bold text-slate-800 text-sm">Payment</h3>
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
                    <textarea value={posNotes} onChange={e => setPosNotes(e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none resize-none" placeholder="Notes" />
                  </div>

                  {/* Total */}
                  <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 text-white">
                    <div className="flex justify-between text-sm mb-1"><span className="text-slate-300">Subtotal</span><span>Rs.{posSubtotal.toLocaleString()}</span></div>
                    {posDiscountAmt > 0 && <div className="flex justify-between text-sm mb-1"><span className="text-red-300">Discount</span><span>-Rs.{posDiscountAmt.toLocaleString()}</span></div>}
                    <div className="flex justify-between text-2xl font-black mt-2 pt-2 border-t border-slate-600"><span>TOTAL</span><span>Rs.{posTotal.toLocaleString()}</span></div>
                    <div className="flex justify-between text-sm mt-2"><span className="text-green-300">Cash/Cheque/Bank</span><span className="text-green-300">Rs.{posPaidAmount.toLocaleString()}</span></div>
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
            <div className="flex gap-1 bg-white rounded-lg border border-slate-200 p-1">
              {[{v:'today',l:'Today'},{v:'week',l:'Week'},{v:'month',l:'Month'},{v:'all',l:'All'}].map(p => (
                <button key={p.v} onClick={() => setSalesPeriod(p.v)} className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${salesPeriod === p.v ? 'bg-orange-500 text-white' : 'text-slate-500 active:bg-slate-100'}`}>{p.l}</button>
              ))}
            </div>
          </div>

          {salesLoading ? <div className="text-center py-12"><div className="w-8 h-8 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : salesData ? (<div>

            {/* Sub-tabs: Overview / Transactions / Customers */}
            {(() => {
              const [salesSubTab, setSalesSubTab] = [salesView, setSalesView] as [string, (v: string) => void]
              return (<>
                <div className="flex gap-1 mb-4 bg-slate-100 rounded-lg p-1">
                  {[{v:'overview',l:'Overview'},{v:'transactions',l:'Transactions'},{v:'customers',l:'Customers'}].map(t => (
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
                {salesSubTab === 'transactions' && (
                  <div className="space-y-2">{salesData.sales.length === 0 ? (
                    <div className="text-center py-12"><p className="text-4xl opacity-30">📋</p><p className="text-sm text-slate-400 mt-2 font-semibold">No sales in this period</p></div>
                  ) : salesData.sales.map((sale: any) => (
                    <div key={sale.id} className={'bg-white rounded-xl border overflow-hidden ' + (sale.payment_status === 'voided' ? 'opacity-50' : '')}>
                      <button onClick={() => setExpandedSale(expandedSale === sale.id ? null : sale.id)} className="w-full px-3 sm:px-4 py-3 flex items-center justify-between text-left active:bg-slate-50">
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                          <span className="font-mono text-[10px] sm:text-xs font-bold bg-slate-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded flex-shrink-0">{sale.invoice_no}</span>
                          <div className="min-w-0">
                            <span className="font-semibold text-xs sm:text-sm truncate block">{sale.customer?.name || sale.customer_name}</span>
                            <span className="text-[10px] text-slate-400">{formatDateShort(sale.created_at)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                          <span className={'text-[9px] sm:text-[10px] font-bold px-1.5 sm:px-2 py-0.5 rounded-full ' + (sale.payment_status === 'voided' ? 'bg-red-100 text-red-600' : sale.payment_status === 'paid' ? 'bg-green-100 text-green-600' : sale.payment_status === 'partial' ? 'bg-amber-100 text-amber-600' : 'bg-red-100 text-red-600')}>{sale.payment_status === 'voided' ? 'VOID' : sale.payment_status.toUpperCase()}</span>
                          <span className="font-black text-orange-600 text-xs sm:text-sm">Rs.{parseFloat(sale.total).toLocaleString()}</span>
                          <span className="text-slate-400 text-xs">{expandedSale === sale.id ? '▲' : '▼'}</span>
                        </div>
                      </button>
                      {expandedSale === sale.id && (<div className="px-3 sm:px-4 pb-3 border-t border-slate-100">
                        <table className="w-full text-xs mt-2"><tbody>{(sale.items || []).map((i: any) => (<tr key={i.id} className="border-b border-slate-50"><td className="py-1.5"><span className="font-mono text-slate-400 mr-1">{i.product_sku}</span>{i.product_name}</td><td className="py-1.5 text-right text-slate-500">x{i.quantity}</td><td className="py-1.5 text-right font-semibold">Rs.{parseFloat(i.total).toLocaleString()}</td></tr>))}</tbody></table>
                        {parseFloat(sale.balance_due) > 0 && <p className="text-xs font-bold text-red-600 mt-2">Balance Due: Rs.{parseFloat(sale.balance_due).toLocaleString()}</p>}
                        <div className="flex gap-2 mt-3 flex-wrap">
                          <button onClick={() => printInvoice(sale, salesData.vendor, 'thermal', vendorSettings)} className="text-[11px] font-semibold text-slate-600 px-3 py-1.5 rounded border border-slate-200 active:bg-slate-50">🖨️ Thermal</button>
                          <button onClick={() => printInvoice(sale, salesData.vendor, 'a4', vendorSettings)} className="text-[11px] font-semibold text-blue-600 px-3 py-1.5 rounded border border-blue-200 active:bg-blue-50">📄 A4</button>
                          {(sale.customer_phone || sale.customer?.phone) && <button onClick={() => sendWhatsAppBill(sale, salesData.vendor, sale.customer_phone || sale.customer?.phone)} className="text-[11px] font-semibold text-green-600 px-3 py-1.5 rounded border border-green-200 active:bg-green-50">💬 WhatsApp</button>}
                          {sale.payment_status !== 'voided' && <button onClick={() => voidSale(sale.id)} className="text-[11px] font-semibold text-red-500 px-3 py-1.5 rounded border border-red-200 active:bg-red-50">Void</button>}
                          {sale.customer_id && <button onClick={() => { setCustomerHistoryId(sale.customer_id); setCustomerHistoryName(sale.customer?.name || sale.customer_name) }} className="text-[11px] font-semibold text-purple-600 px-3 py-1.5 rounded border border-purple-200 active:bg-purple-50">👤 History</button>}
                        </div>
                      </div>)}
                    </div>
                  ))}</div>
                )}

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
          <h1 className="text-2xl font-black text-slate-900 mb-4">💳 Credit & Settlements</h1>

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
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={handleEditCustomer} disabled={editCustomerLoading} className="bg-orange-500 hover:bg-orange-600 text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">{editCustomerLoading ? 'Saving...' : 'Save Changes'}</button>
                <button onClick={() => setEditingCustomer(null)} className="text-slate-500 text-sm px-4 py-2">Cancel</button>
              </div>
            </div>
          </div>)}

          {creditLoading ? <div className="text-center py-8"><div className="w-6 h-6 border-3 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div> : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Customer list */}
              <div className="space-y-2">
                <h3 className="font-bold text-slate-800 text-sm mb-2">Customers with Credit ({creditCustomers.length})</h3>
                {creditCustomers.length === 0 ? <div className="bg-white rounded-xl border border-slate-200 p-6 text-center"><p className="text-2xl opacity-30">✅</p><p className="text-slate-400 text-sm font-semibold mt-2">No outstanding credit or advances</p></div> : creditCustomers.map((c: any) => (
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

        {/* SETTINGS */}
        {tab === 'settings' && (<div>
          <h1 className="text-2xl font-black text-slate-900 mb-4">⚙️ Settings</h1>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

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
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Phone</label>
                    <input type="text" defaultValue={vendor?.phone || ''} id="settings-phone" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">WhatsApp</label>
                    <input type="text" defaultValue={vendor?.whatsapp || ''} id="settings-whatsapp" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                </div>
                <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Description</label>
                  <textarea defaultValue={vendor?.description || ''} id="settings-description" rows={3} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" /></div>
                <button onClick={() => {
                  const v = (id: string) => (document.getElementById(id) as HTMLInputElement)?.value || ''
                  updateShopInfo({ name: v('settings-name'), location: v('settings-location'), address: v('settings-address'), phone: v('settings-phone'), whatsapp: v('settings-whatsapp'), description: v('settings-description') })
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
                    <input type="text" value={vendorSettings.invoice_title} onChange={e => setVendorSettings({ ...vendorSettings, invoice_title: e.target.value })} placeholder={vendor?.name || 'Shop Name'} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Tax/VAT Number</label>
                      <input type="text" value={vendorSettings.tax_id} onChange={e => setVendorSettings({ ...vendorSettings, tax_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                    <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Email</label>
                      <input type="text" value={vendorSettings.email} onChange={e => setVendorSettings({ ...vendorSettings, email: e.target.value })} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" /></div>
                  </div>
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Invoice Footer</label>
                    <textarea value={vendorSettings.invoice_footer} onChange={e => setVendorSettings({ ...vendorSettings, invoice_footer: e.target.value })} rows={2} placeholder="Thank you for your business!" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" /></div>
                  <div><label className="text-[11px] font-bold text-slate-400 uppercase block mb-1">Terms & Conditions (A4 only)</label>
                    <textarea value={vendorSettings.invoice_terms} onChange={e => setVendorSettings({ ...vendorSettings, invoice_terms: e.target.value })} rows={3} placeholder="Goods once sold cannot be returned..." className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 resize-none" /></div>
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
            </div>
          </div>
        </div>)}

      </main>
    </div>
  )
}
