'use client'
import { colomboToday } from '@/lib/dates'
import { useState, useEffect, useRef } from 'react'
import StockTransfer from '../_shared/StockTransfer'
import DamageCapture from '../_shared/DamageCapture'

const CATEGORIES = ['Engine Parts','Transmission & Drivetrain','Suspension & Steering','Brake System','Electrical & Electronics','Body Parts','Lighting','Interior Parts','A/C & Radiator','Wheels & Tires','Exhaust System','Filters & Fluids','Accessories','Hybrid & EV Parts','Other','Windscreen','Beading Belts & Rubber','Audio & Video','Safety']
const CONDITIONS = ['New-Genuine','New-Other','Reconditioned','Damaged']
const TYRE_WIDTHS   = [135,145,155,165,175,185,195,205,215,225,235,245,255,265,275,285,295,305,315,325]
const TYRE_PROFILES = [25,30,35,40,45,50,55,60,65,70,75,80,85]
const TYRE_RIMS     = [12,13,14,15,16,17,18,19,20,21,22,24]
const TYRE_BRANDS   = ['Bridgestone','Michelin','Dunlop','MRF','Apollo','Yokohama','Continental','Pirelli','Toyo','Kumho','Nankang','Nexen','Falken','Hankook','BFGoodrich','Maxxis','Sailun','Linglong','Triangle']

function locLabel(p: any) { return [p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ') }
function confirmedAgo(dateStr: string | null): { label: string; cls: string } | null {
  if (!dateStr) return null
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days === 0) return { label: 'Confirmed today', cls: 'text-emerald-700 bg-emerald-50' }
  if (days <= 7)  return { label: `${days}d ago`, cls: 'text-emerald-600 bg-emerald-50' }
  if (days <= 30) return { label: `${days}d ago`, cls: 'text-amber-700 bg-amber-50' }
  return { label: `${days}d ago`, cls: 'text-red-600 bg-red-50' }
}

type StockMainView = 'stocktake' | 'suppliers' | 'receive' | 'history' | 'transfer'

interface TabStockLkTaxProps {
  vendor: any
  products: any[]
  vendorSettings: any
  showToast: (msg: string) => void
  onDataChanged: () => void
  // Deep-link target from the dashboard (e.g. 'receive', 'history'). Applied
  // once on arrival, then cleared via onInitialViewConsumed.
  initialView?: string | null
  onInitialViewConsumed?: () => void
}

const STOCK_VIEWS: StockMainView[] = ['stocktake', 'suppliers', 'receive', 'history', 'transfer']

export default function TabStockLkTax({ vendor, products, vendorSettings, showToast, onDataChanged, initialView, onInitialViewConsumed }: TabStockLkTaxProps) {
  const [stockMainView, setStockMainView] = useState<StockMainView>('stocktake')

  // Honour a dashboard deep-link (Receive Stock → 'receive', Post GRN → 'history').
  useEffect(() => {
    if (initialView && (STOCK_VIEWS as string[]).includes(initialView)) {
      setStockMainView(initialView as StockMainView)
      onInitialViewConsumed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialView])
  const [stockView, setStockView] = useState<'browse' | 'assign'>('browse')
  const [stockFilter, setStockFilter] = useState({ store: '', floor: '', sub1: '', sub2: '' })
  const [stocktakeSearch, setStocktakeSearch] = useState('')
  const [stockQtyEdits, setStockQtyEdits] = useState<Record<string, number>>({})
  const [stockConfirmSet, setStockConfirmSet] = useState<Set<string>>(new Set())
  const [stocktakeSaving, setStocktakeSaving] = useState(false)
  // Damage capture sheet target (product found damaged during the count)
  const [damageProduct, setDamageProduct] = useState<any>(null)

  // Nothing saves without the explicit Save button (a mis-tap must never
  // become a permanent confirmation) — but pending taps survive tab switches,
  // reloads and accidental closes via sessionStorage until saved or cleared.
  const pendingKey = `stocktake-pending-${vendor?.id || 'v'}`
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(pendingKey)
      if (raw) {
        const j = JSON.parse(raw)
        if (j.qtyEdits && Object.keys(j.qtyEdits).length) setStockQtyEdits(j.qtyEdits)
        if (Array.isArray(j.confirmIds) && j.confirmIds.length) setStockConfirmSet(new Set(j.confirmIds))
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const hasPending = Object.keys(stockQtyEdits).length > 0 || stockConfirmSet.size > 0
    try {
      if (hasPending) sessionStorage.setItem(pendingKey, JSON.stringify({ qtyEdits: stockQtyEdits, confirmIds: [...stockConfirmSet] }))
      else sessionStorage.removeItem(pendingKey)
    } catch {}
    const warn = (e: BeforeUnloadEvent) => { if (hasPending) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [stockQtyEdits, stockConfirmSet, pendingKey])
  // Quick Assign mode
  const [assignLoc, setAssignLoc] = useState({ store: '', floor: '', sub1: '', sub2: '' })
  const [assignSearch, setAssignSearch] = useState('')
  const [assignLoading, setAssignLoading] = useState<string | null>(null)

  // GRN state
  const [suppliers, setSuppliers] = useState<any[]>([])
  // Standard VAT rate (config, not hardcoded) — a VAT-registered supplier
  // charges it on every line, so that's what a GRN line should start at.
  const [vatRate, setVatRate] = useState(18)
  const supplierVatRate = (supplierId: string) =>
    suppliers.find((x: any) => x.id === supplierId)?.vat_registered ? vatRate : 0
  const [grnForm, setGrnForm] = useState({ supplierId: '', supplierName: '', supplierInvoiceNo: '', supplierInvoiceDate: '', receivedAt: colomboToday(), notes: '' })
  const [grnItems, setGrnItems] = useState<Array<{ productId: string | null; productName: string; productSku: string; quantity: number; unitCost: number; vatRate: number; needsCreate?: boolean; productData?: any }>>([])
  const [grnCsvPreview, setGrnCsvPreview] = useState<Array<{ matched: boolean; grnItem: any }> | null>(null)
  const [grnCsvFileName, setGrnCsvFileName] = useState('')
  const [grnProductSearch, setGrnProductSearch] = useState('')
  const [grnLoading, setGrnLoading] = useState(false)
  const [grnList, setGrnList] = useState<any[]>([])
  const [grnListLoading, setGrnListLoading] = useState(false)
  const [grnPosting, setGrnPosting] = useState<string | null>(null)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [addingSupplier, setAddingSupplier] = useState(false)
  // Supplier management
  const blankSupplierForm = { name: '', contactName: '', phone: '', email: '', country: 'LK', currency: 'LKR', vatRegistered: false, tin: '' }
  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null)
  const [supplierForm, setSupplierForm] = useState(blankSupplierForm)
  const [supplierSaving, setSupplierSaving] = useState(false)
  const [supplierDeleting, setSupplierDeleting] = useState<string | null>(null)
  // GRN inline product creation
  const [grnInlineCreate, setGrnInlineCreate] = useState(false)
  const [grnNewProduct, setGrnNewProduct] = useState({ name: '', category: 'Other', condition: 'Reconditioned', make: '', model: '', price: '', tyre_width: '', tyre_profile: '', tyre_rim: '' })
  const [grnInlineCreating, setGrnInlineCreating] = useState(false)
  // GRN draft edit
  const [editingGrnId, setEditingGrnId] = useState<string | null>(null)
  const [editingGrnItems, setEditingGrnItems] = useState<Array<{productId:string|null,productName:string,productSku:string,quantity:number,unitCost:number,vatRate:number,foreignCurrency?:string,foreignAmount?:string}>>([])
  const [editingGrnSaving, setEditingGrnSaving] = useState(false)
  const [grnReversing, setGrnReversing] = useState<string | null>(null)
  // Stocktake cost prompt
  const [stocktakeCostPrompt, setStocktakeCostPrompt] = useState<Array<{id:string,name:string,delta:number,oldQty:number,newQty:number,cost:string}> | null>(null)
  const [stocktakeCostSaving, setStocktakeCostSaving] = useState(false)

  useEffect(() => { fetchSuppliers(); fetchGrnList() }, [])

  const allProducts = products

  async function fetchSuppliers() {
    try { const r = await fetch('/api/vendor/suppliers'); if (r.ok) { const j = await r.json(); setSuppliers(j.suppliers || []) } } catch {}
    try { const r = await fetch('/api/vendor/tax-config'); if (r.ok) { const j = await r.json(); if (j.config?.vat_rate != null) setVatRate(parseFloat(j.config.vat_rate)) } } catch {}
  }

  async function fetchGrnList() {
    setGrnListLoading(true)
    try { const r = await fetch('/api/vendor/grns?limit=50'); if (r.ok) { const j = await r.json(); setGrnList(j.grns || []) } } catch {}
    setGrnListLoading(false)
  }

  async function createGrn(postNow = false) {
    if (grnItems.length === 0) { showToast('Add at least one item'); return }
    setGrnLoading(true)
    try {
      // Auto-create any new products from CSV rows before saving GRN
      const newItems = grnItems.filter(i => i.needsCreate && i.productData)
      let resolvedItems = [...grnItems]
      if (newItems.length > 0) {
        showToast(`Creating ${newItems.length} new product${newItems.length > 1 ? 's' : ''}…`)
        resolvedItems = await Promise.all(grnItems.map(async item => {
          if (!item.needsCreate || !item.productData) return item
          try {
            const r = await fetch('/api/vendor/products', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create', data: { ...item.productData, quantity: 0, show_price: true } }),
            })
            const j = await r.json()
            if (j.success && j.product) return { ...item, productId: j.product.id, productSku: j.product.sku || '', needsCreate: false }
          } catch {}
          return item
        }))
        // Abort if any product failed to create — a GRN line without a productId
        // would post stock against nothing and silently lose the goods received.
        const failed = resolvedItems.filter(i => i.needsCreate)
        if (failed.length > 0) {
          showToast(`⚠️ Failed to create ${failed.length} product${failed.length > 1 ? 's' : ''} (${failed.map(i => i.productName).slice(0, 3).join(', ')}) — GRN not saved`)
          setGrnItems(resolvedItems)
          setGrnLoading(false)
          return
        }
        setGrnItems(resolvedItems)
      }
      const r = await fetch('/api/vendor/grns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_grn', ...grnForm, items: resolvedItems }),
      })
      const j = await r.json()
      if (r.ok) {
        const supplierIdAtSave = grnForm.supplierId
        if (postNow && j.grn?.id) {
          // Same motion: stock in, cost layers, payable, pay-now question
          const pr = await fetch('/api/vendor/grns', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'post_grn', grnId: j.grn.id }),
          })
          const pj = await pr.json()
          if (pr.ok) {
            showToast('✅ ' + pj.message)
            if (pj.payable) setPayNow({ payable: pj.payable, supplierId: supplierIdAtSave || null })
          } else {
            // Posting failed but the draft exists — say so, don't lose the work
            showToast(`⚠️ ${j.grnNumber} saved as draft but posting failed: ${pj.error} — post it from GRN History`)
          }
        } else {
          showToast(`✅ ${j.grnNumber} saved as draft`)
        }
        setGrnItems([]); setGrnForm({ supplierId: '', supplierName: '', supplierInvoiceNo: '', supplierInvoiceDate: '', receivedAt: colomboToday(), notes: '' })
        setGrnProductSearch(''); setGrnCsvPreview(null); setGrnCsvFileName('')
        fetchGrnList(); onDataChanged(); setStockMainView('history')
      } else showToast('⚠️ ' + j.error)
    } catch { showToast('Network error') }
    setGrnLoading(false)
  }

  async function postGrn(grnId: string) {
    if (!confirm('Post this GRN? Stock quantities will be updated and cannot be undone.')) return
    setGrnPosting(grnId)
    try {
      const r = await fetch('/api/vendor/grns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'post_grn', grnId }) })
      const j = await r.json()
      if (r.ok) {
        showToast('✅ ' + j.message)
        fetchGrnList(); onDataChanged()
        // The debt now exists — ask the one question the person at the goods
        // door can answer: did money change hands?
        if (j.payable) setPayNow({ payable: j.payable, supplierId: grnListSupplierOf(grnId) })
      }
      else showToast('⚠️ ' + j.error)
    } catch { showToast('Network error') }
    setGrnPosting(null)
  }

  // Supplier id for a GRN already in the loaded list (needed by record_payment)
  const grnListSupplierOf = (grnId: string) => (grnList.find((g: any) => g.id === grnId) as any)?.supplier_id || null

  // ── Pay-now-or-later after posting ──
  const [payNow, setPayNow] = useState<{ payable: any; supplierId: string | null } | null>(null)
  const [payNowMethod, setPayNowMethod] = useState<'cash' | 'online'>('cash')
  const [payNowRef, setPayNowRef] = useState('')
  const [payNowBusy, setPayNowBusy] = useState(false)
  const [payNowSlip, setPayNowSlip] = useState<{ no: string; amount: number } | null>(null)

  async function settlePayableNow() {
    if (!payNow?.payable || !payNow.supplierId) return
    if (payNowMethod === 'online' && !payNowRef.trim()) {
      // The 8-digit number comes back from the server; the operator types it
      // into the transfer remarks — the reference here is optional context
    }
    setPayNowBusy(true)
    try {
      const r = await fetch('/api/vendor/supplier-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          invoice_id: payNow.payable.id,
          supplier_id: payNow.supplierId,
          amount: payNow.payable.amount,
          payment_date: colomboToday(),
          method: payNowMethod,
          reference: payNowRef.trim() || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      if (j.confirm_no) setPayNowSlip({ no: j.confirm_no, amount: payNow.payable.amount })
      else showToast('✅ Paid — came off today\'s drawer')
      setPayNow(null); setPayNowRef('')
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setPayNowBusy(false)
  }

  async function deleteGrn(grnId: string, grnNumber: string) {
    if (!confirm(`Delete draft ${grnNumber}?`)) return
    try {
      const r = await fetch('/api/vendor/grns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete_grn', grnId }) })
      const j = await r.json()
      if (r.ok) { showToast(j.message); fetchGrnList() }
      else showToast('⚠️ ' + j.error)
    } catch { showToast('Network error') }
  }

  async function addQuickSupplier() {
    if (!newSupplierName.trim()) return
    setAddingSupplier(true)
    try {
      const r = await fetch('/api/vendor/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'create', name: newSupplierName }) })
      const j = await r.json()
      if (r.ok) {
        setSuppliers(prev => [...prev, j.supplier].sort((a, b) => a.name.localeCompare(b.name)))
        setGrnForm(f => ({ ...f, supplierId: j.supplier.id, supplierName: j.supplier.name }))
        setNewSupplierName('')
      } else showToast('⚠️ ' + j.error)
    } catch {}
    setAddingSupplier(false)
  }

  // ── GRN CSV helpers ─────────────────────────────────────────────────────────
  function parseGrnCsv(text: string) {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return []
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const values: string[] = []
      let current = '', inQuotes = false
      for (const ch of line) {
        if (ch === '"') { inQuotes = !inQuotes }
        else if (ch === ',' && !inQuotes) { values.push(current.trim()); current = '' }
        else { current += ch }
      }
      values.push(current.trim())
      const row: Record<string, string> = {}
      headers.forEach((h, i) => { row[h] = (values[i] || '').replace(/^"|"$/g, '') })
      return row
    }).filter(r => r.name?.trim())
  }

  function handleGrnCsvUpload(file: File) {
    const reader = new FileReader()
    setGrnCsvFileName(file.name)
    reader.onload = e => {
      const text = e.target?.result as string
      const rows = parseGrnCsv(text)
      const allProductsList = products as any[]
      const preview = rows.map(row => {
        const sku = row.sku?.trim()
        const matched = sku ? allProductsList.find((p: any) => p.sku?.toLowerCase() === sku.toLowerCase()) : null
        return {
          matched: !!matched,
          grnItem: {
            productId:   matched ? matched.id : null,
            productName: matched ? matched.name : (row.name?.trim() || 'Unnamed'),
            productSku:  matched ? (matched.sku || '') : (sku || ''),
            quantity:    Math.max(1, parseInt(row.quantity) || 1),
            unitCost:    Math.max(0, parseInt(row.unit_cost || row.cost || '0') || 0),
            vatRate:     row.vat_rate != null && row.vat_rate !== ''
              ? (parseFloat(row.vat_rate) || 0)
              : supplierVatRate(grnForm.supplierId),
            needsCreate: !matched,
            productData: !matched ? {
              name:        row.name?.trim() || 'Unnamed',
              make:        row.make?.trim() || null,
              model:       row.model?.trim() || null,
              category:    row.category?.trim() || 'Other',
              condition:   row.condition?.trim() || 'Used',
              color:       row.color?.trim() || null,
              price:       parseInt(row.price || '0') || null,
              description: row.description?.trim() || null,
            } : undefined,
          },
        }
      })
      setGrnCsvPreview(preview)
    }
    reader.readAsText(file)
  }

  function confirmGrnCsvAdd() {
    if (!grnCsvPreview) return
    setGrnItems(prev => [...prev, ...grnCsvPreview.map(r => r.grnItem)])
    setGrnCsvPreview(null); setGrnCsvFileName('')
  }

  function downloadGrnCsvTemplate() {
    const csv = [
      'name,sku,make,model,category,condition,color,price,unit_cost,quantity,vat_rate,description',
      'Toyota Aqua Front Bumper,,Toyota,Aqua,Body Parts,Used,Pearl White,38000,15000,1,0,Minor scratch right edge',
      'NGK Spark Plug BKR5E,NGK-BKR5E,,,Electrical,New,,2500,1200,10,18,',
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'grn-items-template.csv'; a.click(); URL.revokeObjectURL(url)
  }

  async function saveSupplier() {
    if (!supplierForm.name.trim()) { showToast('Supplier name is required'); return }
    setSupplierSaving(true)
    try {
      const action = editingSupplierId ? 'update' : 'create'
      const body = editingSupplierId ? { action, id: editingSupplierId, ...supplierForm } : { action, ...supplierForm }
      const r = await fetch('/api/vendor/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (r.ok) {
        setSuppliers(prev => {
          const filtered = editingSupplierId ? prev.filter(s => s.id !== editingSupplierId) : prev
          return [...filtered, j.supplier].sort((a, b) => a.name.localeCompare(b.name))
        })
        setSupplierFormOpen(false)
        setEditingSupplierId(null)
        setSupplierForm(blankSupplierForm)
        showToast(editingSupplierId ? 'Supplier updated' : 'Supplier added')
      } else showToast('⚠️ ' + (j.error || 'Failed'))
    } catch { showToast('Network error') }
    setSupplierSaving(false)
  }

  async function reverseGrn(grnId: string, grnNumber: string) {
    if (!confirm(`Reverse ${grnNumber}?\n\nThis will:\n• Reduce product quantities back\n• Remove all FIFO cost layers\n\nOnly allowed if no stock from this GRN has been sold yet.`)) return
    setGrnReversing(grnId)
    try {
      const r = await fetch('/api/vendor/grns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reverse_grn', grnId }) })
      const j = await r.json()
      if (r.ok) { showToast('✅ ' + j.message); fetchGrnList(); onDataChanged() }
      else showToast('⚠️ ' + (j.error || 'Failed'))
    } catch { showToast('Network error') }
    setGrnReversing(null)
  }

  async function saveGrnEdits() {
    if (!editingGrnId || editingGrnItems.length === 0) return
    setEditingGrnSaving(true)
    try {
      const r = await fetch('/api/vendor/grns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'update_grn', grnId: editingGrnId,
        items: editingGrnItems.map(i => ({
          productId: i.productId, productName: i.productName, productSku: i.productSku,
          quantity: i.quantity, unitCost: i.unitCost, vatRate: i.vatRate,
          foreignCurrency: i.foreignCurrency, foreignAmount: i.foreignAmount,
        }))
      }) })
      const j = await r.json()
      if (r.ok) { showToast('✅ GRN updated'); setEditingGrnId(null); fetchGrnList() }
      else showToast('⚠️ ' + (j.error || 'Failed'))
    } catch { showToast('Network error') }
    setEditingGrnSaving(false)
  }

  async function grnInlineCreateProduct() {
    if (!grnNewProduct.name.trim()) { showToast('Product name required'); return }
    setGrnInlineCreating(true)
    try {
      const isTyre = grnNewProduct.category === 'Wheels & Tires'
      const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', data: {
          name: grnNewProduct.name, category: grnNewProduct.category,
          condition: grnNewProduct.condition, make: grnNewProduct.make,
          model: isTyre ? '' : grnNewProduct.model, price: grnNewProduct.price,
          quantity: 0, show_price: true,
          product_type: isTyre ? 'tyre' : 'part',
          tyre_width:   isTyre && grnNewProduct.tyre_width   ? parseInt(grnNewProduct.tyre_width)   : null,
          tyre_profile: isTyre && grnNewProduct.tyre_profile ? parseInt(grnNewProduct.tyre_profile) : null,
          tyre_rim:     isTyre && grnNewProduct.tyre_rim     ? parseInt(grnNewProduct.tyre_rim)     : null,
        } }) })
      const j = await r.json()
      if (j.success && j.product) {
        const p = j.product
        setGrnItems(prev => [...prev, { productId: p.id, productName: p.name, productSku: p.sku || '', quantity: 1, unitCost: 0, vatRate: supplierVatRate(grnForm.supplierId), foreignCurrency: '', foreignAmount: '' }])
        setGrnInlineCreate(false)
        setGrnNewProduct({ name: '', category: 'Other', condition: 'Reconditioned', make: '', model: '', price: '', tyre_width: '', tyre_profile: '', tyre_rim: '' })
        setGrnProductSearch('')
        await onDataChanged()
        showToast('Product created and added to GRN')
      } else showToast('⚠️ ' + (j.error || 'Failed'))
    } catch { showToast('Network error') }
    setGrnInlineCreating(false)
  }

  async function deleteSupplier(id: string, name: string) {
    if (!confirm(`Delete supplier "${name}"? This cannot be undone.`)) return
    setSupplierDeleting(id)
    try {
      const r = await fetch('/api/vendor/suppliers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) })
      if (r.ok) {
        setSuppliers(prev => prev.filter(s => s.id !== id))
        showToast('Supplier deleted')
      } else { const j = await r.json(); showToast('⚠️ ' + (j.error || 'Failed')) }
    } catch { showToast('Network error') }
    setSupplierDeleting(null)
  }

  async function saveAllStockChanges(skipCostPrompt = false) {
    const now = new Date().toISOString()
    const qtyEntries = Object.entries(stockQtyEdits)
    const confirmOnly = [...stockConfirmSet].filter(id => !(id in stockQtyEdits))
    if (!qtyEntries.length && !confirmOnly.length) return

    // Check for upward qty adjustments — prompt for cost if not already prompted
    if (!skipCostPrompt) {
      const increases = qtyEntries
        .map(([id, newQty]) => {
          const product = allProducts.find((p: any) => p.id === id)
          const oldQty  = product?.quantity ?? 0
          const delta   = newQty - oldQty
          return delta > 0 ? { id, name: product?.name || id, delta, oldQty, newQty, cost: '' } : null
        })
        .filter(Boolean) as Array<{id:string,name:string,delta:number,oldQty:number,newQty:number,cost:string}>
      if (increases.length > 0) {
        setStocktakeCostPrompt(increases)
        return
      }
    }

    setStocktakeSaving(true)
    try {
      const responses = await Promise.all([
        ...qtyEntries.map(([id, qty]) =>
          fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', productId: id, data: { quantity: qty, last_stock_confirmed_at: now } }) })),
        ...confirmOnly.map(id =>
          fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'update', productId: id, data: { last_stock_confirmed_at: now } }) }))
      ])
      const failedCount = responses.filter(r => !r.ok).length
      if (failedCount > 0) {
        // Keep the pending edits so the user can retry — clearing them would silently drop changes
        showToast(`⚠️ ${failedCount} update${failedCount !== 1 ? 's' : ''} failed — please retry`)
        await onDataChanged()
      } else {
        const total = qtyEntries.length + confirmOnly.length
        showToast(`${total} product${total !== 1 ? 's' : ''} saved & confirmed`)
        setStockQtyEdits({})
        setStockConfirmSet(new Set())
        // Clear synchronously: onDataChanged() unmounts this tab during the
        // reload, which can beat the persistence effect — the saved pending
        // set would then be restored from storage as "unsaved" on remount.
        try { sessionStorage.removeItem(pendingKey) } catch {}
        await onDataChanged()
      }
    } catch { showToast('Error saving') }
    setStocktakeSaving(false)
  }

  async function saveStocktakeWithCost() {
    if (!stocktakeCostPrompt) return
    setStocktakeCostSaving(true)
    const today = colomboToday()
    try {
      // Seed cost layers for items where cost was provided
      await Promise.all(stocktakeCostPrompt.map(async item => {
        const cost = parseInt(item.cost) || 0
        if (cost > 0) {
          await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'seed_cost_layer', productId: item.id, unitCost: cost, quantity: item.delta, receivedAt: today }) })
        }
      }))
      setStocktakeCostPrompt(null)
      await saveAllStockChanges(true) // proceed without re-prompting
    } catch { showToast('Error seeding cost layers') }
    setStocktakeCostSaving(false)
  }

  // ── derive unique values for dropdowns ──
  const uniq = (arr: string[]) => [...new Set(arr.filter(Boolean))].sort()
  const allStores  = uniq(allProducts.map((p: any) => p.loc_store))
  const allFloors  = uniq(allProducts.filter((p: any) => !stockFilter.store || p.loc_store === stockFilter.store).map((p: any) => p.loc_floor))
  const allSub1s   = uniq(allProducts.filter((p: any) => (!stockFilter.store || p.loc_store === stockFilter.store) && (!stockFilter.floor || p.loc_floor === stockFilter.floor)).map((p: any) => p.loc_sub1))
  const allSub2s   = uniq(allProducts.filter((p: any) => (!stockFilter.store || p.loc_store === stockFilter.store) && (!stockFilter.floor || p.loc_floor === stockFilter.floor) && (!stockFilter.sub1 || p.loc_sub1 === stockFilter.sub1)).map((p: any) => p.loc_sub2))

  // ── filter products by active filters + search ──
  const searchLower = stocktakeSearch.toLowerCase()
  const browseProducts = allProducts.filter((p: any) => {
    if (stockFilter.store && p.loc_store !== stockFilter.store) return false
    if (stockFilter.floor && p.loc_floor !== stockFilter.floor) return false
    if (stockFilter.sub1  && p.loc_sub1  !== stockFilter.sub1)  return false
    if (stockFilter.sub2  && p.loc_sub2  !== stockFilter.sub2)  return false
    if (searchLower) return p.name?.toLowerCase().includes(searchLower) || (p.sku || '').toLowerCase().includes(searchLower)
    return true
  })

  const anyFilter = stockFilter.store || stockFilter.floor || stockFilter.sub1 || stockFilter.sub2 || stocktakeSearch
  const pendingCount = Object.keys(stockQtyEdits).length + stockConfirmSet.size

  // ── quick assign: search results ──
  const assignSearchLower = assignSearch.toLowerCase()
  const assignResults = assignSearch.length > 1
    ? allProducts.filter((p: any) =>
        p.name?.toLowerCase().includes(assignSearchLower) ||
        (p.sku || '').toLowerCase().includes(assignSearchLower))
      .slice(0, 20)
    : []
  const anyAssignLoc = assignLoc.store || assignLoc.floor || assignLoc.sub1 || assignLoc.sub2

  // ── Assign basket: pick products one by one, then assign ALL to the current
  // location in one go. One catalog refetch at the end instead of one per part,
  // and the operator reviews the list before anything is written.
  // Collapse the tall location editor to a one-line banner once the operator
  // confirms where they're standing — frees most of a phone screen.
  const [locCollapsed, setLocCollapsed] = useState(false)
  const [assignBasket, setAssignBasket] = useState<any[]>([])
  // Counted qty per basket item — defaults to 1 (operator is holding the part);
  // saved onto the product together with the location, so assigning doubles as
  // a stock count + confirmation.
  const [basketQty, setBasketQty] = useState<Record<string, number>>({})
  const [assignSaving, setAssignSaving] = useState(false)
  const basketKey = `assign-basket-${vendor?.id || 'v'}`
  const basketHydrated = useRef(false)
  function removeFromBasket(id: string) {
    setAssignBasket(prev => prev.filter((b: any) => b.id !== id))
    setBasketQty(prev => { const n = { ...prev }; delete n[id]; return n })
  }
  useEffect(() => {
    // Restore a basket left over from a tab switch/reload (ids+qty → products
    // once the catalog has loaded). Tolerates the old ids-only format.
    if (basketHydrated.current || !products.length) return
    basketHydrated.current = true
    try {
      const raw = JSON.parse(sessionStorage.getItem(basketKey) || '[]')
      const entries: Array<{ id: string; q: number }> = Array.isArray(raw)
        ? raw.map((e: any) => typeof e === 'string' ? { id: e, q: 1 } : { id: e.id, q: Math.max(1, parseInt(e.q) || 1) })
        : []
      if (entries.length) {
        const found = products.filter((p: any) => entries.some(e => e.id === p.id))
        if (found.length) {
          setAssignBasket(found)
          setBasketQty(Object.fromEntries(entries.map(e => [e.id, e.q])))
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products])
  useEffect(() => {
    if (!basketHydrated.current) return
    try {
      if (assignBasket.length) sessionStorage.setItem(basketKey, JSON.stringify(assignBasket.map((p: any) => ({ id: p.id, q: basketQty[p.id] ?? 1 }))))
      else sessionStorage.removeItem(basketKey)
    } catch {}
  }, [assignBasket, basketQty, basketKey])

  async function assignAllBasket() {
    if (!anyAssignLoc || assignBasket.length === 0 || assignSaving) return
    setAssignSaving(true)
    const loc = { loc_store: assignLoc.store || null, loc_floor: assignLoc.floor || null, loc_sub1: assignLoc.sub1 || null, loc_sub2: assignLoc.sub2 || null }
    const now = new Date().toISOString()
    const results = await Promise.all(assignBasket.map(async (p: any) => {
      try {
        const r = await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          // Location + counted qty + confirmation stamp — assigning the part in
          // hand IS a stock count, so all three save together.
          body: JSON.stringify({ action: 'update', productId: p.id, data: { ...loc, quantity: Math.max(1, basketQty[p.id] ?? 1), last_stock_confirmed_at: now } }) })
        return r.ok ? p.id : null
      } catch { return null }
    }))
    const ok = new Set(results.filter(Boolean))
    const failed = assignBasket.filter((p: any) => !ok.has(p.id))
    setAssignBasket(failed) // failures stay in the list for retry
    setBasketQty(prev => { const n = { ...prev }; ok.forEach((id: any) => delete n[id]); return n })
    setAssignSaving(false)
    if (ok.size > 0) { showToast(`📍 ${ok.size} part${ok.size !== 1 ? 's' : ''} assigned & counted`); await onDataChanged() }
    if (failed.length > 0) showToast(`⚠️ ${failed.length} failed — kept in the list`)
  }

  const assignBasketBlock = assignBasket.length > 0 ? (
    <div className="mb-5 bg-white border-2 border-amber-400 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200">
        <div className="flex items-center justify-between">
          <p className="text-xs font-black text-amber-800 uppercase">To assign here — {assignBasket.length}</p>
          <button onClick={() => { setAssignBasket([]); setBasketQty({}) }} className="text-[11px] font-bold text-slate-400 hover:text-red-500">Clear all</button>
        </div>
        <p className="text-[10px] text-amber-600 mt-0.5">Qty = counted stock — saved with the location &amp; marked confirmed</p>
      </div>
      <div className="divide-y divide-slate-100">
        {assignBasket.map((p: any) => {
          const q = basketQty[p.id] ?? 1
          return (
            <div key={p.id} className="px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.sku}</span>
                  <p className="font-semibold text-slate-900 text-sm leading-tight mt-0.5 truncate">{p.name}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setBasketQty(prev => ({ ...prev, [p.id]: Math.max(1, q - 1) }))}
                    className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold text-lg flex items-center justify-center active:bg-slate-200 select-none">−</button>
                  <input type="number" inputMode="numeric" min="1" value={q}
                    onChange={e => setBasketQty(prev => ({ ...prev, [p.id]: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-12 h-8 text-center font-bold text-sm border-2 rounded-lg outline-none focus:border-amber-400 border-slate-200 bg-white" />
                  <button onClick={() => setBasketQty(prev => ({ ...prev, [p.id]: q + 1 }))}
                    className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 font-bold text-lg flex items-center justify-center active:bg-slate-200 select-none">+</button>
                </div>
                <button onClick={() => setDamageProduct(p)} title="Record damage"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border-2 border-amber-200 bg-amber-50 text-amber-700 text-sm font-bold active:bg-amber-100">⚠</button>
                <button onClick={() => removeFromBasket(p.id)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 border border-slate-200 text-lg font-bold">✕</button>
              </div>
              {p.quantity === 0 ? (
                <p className="text-[10px] font-bold text-red-600 mt-1 bg-red-50 border border-red-200 rounded px-2 py-1">
                  🔴 SOLD OUT — this listing&apos;s unit was already sold. If the part in hand is a different unit, add it as a NEW product (reviving this one leaves it with no cost for GP). If the sold one came back, process a return on the original invoice instead.
                </p>
              ) : q < p.quantity ? (
                /* Direction-aware: lowering the count destroys units the system
                   can't see anywhere else — one location per product, so the
                   rest may be fine in another store/rack. */
                <p className="text-[10px] font-bold text-red-600 mt-1 bg-red-50 border border-red-200 rounded px-2 py-1">
                  ⚠ Saving {q} makes {p.quantity - q} unit{p.quantity - q !== 1 ? 's' : ''} vanish with no record (stock was {p.quantity}). Sure this is ALL of them? Check other locations first — if genuinely gone, use the Write-offs tab instead (keeps cost &amp; audit trail).
                </p>
              ) : q > p.quantity && (
                <p className="text-[10px] font-bold text-amber-700 mt-1 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  ⚠ Saving {q} adds {q - p.quantity} unit{q - p.quantity !== 1 ? 's' : ''} with NO purchase cost (stock was {p.quantity}) — GP won&apos;t be accurate. Receive found stock via a GRN (Receive Stock) instead so it carries a cost.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div className="p-3 bg-amber-50/50">
        <button onClick={assignAllBasket} disabled={!anyAssignLoc || assignSaving}
          className="w-full bg-amber-500 active:bg-amber-600 text-white font-bold py-3 rounded-xl disabled:opacity-40 text-sm">
          {assignSaving ? 'Assigning…' : anyAssignLoc
            ? `📍 Assign all ${assignBasket.length} to ${[assignLoc.store, assignLoc.floor, assignLoc.sub1, assignLoc.sub2].filter(Boolean).join(' › ')}`
            : 'Set a location above first'}
        </button>
      </div>
    </div>
  ) : null

  const dropdownCls = "px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white w-full"

  return (
    <div>
      {/* ── Sub-tabs nav ── */}
      <div className="flex gap-1 mb-5 bg-slate-100 rounded-xl p-1 overflow-x-auto">
        {([{v:'stocktake',l:'📦',lf:'Stock Levels'},{v:'suppliers',l:'🏭',lf:'Suppliers'},{v:'receive',l:'📥',lf:'Receive Stock'},{v:'history',l:'📜',lf:'GRN History'},{v:'transfer',l:'🔀',lf:'Transfer Stock'}] as const).map(t => (
          <button key={t.v} onClick={() => setStockMainView(t.v)}
            className={`flex-none px-3 py-2 text-xs font-bold rounded-lg transition whitespace-nowrap ${stockMainView === t.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <span className="sm:hidden">{t.l} {t.lf}</span>
            <span className="hidden sm:inline">{t.l} {t.lf}</span>
          </button>
        ))}
      </div>

      {/* ── SUPPLIERS ── */}
      {stockMainView === 'suppliers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-sm text-slate-800">🏭 Suppliers</h3>
                <p className="text-[11px] text-slate-400 mt-0.5">Manage your parts & goods suppliers</p>
              </div>
              <button
                onClick={() => { setEditingSupplierId(null); setSupplierForm(blankSupplierForm); setSupplierFormOpen(true) }}
                className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold px-3 py-2 rounded-lg"
              >+ Add Supplier</button>
            </div>

            {/* Add / Edit form */}
            {supplierFormOpen && (
              <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-600 uppercase">{editingSupplierId ? 'Edit Supplier' : 'New Supplier'}</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Supplier Name <span className="text-red-400">*</span></label>
                    <input type="text" value={supplierForm.name} onChange={e => setSupplierForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g. Toyota Lanka (Pvt) Ltd"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Contact Name</label>
                    <input type="text" value={supplierForm.contactName} onChange={e => setSupplierForm(f => ({ ...f, contactName: e.target.value }))}
                      placeholder="e.g. Kamal Perera"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Phone</label>
                    <input type="tel" value={supplierForm.phone} onChange={e => setSupplierForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="e.g. 0112345678"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Email</label>
                    <input type="email" value={supplierForm.email} onChange={e => setSupplierForm(f => ({ ...f, email: e.target.value }))}
                      placeholder="e.g. orders@supplier.lk"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Country</label>
                    <select value={supplierForm.country} onChange={e => setSupplierForm(f => ({ ...f, country: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white">
                      <option value="LK">🇱🇰 Sri Lanka (LK)</option>
                      <option value="JP">🇯🇵 Japan (JP)</option>
                      <option value="CN">🇨🇳 China (CN)</option>
                      <option value="IN">🇮🇳 India (IN)</option>
                      <option value="TH">🇹🇭 Thailand (TH)</option>
                      <option value="KR">🇰🇷 South Korea (KR)</option>
                      <option value="DE">🇩🇪 Germany (DE)</option>
                      <option value="US">🇺🇸 USA (US)</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Currency</label>
                    <select value={supplierForm.currency} onChange={e => setSupplierForm(f => ({ ...f, currency: e.target.value }))}
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white">
                      <option value="LKR">LKR — Sri Lankan Rupee</option>
                      <option value="JPY">JPY — Japanese Yen</option>
                      <option value="USD">USD — US Dollar</option>
                      <option value="CNY">CNY — Chinese Yuan</option>
                      <option value="INR">INR — Indian Rupee</option>
                      <option value="EUR">EUR — Euro</option>
                      <option value="KRW">KRW — Korean Won</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">VAT Registration No. (TIN)</label>
                    <input type="text" value={supplierForm.tin} onChange={e => setSupplierForm(f => ({ ...f, tin: e.target.value }))}
                      placeholder="9-digit TIN"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  </div>
                  <div className="flex items-center gap-3 pt-5">
                    <button
                      onClick={() => setSupplierForm(f => ({ ...f, vatRegistered: !f.vatRegistered }))}
                      className={`relative w-10 h-5 rounded-full transition-colors ${supplierForm.vatRegistered ? 'bg-orange-500' : 'bg-slate-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${supplierForm.vatRegistered ? 'translate-x-5' : ''}`} />
                    </button>
                    <label className="text-xs font-semibold text-slate-600">VAT Registered Supplier</label>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveSupplier} disabled={supplierSaving}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
                    {supplierSaving ? 'Saving…' : editingSupplierId ? 'Save Changes' : 'Add Supplier'}
                  </button>
                  <button onClick={() => { setSupplierFormOpen(false); setEditingSupplierId(null); setSupplierForm(blankSupplierForm) }}
                    className="text-xs font-bold text-slate-500 px-4 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
                </div>
              </div>
            )}

            {/* Supplier list */}
            {suppliers.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No suppliers yet — click + Add Supplier above</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {suppliers.map(s => (
                  <div key={s.id} className="flex items-start justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm text-slate-800">{s.name}</span>
                        {s.country !== 'LK' && <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{s.country}</span>}
                        {s.currency !== 'LKR' && <span className="text-[10px] font-bold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{s.currency}</span>}
                        {s.vat_registered && <span className="text-[10px] font-bold bg-green-50 text-green-700 px-1.5 py-0.5 rounded">VAT Reg.</span>}
                      </div>
                      <div className="flex flex-wrap gap-x-3 mt-0.5">
                        {s.contact_name && <span className="text-[11px] text-slate-400">{s.contact_name}</span>}
                        {s.phone && <span className="text-[11px] text-slate-400">📞 {s.phone}</span>}
                        {s.email && <span className="text-[11px] text-slate-400">✉️ {s.email}</span>}
                        {s.tin && <span className="text-[11px] text-slate-400 font-mono">TIN: {s.tin}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => {
                        setEditingSupplierId(s.id)
                        setSupplierForm({ name: s.name, contactName: s.contact_name || '', phone: s.phone || '', email: s.email || '', country: s.country || 'LK', currency: s.currency || 'LKR', vatRegistered: s.vat_registered || false, tin: s.tin || '' })
                        setSupplierFormOpen(true)
                      }} className="text-[11px] font-bold text-slate-500 hover:text-orange-600 px-2 py-1 rounded hover:bg-orange-50">Edit</button>
                      <button onClick={() => deleteSupplier(s.id, s.name)} disabled={supplierDeleting === s.id}
                        className="text-[11px] font-bold text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 disabled:opacity-40">
                        {supplierDeleting === s.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── RECEIVE STOCK (GRN creation) ── */}
      {stockMainView === 'receive' && (() => {
        const allProductsList = products as any[]
        const searchLowerGrn = grnProductSearch.toLowerCase()
        const searchResults = grnProductSearch.length > 1
          ? allProductsList.filter((p: any) =>
              p.name?.toLowerCase().includes(searchLowerGrn) ||
              (p.sku || '').toLowerCase().includes(searchLowerGrn)
            ).slice(0, 12)
          : []
        const grnNetCost  = grnItems.reduce((s, i) => s + i.quantity * i.unitCost, 0)
        const grnInputVat = grnItems.reduce((s, i) => s + Math.round(i.quantity * i.unitCost * i.vatRate / 100), 0)
        const grnTotal    = grnNetCost + grnInputVat

        return (
          <div className="space-y-4">
            {/* Header fields */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-bold text-sm text-slate-800 mb-4">📥 New Goods Received Note</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Supplier */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Supplier</label>
                  <select value={grnForm.supplierId} onChange={e => {
                    const s = suppliers.find(x => x.id === e.target.value)
                    const wasDefault = supplierVatRate(grnForm.supplierId)
                    const nowDefault = s?.vat_registered ? vatRate : 0
                    setGrnForm(f => ({ ...f, supplierId: e.target.value, supplierName: s?.name || '' }))
                    if (nowDefault !== wasDefault) {
                      setGrnItems(prev => prev.map(it => it.vatRate === wasDefault ? { ...it, vatRate: nowDefault } : it))
                      if (grnItems.length > 0) {
                        showToast(nowDefault > 0
                          ? `${s?.name} is VAT-registered — lines set to ${nowDefault}%`
                          : `${s?.name || 'This supplier'} is not VAT-registered — lines set to 0%`)
                      }
                    }
                  }} className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400 bg-white">
                    <option value="">— Select supplier —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name} {s.country !== 'LK' ? `(${s.country})` : ''}</option>)}
                  </select>
                  {grnForm.supplierId && (
                    suppliers.find((x: any) => x.id === grnForm.supplierId)?.vat_registered
                      ? <p className="text-[10px] font-bold text-emerald-600 mt-1">VAT-registered — lines default to {vatRate}%, claimable as input VAT</p>
                      : <p className="text-[10px] font-bold text-slate-400 mt-1">Not VAT-registered — no input VAT to claim on this purchase</p>
                  )}
                  {/* Quick-add supplier */}
                  <div className="flex gap-2 mt-2">
                    <input type="text" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)}
                      placeholder="New supplier name…" onKeyDown={e => { if (e.key === 'Enter') addQuickSupplier() }}
                      className="flex-1 px-2 py-1.5 rounded border border-slate-200 text-xs outline-none focus:border-orange-300" />
                    <button onClick={addQuickSupplier} disabled={addingSupplier || !newSupplierName.trim()}
                      className="text-xs font-bold text-orange-600 px-3 py-1.5 rounded border border-orange-200 disabled:opacity-40 active:bg-orange-50">
                      + Add
                    </button>
                  </div>
                </div>
                {/* Supplier invoice no */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Supplier Invoice No.</label>
                  <input type="text" value={grnForm.supplierInvoiceNo} onChange={e => setGrnForm(f => ({ ...f, supplierInvoiceNo: e.target.value }))}
                    placeholder="e.g. INV-2026-1234" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                </div>
                {/* Supplier invoice date — VAT Schedule 02 lists the supplier's
                    invoice date, which isn't always the day we received goods */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Supplier Invoice Date</label>
                  <input type="date" value={grnForm.supplierInvoiceDate} onChange={e => setGrnForm(f => ({ ...f, supplierInvoiceDate: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                  <p className="text-[10px] text-slate-400 mt-1">Needed for the VAT input schedule — leave blank if same as received</p>
                </div>
                {/* Date */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Date Received</label>
                  <input type="date" value={grnForm.receivedAt} onChange={e => setGrnForm(f => ({ ...f, receivedAt: e.target.value }))}
                    className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                </div>
                {/* Notes */}
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Notes (optional)</label>
                  <input type="text" value={grnForm.notes} onChange={e => setGrnForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder="e.g. Japan container June" className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                </div>
              </div>
            </div>

            {/* Product search + add items */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-sm text-slate-800">Items Received</h3>
                {/* Quick Add Tyre shortcut */}
                <button onClick={() => {
                  setGrnInlineCreate(true)
                  setGrnNewProduct(p => ({ ...p, category: 'Wheels & Tires', condition: 'Reconditioned' }))
                  setGrnProductSearch('')
                }} className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100 active:bg-sky-200">
                  🏎️ Quick Add Tyre
                </button>
              </div>
              {/* Search */}
              <div className="relative mb-3">
                <input type="search" value={grnProductSearch} onChange={e => setGrnProductSearch(e.target.value)}
                  placeholder="Search product by name or SKU to add…"
                  className="w-full pl-9 pr-3 py-2.5 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
                {grnProductSearch && <button onClick={() => setGrnProductSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">×</button>}
              </div>
              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="border border-slate-200 rounded-lg overflow-hidden mb-3 shadow-sm">
                  {searchResults.map((p: any) => {
                    const alreadyAdded = grnItems.some(i => i.productId === p.id)
                    return (
                      <button key={p.id} onClick={() => {
                        if (alreadyAdded) { showToast('Already in list — adjust qty below'); return }
                        setGrnItems(prev => [...prev, { productId: p.id, productName: p.name, productSku: p.sku || '', quantity: 1, unitCost: 0, vatRate: supplierVatRate(grnForm.supplierId) }])
                        setGrnProductSearch('')
                      }} className={`w-full text-left px-3 py-2.5 flex justify-between items-center border-b border-slate-100 last:border-0 active:bg-slate-50 ${alreadyAdded ? 'opacity-40' : ''}`}>
                        <div>
                          <span className="font-semibold text-sm">{p.name}</span>
                          <span className="text-xs text-slate-400 ml-2">{p.sku}</span>
                        </div>
                        <span className="text-xs text-slate-400">In stock: {p.quantity ?? 0}</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {grnProductSearch.length > 1 && searchResults.length === 0 && !grnInlineCreate && (
                <div className="border border-dashed border-orange-200 rounded-lg p-3 mb-3 bg-orange-50">
                  <p className="text-xs text-orange-700 font-semibold mb-2">"{grnProductSearch}" not found in your products.</p>
                  <button onClick={() => { setGrnInlineCreate(true); setGrnNewProduct(p => ({ ...p, name: grnProductSearch })) }}
                    className="text-xs font-bold text-orange-600 bg-white border border-orange-200 px-3 py-1.5 rounded-lg active:bg-orange-50">
                    + Create "{grnProductSearch}" and add to GRN
                  </button>
                </div>
              )}
              {/* Inline new product form */}
              {grnInlineCreate && (
                <div className={`border rounded-xl p-4 mb-3 space-y-3 ${grnNewProduct.category === 'Wheels & Tires' ? 'border-sky-200 bg-sky-50' : 'border-orange-200 bg-orange-50'}`}>
                  <div className="flex items-center justify-between">
                    <h4 className={`text-xs font-bold uppercase ${grnNewProduct.category === 'Wheels & Tires' ? 'text-sky-700' : 'text-orange-700'}`}>
                      {grnNewProduct.category === 'Wheels & Tires' ? '🏎️ New Tyre' : 'New Product'}
                    </h4>
                    {grnNewProduct.category !== 'Wheels & Tires' && (
                      <button onClick={() => setGrnNewProduct(p => ({ ...p, category: 'Wheels & Tires', tyre_width: '', tyre_profile: '', tyre_rim: '' }))}
                        className="text-[10px] text-sky-600 underline hover:text-sky-800">Switch to Tyre mode →</button>
                    )}
                  </div>

                  {/* Category + Condition */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Category</label>
                      <select value={grnNewProduct.category} onChange={e => setGrnNewProduct(p => ({ ...p, category: e.target.value, tyre_width: '', tyre_profile: '', tyre_rim: '' }))}
                        className="w-full px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-orange-400 bg-white">
                        {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Condition</label>
                      <select value={grnNewProduct.condition} onChange={e => setGrnNewProduct(p => ({ ...p, condition: e.target.value }))}
                        className="w-full px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-orange-400 bg-white">
                        {CONDITIONS.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* TYRE FIELDS */}
                  {grnNewProduct.category === 'Wheels & Tires' ? (
                    <div className="space-y-2">
                      {/* Size row */}
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] font-bold text-sky-600 uppercase block mb-1">Width</label>
                          <select value={grnNewProduct.tyre_width} onChange={e => {
                            const np = { ...grnNewProduct, tyre_width: e.target.value }
                            if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim)
                              np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                            setGrnNewProduct(np)
                          }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-xs outline-none bg-white focus:border-sky-400">
                            <option value="">–</option>{TYRE_WIDTHS.map(w => <option key={w} value={w}>{w}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-sky-600 uppercase block mb-1">Profile</label>
                          <select value={grnNewProduct.tyre_profile} onChange={e => {
                            const np = { ...grnNewProduct, tyre_profile: e.target.value }
                            if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim)
                              np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                            setGrnNewProduct(np)
                          }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-xs outline-none bg-white focus:border-sky-400">
                            <option value="">–</option>{TYRE_PROFILES.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-sky-600 uppercase block mb-1">Rim (R)</label>
                          <select value={grnNewProduct.tyre_rim} onChange={e => {
                            const np = { ...grnNewProduct, tyre_rim: e.target.value }
                            if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim)
                              np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${np.make ? ' ' + np.make : ''}`
                            setGrnNewProduct(np)
                          }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-xs outline-none bg-white focus:border-sky-400">
                            <option value="">–</option>{TYRE_RIMS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                      {/* Brand (make) */}
                      <div>
                        <label className="text-[10px] font-bold text-sky-600 uppercase block mb-1">Brand</label>
                        <select value={grnNewProduct.make} onChange={e => {
                          const np = { ...grnNewProduct, make: e.target.value }
                          if (!np.name && np.tyre_width && np.tyre_profile && np.tyre_rim)
                            np.name = `${np.tyre_width}/${np.tyre_profile}R${np.tyre_rim}${e.target.value ? ' ' + e.target.value : ''}`
                          setGrnNewProduct(np)
                        }} className="w-full px-2 py-2 rounded-lg border-2 border-sky-200 text-xs outline-none bg-white focus:border-sky-400">
                          <option value="">— Select brand —</option>
                          {TYRE_BRANDS.map(b => <option key={b} value={b}>{b}</option>)}
                          <option value="">Other (type below)</option>
                        </select>
                      </div>
                      {/* Name (auto-generated or override) */}
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                          Name *
                          {grnNewProduct.tyre_width && grnNewProduct.tyre_profile && grnNewProduct.tyre_rim && (
                            <button type="button" onClick={() => setGrnNewProduct(p => ({ ...p, name: `${p.tyre_width}/${p.tyre_profile}R${p.tyre_rim}${p.make ? ' ' + p.make : ''}`.trim() }))}
                              className="ml-2 font-normal text-sky-600 underline">Auto-fill</button>
                          )}
                        </label>
                        <input type="text" value={grnNewProduct.name} onChange={e => setGrnNewProduct(p => ({ ...p, name: e.target.value }))}
                          placeholder="e.g. 185/65R15 Bridgestone"
                          className="w-full px-2 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-sky-400" />
                      </div>
                    </div>
                  ) : (
                    /* Normal part fields */
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Make</label>
                        <input type="text" value={grnNewProduct.make} onChange={e => setGrnNewProduct(p => ({ ...p, make: e.target.value }))}
                          placeholder="Toyota" className="w-full px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-orange-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Model</label>
                        <input type="text" value={grnNewProduct.model} onChange={e => setGrnNewProduct(p => ({ ...p, model: e.target.value }))}
                          className="w-full px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-orange-400" />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Name *</label>
                        <input type="text" value={grnNewProduct.name} onChange={e => setGrnNewProduct(p => ({ ...p, name: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400" />
                      </div>
                    </div>
                  )}

                  {/* Selling Price — both modes */}
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Selling Price (Rs.)</label>
                    <input type="number" value={grnNewProduct.price} onChange={e => setGrnNewProduct(p => ({ ...p, price: e.target.value }))}
                      placeholder="0" className="w-full px-2 py-2 rounded-lg border-2 border-slate-200 text-xs outline-none focus:border-orange-400" />
                  </div>

                  <div className="flex gap-2">
                    <button onClick={grnInlineCreateProduct} disabled={grnInlineCreating || !grnNewProduct.name.trim()}
                      className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
                      {grnInlineCreating ? 'Creating…' : 'Create & Add to GRN'}
                    </button>
                    <button onClick={() => { setGrnInlineCreate(false); setGrnProductSearch(''); setGrnNewProduct({ name: '', category: 'Other', condition: 'Reconditioned', make: '', model: '', price: '', tyre_width: '', tyre_profile: '', tyre_rim: '' }) }}
                      className="text-xs font-bold text-slate-500 px-4 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
                  </div>
                </div>
              )}

              {/* CSV Upload */}
              {!grnInlineCreate && (
                <div className="mt-1 mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">or</span>
                    <label className="cursor-pointer inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 active:bg-blue-200">
                      📎 Upload CSV
                      <input type="file" accept=".csv" className="hidden" onChange={e => { if (e.target.files?.[0]) handleGrnCsvUpload(e.target.files[0]); e.target.value = '' }} />
                    </label>
                    <button onClick={downloadGrnCsvTemplate} className="text-[11px] text-slate-400 hover:text-slate-600 underline">⬇ Download template</button>
                  </div>
                  {/* CSV preview panel */}
                  {grnCsvPreview && (
                    <div className="mt-3 border border-blue-200 rounded-xl overflow-hidden">
                      <div className="bg-blue-50 px-4 py-2.5 flex justify-between items-center flex-wrap gap-2">
                        <div>
                          <span className="text-xs font-bold text-blue-800">{grnCsvFileName}</span>
                          <span className="text-[10px] text-blue-500 ml-2">— {grnCsvPreview.length} row{grnCsvPreview.length !== 1 ? 's' : ''} parsed</span>
                        </div>
                        <div className="flex gap-2 items-center">
                          <button onClick={confirmGrnCsvAdd}
                            className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-lg">
                            + Add {grnCsvPreview.length} item{grnCsvPreview.length !== 1 ? 's' : ''} to GRN
                          </button>
                          <button onClick={() => { setGrnCsvPreview(null); setGrnCsvFileName('') }} className="text-slate-400 hover:text-slate-600 font-bold text-sm">✕</button>
                        </div>
                      </div>
                      {(() => {
                        const sup = suppliers.find((x: any) => x.id === grnForm.supplierId)
                        const zeroRows = grnCsvPreview.filter(r => !r.grnItem.vatRate)
                        if (!sup?.vat_registered || zeroRows.length === 0) return null
                        const lostVat = zeroRows.reduce((t, r) => t + Math.round(r.grnItem.quantity * r.grnItem.unitCost * vatRate / 100), 0)
                        return (
                          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center justify-between flex-wrap gap-2">
                            <p className="text-[11px] font-bold text-amber-800">
                              ⚠️ {zeroRows.length} row{zeroRows.length !== 1 ? 's' : ''} came in at 0% VAT, but {sup.name} is VAT-registered
                              {lostVat > 0 && <> — that&apos;s Rs.{lostVat.toLocaleString()} of input VAT not claimed</>}
                            </p>
                            <button
                              onClick={() => setGrnCsvPreview(prev => prev && prev.map(r =>
                                r.grnItem.vatRate ? r : { ...r, grnItem: { ...r.grnItem, vatRate } }))}
                              className="text-[11px] font-black px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white shrink-0">
                              Set them to {vatRate}%
                            </button>
                          </div>
                        )
                      })()}
                      <div className="overflow-x-auto max-h-56 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-white border-b border-slate-100">
                            <tr className="text-[10px] font-bold text-slate-400 uppercase">
                              <th className="px-3 py-2 text-left">Product</th>
                              <th className="px-3 py-2 text-center w-14">Qty</th>
                              <th className="px-3 py-2 text-right w-24">Unit Cost</th>
                              <th className="px-3 py-2 text-center w-14">VAT</th>
                              <th className="px-3 py-2 text-center w-20">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {grnCsvPreview.map((row, i) => (
                              <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                                <td className="px-3 py-2">
                                  <span className="font-semibold">{row.grnItem.productName}</span>
                                  {row.grnItem.productSku && <span className="text-slate-400 ml-1 text-[10px]">{row.grnItem.productSku}</span>}
                                  {row.grnItem.productData?.condition && <span className="ml-1 text-[10px] text-slate-400 italic">{row.grnItem.productData.condition}</span>}
                                </td>
                                <td className="px-3 py-2 text-center">{row.grnItem.quantity}</td>
                                <td className="px-3 py-2 text-right">Rs.{row.grnItem.unitCost.toLocaleString()}</td>
                                <td className="px-3 py-2 text-center">{row.grnItem.vatRate}%</td>
                                <td className="px-3 py-2 text-center">
                                  {row.matched
                                    ? <span className="text-[10px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded">✓ Matched</span>
                                    : <span className="text-[10px] font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">★ New</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {grnCsvPreview.some(r => !r.matched) && (
                        <div className="bg-blue-50 border-t border-blue-100 px-4 py-2 text-[11px] text-blue-600">
                          ★ <strong>New</strong> items will be created as products automatically when you save the GRN.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Items table */}
              {grnItems.length > 0 && (
                <div className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 mb-3 text-[11px] text-blue-700">
                  ℹ️ Enter unit costs <strong>excluding VAT</strong>. VAT is calculated separately per line.
                  {suppliers.find(s => s.id === grnForm.supplierId)?.currency !== 'LKR' && suppliers.find(s => s.id === grnForm.supplierId)?.currency && (
                    <span className="ml-2 font-semibold">Supplier currency: {suppliers.find(s => s.id === grnForm.supplierId)?.currency} — enter LKR equivalent, record original amount in the currency column.</span>
                  )}
                </div>
              )}
              {grnItems.length === 0 ? (
                <div className="text-center py-8 text-slate-300"><p className="text-3xl mb-2">📦</p><p className="text-sm">Search above to add items</p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead><tr className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                      <th className="pb-2 text-left">Product</th>
                      <th className="pb-2 text-center w-20">Qty</th>
                      <th className="pb-2 text-right w-28">Unit Cost (excl. VAT)</th>
                      <th className="pb-2 text-center w-20">VAT %</th>
                      <th className="pb-2 text-right w-24">Line Total</th>
                      <th className="pb-2 w-8"></th>
                    </tr></thead>
                    <tbody>
                      {grnItems.map((item, i) => (
                        <tr key={i} className="border-t border-slate-50">
                          <td className="py-2">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-semibold">{item.productName}</p>
                              {item.needsCreate && <span className="text-[9px] font-bold text-blue-700 bg-blue-100 px-1 py-0.5 rounded">★ NEW</span>}
                            </div>
                            <p className="text-slate-400 text-[10px]">{item.productSku || item.productData?.condition}</p>
                          </td>
                          <td className="py-2 text-center">
                            <input type="number" min="1" value={item.quantity}
                              onChange={e => setGrnItems(prev => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                              className="w-16 px-1.5 py-1 border border-slate-200 rounded text-center text-sm" />
                          </td>
                          <td className="py-2">
                            <input type="number" min="0" value={item.unitCost || ''}
                              placeholder="LKR excl. VAT"
                              onChange={e => setGrnItems(prev => prev.map((x, j) => j === i ? { ...x, unitCost: Math.max(0, parseInt(e.target.value) || 0) } : x))}
                              className="w-28 px-1.5 py-1 border border-slate-200 rounded text-right text-sm" />
                          </td>
                          <td className="py-2 text-center">
                            <select value={item.vatRate}
                              onChange={e => {
                                const rate = parseFloat(e.target.value)
                                const sup = suppliers.find((s: any) => s.id === grnForm.supplierId)
                                if (rate > 0 && sup && !sup.vat_registered) showToast('⚠️ ' + sup.name + ' is not VAT-registered — this VAT cannot be claimed as input VAT')
                                setGrnItems(prev => prev.map((x, j) => j === i ? { ...x, vatRate: rate } : x))
                              }}
                              className="px-1.5 py-1 border border-slate-200 rounded text-xs bg-white">
                              <option value={0}>0%</option>
                              <option value={vatRate}>{vatRate}%</option>
                            </select>
                          </td>
                          <td className="py-2 text-right font-semibold">
                            Rs.{(item.quantity * item.unitCost).toLocaleString()}
                            {item.vatRate > 0 && <p className="text-[10px] text-orange-500 font-normal">+VAT Rs.{Math.round(item.quantity * item.unitCost * item.vatRate / 100).toLocaleString()}</p>}
                          </td>
                          <td className="py-2 text-center">
                            <button onClick={() => setGrnItems(prev => prev.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 font-bold">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals + submit */}
              {grnItems.length > 0 && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex flex-col items-end gap-1 text-sm mb-4">
                    <div className="flex gap-8"><span className="text-slate-400">Net Cost (ex VAT)</span><span className="font-semibold w-32 text-right">Rs.{grnNetCost.toLocaleString()}</span></div>
                    <div className="flex gap-8"><span className="text-slate-400">Input VAT</span><span className="font-semibold w-32 text-right text-orange-600">Rs.{grnInputVat.toLocaleString()}</span></div>
                    <div className="flex gap-8 border-t border-slate-200 pt-1 mt-1"><span className="font-bold text-slate-700">Total Cost</span><span className="font-black w-32 text-right">Rs.{grnTotal.toLocaleString()}</span></div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => createGrn(false)} disabled={grnLoading}
                      className="bg-white border-2 border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 font-bold text-sm py-3 px-5 rounded-xl">
                      {grnLoading ? '⏳' : '💾 Save as Draft'}
                    </button>
                    <button onClick={() => createGrn(true)} disabled={grnLoading}
                      className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-black text-sm py-3 rounded-xl">
                      {grnLoading ? '⏳ Saving…' : '✅ Post & Update Stock'}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 text-center mt-2">
                    Post = stock counted and checked against the delivery note. Draft = still unpacking — finish it later from GRN History.
                  </p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── GRN HISTORY ── */}
      {stockMainView === 'history' && (
        <div className="space-y-3">
          {grnListLoading ? (
            <div className="text-center py-10"><div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : grnList.length === 0 ? (
            <div className="text-center py-12 text-slate-300"><p className="text-4xl mb-2">📜</p><p className="text-sm font-semibold">No GRNs yet</p><button onClick={() => setStockMainView('receive')} className="mt-3 text-xs font-bold text-orange-500">Receive your first stock →</button></div>
          ) : grnList.map((grn: any) => {
            const isPosted = grn.status === 'posted'
            const totalQty = (grn.items || []).reduce((s: number, i: any) => s + i.quantity, 0)
            return (
              <div key={grn.id} className={`bg-white rounded-xl border ${isPosted ? 'border-green-200' : 'border-amber-200'} p-4`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-black font-mono text-sm">{grn.grn_number}</span>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isPosted ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {isPosted ? '✅ POSTED' : '📋 DRAFT'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">{grn.supplier_name || 'No supplier'}{grn.supplier_invoice_no ? ` · ${grn.supplier_invoice_no}` : ''}</p>
                    <p className="text-xs text-slate-400">{grn.received_at} · {totalQty} unit{totalQty !== 1 ? 's' : ''} · {(grn.items || []).length} line{(grn.items || []).length !== 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-black text-sm">Rs.{parseInt(grn.total_cost || 0).toLocaleString()}</p>
                    {grn.input_vat > 0 && <p className="text-[10px] text-orange-500">VAT: Rs.{parseInt(grn.input_vat || 0).toLocaleString()}</p>}
                  </div>
                </div>
                {/* Items preview */}
                <div className="mt-3 space-y-1">
                  {(grn.items || []).slice(0, 5).map((item: any, i: number) => (
                    <div key={i} className="flex justify-between text-xs text-slate-500">
                      <span>{item.product_name} <span className="text-slate-300">×{item.quantity}</span></span>
                      <span>Rs.{parseInt(item.unit_cost || 0).toLocaleString()} ea</span>
                    </div>
                  ))}
                  {(grn.items || []).length > 5 && <p className="text-[10px] text-slate-400">…+{(grn.items || []).length - 5} more</p>}
                </div>
                {/* Actions */}
                {!isPosted && grn.status !== 'reversed' && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex gap-2 flex-wrap">
                    <button onClick={() => postGrn(grn.id)} disabled={grnPosting === grn.id}
                      className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-bold py-2 rounded-lg">
                      {grnPosting === grn.id ? '⏳ Posting…' : '✅ Post & Update Stock'}
                    </button>
                    <button onClick={() => {
                      setEditingGrnId(grn.id)
                      setEditingGrnItems((grn.items || []).map((it: any) => ({
                        productId: it.product_id || null,
                        productName: it.product_name,
                        productSku: it.product_sku || '',
                        quantity: it.quantity,
                        unitCost: it.unit_cost || 0,
                        vatRate: parseFloat(it.vat_rate) || 0,
                        foreignCurrency: it.foreign_currency || '',
                        foreignAmount: it.foreign_amount ? String(it.foreign_amount) : '',
                      })))
                    }} className="px-3 py-2 text-xs font-bold text-blue-500 border border-blue-200 rounded-lg active:bg-blue-50">
                      ✏️ Edit
                    </button>
                    <button onClick={() => deleteGrn(grn.id, grn.grn_number)}
                      className="px-3 py-2 text-xs font-bold text-red-400 border border-red-200 rounded-lg active:bg-red-50">
                      🗑 Delete
                    </button>
                  </div>
                )}
                {isPosted && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex justify-end">
                    <button onClick={() => reverseGrn(grn.id, grn.grn_number)} disabled={grnReversing === grn.id}
                      className="px-3 py-2 text-xs font-bold text-amber-600 border border-amber-200 rounded-lg active:bg-amber-50 disabled:opacity-40">
                      {grnReversing === grn.id ? '⏳ Reversing…' : '↩ Reverse GRN'}
                    </button>
                  </div>
                )}
                {grn.status === 'reversed' && (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">REVERSED — stock reduced, cost layers removed</span>
                  </div>
                )}
                {grn.notes && <p className="text-[10px] text-slate-400 mt-2 italic">{grn.notes}</p>}
                {/* Inline edit form for draft GRN */}
                {editingGrnId === grn.id && (
                  <div className="mt-4 pt-4 border-t-2 border-blue-100 space-y-3">
                    <h4 className="text-xs font-bold text-blue-700 uppercase">Edit Items</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead><tr className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100">
                          <th className="pb-2 text-left">Product</th>
                          <th className="pb-2 text-center w-16">Qty</th>
                          <th className="pb-2 text-right w-24">Cost (excl. VAT)</th>
                          <th className="pb-2 text-center w-16">VAT %</th>
                          <th className="pb-2 w-6"></th>
                        </tr></thead>
                        <tbody>
                          {editingGrnItems.map((item, i) => (
                            <tr key={i} className="border-t border-slate-50">
                              <td className="py-1.5 font-semibold text-slate-700">{item.productName}<span className="text-slate-400 ml-1 text-[10px]">{item.productSku}</span></td>
                              <td className="py-1.5 text-center">
                                <input type="number" min="1" value={item.quantity}
                                  onChange={e => setEditingGrnItems(prev => prev.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))}
                                  className="w-14 px-1 py-1 border border-slate-200 rounded text-center text-xs" />
                              </td>
                              <td className="py-1.5">
                                <input type="number" min="0" value={item.unitCost || ''}
                                  onChange={e => setEditingGrnItems(prev => prev.map((x, j) => j === i ? { ...x, unitCost: Math.max(0, parseInt(e.target.value) || 0) } : x))}
                                  className="w-24 px-1 py-1 border border-slate-200 rounded text-right text-xs" />
                              </td>
                              <td className="py-1.5 text-center">
                                <select value={item.vatRate}
                                  onChange={e => setEditingGrnItems(prev => prev.map((x, j) => j === i ? { ...x, vatRate: parseFloat(e.target.value) } : x))}
                                  className="px-1 py-1 border border-slate-200 rounded text-xs bg-white">
                                  <option value={0}>0%</option>
                                  <option value={18}>18%</option>
                                </select>
                              </td>
                              <td className="py-1.5 text-center">
                                <button onClick={() => setEditingGrnItems(prev => prev.filter((_, j) => j !== i))} className="text-red-400 font-bold">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={saveGrnEdits} disabled={editingGrnSaving || editingGrnItems.length === 0}
                        className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
                        {editingGrnSaving ? 'Saving…' : '💾 Save Changes'}
                      </button>
                      <button onClick={() => setEditingGrnId(null)} className="text-xs font-bold text-slate-500 px-4 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── STOCKTAKE (Stock Levels) ── */}
      {stockMainView === 'stocktake' && (<div>
      {/* ── Mode toggle — horizontal scroll on narrow screens ── */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
        <button onClick={() => setStockView('browse')}
          className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold border-2 transition ${stockView === 'browse' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}>
          📦 Browse & Count
        </button>
        <button onClick={() => setStockView('assign')}
          className={`shrink-0 whitespace-nowrap px-4 py-2 rounded-xl text-sm font-bold border-2 transition ${stockView === 'assign' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-500 border-slate-200'}`}>
          📍 Quick Assign
        </button>
        {pendingCount > 0 && stockView === 'browse' && (
          <button onClick={() => saveAllStockChanges()} disabled={stocktakeSaving}
            className="ml-auto bg-orange-500 active:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-xl disabled:opacity-50 shrink-0">
            {stocktakeSaving ? 'Saving...' : `Save ${pendingCount} Change${pendingCount !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      {/* ══════════════════════════════════════════ */}
      {/* BROWSE & COUNT MODE                       */}
      {/* ══════════════════════════════════════════ */}
      {stockView === 'browse' && (
        <div>
          {/* 4-level filter row */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase">Filter by Location</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Store</label>
                <select value={stockFilter.store} onChange={e => setStockFilter(f => ({...f, store: e.target.value, floor: '', sub1: '', sub2: ''}))} className={dropdownCls}>
                  <option value="">All Stores</option>
                  {allStores.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Floor</label>
                <select value={stockFilter.floor} onChange={e => setStockFilter(f => ({...f, floor: e.target.value, sub1: '', sub2: ''}))} className={dropdownCls}>
                  <option value="">All Floors</option>
                  {allFloors.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Sub Location 1</label>
                <select value={stockFilter.sub1} onChange={e => setStockFilter(f => ({...f, sub1: e.target.value, sub2: ''}))} className={dropdownCls}>
                  <option value="">All</option>
                  {allSub1s.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 mb-1">Sub Location 2</label>
                <select value={stockFilter.sub2} onChange={e => setStockFilter(f => ({...f, sub2: e.target.value}))} className={dropdownCls}>
                  <option value="">All</option>
                  {allSub2s.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            {/* Search within filter */}
            <div className="relative">
              <input type="search" placeholder="Search by name or SKU…" value={stocktakeSearch}
                onChange={e => setStocktakeSearch(e.target.value)}
                className="w-full px-4 py-2.5 text-sm rounded-lg border-2 border-slate-200 outline-none focus:border-orange-400 bg-white" />
              {stocktakeSearch && <button onClick={() => setStocktakeSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">×</button>}
            </div>
            {anyFilter && (
              <button onClick={() => { setStockFilter({ store: '', floor: '', sub1: '', sub2: '' }); setStocktakeSearch('') }}
                className="text-xs font-bold text-orange-500 hover:text-orange-700">✕ Clear all filters</button>
            )}
          </div>

          {/* Results header */}
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-slate-400 uppercase">{browseProducts.length} product{browseProducts.length !== 1 ? 's' : ''}{anyFilter ? ' matching' : ''}</p>
            {pendingCount > 0 && <p className="text-xs font-bold text-amber-600">{pendingCount} unsaved — press Save</p>}
          </div>

          {/* Product list */}
          {browseProducts.length === 0 ? (
            <div className="text-center py-16 bg-white rounded-xl border border-slate-200">
              <p className="text-3xl mb-3">🔍</p>
              <p className="text-slate-500 font-semibold">No products match these filters</p>
              <button onClick={() => { setStockFilter({ store: '', floor: '', sub1: '', sub2: '' }); setStocktakeSearch('') }} className="mt-3 text-sm text-orange-500 font-bold">Clear filters</button>
            </div>
          ) : (
            <div className="space-y-2 pb-24 sm:pb-4">
              {browseProducts.map((p: any) => {
                const curQty = stockQtyEdits[p.id] ?? p.quantity
                const changed = stockQtyEdits[p.id] !== undefined
                const confirmed = stockConfirmSet.has(p.id)
                const loc = locLabel(p)
                const ago = confirmedAgo(p.last_stock_confirmed_at)
                return (
                  <div key={p.id} className={`bg-white rounded-xl border p-4 ${changed ? 'border-orange-300 bg-orange-50' : confirmed ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    {/* Top row: info + confirmed badge */}
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-0.5">
                          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 shrink-0">{p.sku}</span>
                          {p.condition && <span className="text-[10px] font-semibold text-slate-400">{p.condition}</span>}
                        </div>
                        <p className="font-bold text-slate-900 leading-tight">{p.name}</p>
                        {(p.make || p.model) && <p className="text-xs text-slate-400 mt-0.5">{p.make} {p.model}</p>}
                        {loc && !anyFilter && <p className="text-[10px] font-semibold text-amber-700 mt-0.5">📍 {loc}</p>}
                        {changed && <p className="text-[10px] font-bold text-orange-600 mt-0.5">Was {p.quantity} → now {curQty}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        {ago
                          ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${ago.cls}`}>✓ {ago.label}</span>
                          : <span className="text-[10px] font-semibold text-slate-300 px-2 py-0.5 rounded-full bg-slate-50">Never confirmed</span>}
                        {!changed && (
                          <button
                            onClick={() => setStockConfirmSet(prev => { const n = new Set(prev); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n })}
                            className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border transition active:scale-95 ${confirmed ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-400 hover:text-emerald-600'}`}>
                            {confirmed ? '✓ Confirmed' : 'Confirm'}
                          </button>
                        )}
                      </div>
                    </div>
                    {/* Bottom row: qty controls + damage */}
                    <div className="flex items-center gap-2">
                      <button onClick={() => setStockQtyEdits(prev => ({...prev, [p.id]: Math.max(0, (prev[p.id] ?? p.quantity) - 1)}))}
                        className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold text-2xl flex items-center justify-center active:bg-slate-200 select-none">−</button>
                      <input type="number" inputMode="numeric" min="0" value={curQty}
                        onChange={e => setStockQtyEdits(prev => ({...prev, [p.id]: Math.max(0, parseInt(e.target.value) || 0)}))}
                        className="w-20 h-10 text-center font-bold text-lg border-2 rounded-xl outline-none focus:border-orange-400 border-slate-200 bg-white" />
                      <button onClick={() => setStockQtyEdits(prev => ({...prev, [p.id]: (prev[p.id] ?? p.quantity) + 1}))}
                        className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-bold text-2xl flex items-center justify-center active:bg-slate-200 select-none">+</button>
                      <button onClick={() => setDamageProduct(p)}
                        className="ml-auto h-10 px-3 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-700 font-bold text-xs active:bg-amber-100">
                        ⚠ Damage
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Sticky save bar — mobile */}
          {pendingCount > 0 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-orange-200 p-4 z-50 sm:hidden">
              <button onClick={() => saveAllStockChanges()} disabled={stocktakeSaving}
                className="w-full bg-orange-500 text-white font-bold py-3 rounded-xl disabled:opacity-50 text-base">
                {stocktakeSaving ? 'Saving...' : `✓ Save ${pendingCount} Change${pendingCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════ */}
      {/* QUICK ASSIGN MODE                         */}
      {/* ══════════════════════════════════════════ */}
      {stockView === 'assign' && (
        <div className="pb-24 sm:pb-4">
          {/* Set current location — collapses to a one-line banner once set */}
          {locCollapsed && anyAssignLoc ? (
            <div className="bg-amber-100 border-2 border-amber-300 rounded-xl px-3 py-2.5 mb-4 flex items-center gap-2">
              <p className="flex-1 text-sm font-bold text-amber-900 truncate">📍 {[assignLoc.store, assignLoc.floor, assignLoc.sub1, assignLoc.sub2].filter(Boolean).join(' › ')}</p>
              <button onClick={() => setLocCollapsed(false)}
                className="shrink-0 text-xs font-bold text-amber-700 border border-amber-300 bg-white rounded-lg px-2.5 py-1.5 active:bg-amber-50">✎ Change</button>
            </div>
          ) : (
          <div className="bg-amber-50 border-2 border-amber-300 rounded-xl p-4 mb-5">
            <p className="text-xs font-bold text-amber-800 uppercase mb-3">📍 I'm standing at this location</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Store</label>
                <input value={assignLoc.store} onChange={e => setAssignLoc(l => ({...l, store: e.target.value}))}
                  list="assign-stores" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Main Store" />
                <datalist id="assign-stores">{allStores.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Floor</label>
                <input value={assignLoc.floor} onChange={e => setAssignLoc(l => ({...l, floor: e.target.value}))}
                  list="assign-floors" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Ground" />
                <datalist id="assign-floors">{allFloors.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Sub Location 1</label>
                <input value={assignLoc.sub1} onChange={e => setAssignLoc(l => ({...l, sub1: e.target.value}))}
                  list="assign-sub1s" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Rack A" />
                <datalist id="assign-sub1s">{allSub1s.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-amber-700 mb-1">Sub Location 2</label>
                <input value={assignLoc.sub2} onChange={e => setAssignLoc(l => ({...l, sub2: e.target.value}))}
                  list="assign-sub2s" className="w-full px-3 py-2.5 rounded-lg border-2 border-amber-200 text-sm outline-none bg-white focus:border-orange-400" placeholder="Bin 5" />
                <datalist id="assign-sub2s">{allSub2s.map(s => <option key={s} value={s} />)}</datalist>
              </div>
            </div>
            {anyAssignLoc
              ? <>
                  <div className="bg-amber-100 border border-amber-300 rounded-lg px-3 py-2 text-sm font-bold text-amber-900">📍 {[assignLoc.store, assignLoc.floor, assignLoc.sub1, assignLoc.sub2].filter(Boolean).join(' › ')}</div>
                  <button onClick={() => setLocCollapsed(true)}
                    className="mt-2 w-full bg-amber-500 active:bg-amber-600 text-white font-bold py-2.5 rounded-lg text-sm">✓ Done — start assigning</button>
                </>
              : <p className="text-xs text-amber-600">Fill at least one field above to start assigning</p>
            }
          </div>
          )}

          {/* Product search */}
          <div className="relative mb-3">
            <input type="search" placeholder="Search product by name or SKU to assign…" value={assignSearch}
              onChange={e => setAssignSearch(e.target.value)}
              className="w-full px-4 py-3 text-base rounded-xl border-2 border-slate-200 outline-none focus:border-orange-400 bg-white" />
            {assignSearch && <button onClick={() => setAssignSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-lg">×</button>}
          </div>

          {assignSearch.length < 2 && (
            <p className="text-xs text-slate-400 text-center py-6">Type at least 2 characters to search products</p>
          )}
          {assignSearch.length >= 2 && assignResults.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">No products match &ldquo;{assignSearch}&rdquo;</p>
          )}

          {/* Basket on top while browsing; while searching it renders below the
              results instead so matches stay the first thing under the box */}
          {assignSearch.length < 2 && assignBasketBlock}

          {/* ── At this location ── browse aid; hidden while searching so the
                 searched item (with its Assign button) is the first thing under
                 the search box instead of buried below the whole location list */}
          {anyAssignLoc && assignSearch.length < 2 && (() => {
            const atLoc = allProducts.filter((p: any) =>
              (!assignLoc.store || p.loc_store === assignLoc.store) &&
              (!assignLoc.floor || p.loc_floor === assignLoc.floor) &&
              (!assignLoc.sub1  || p.loc_sub1  === assignLoc.sub1) &&
              (!assignLoc.sub2  || p.loc_sub2  === assignLoc.sub2))
            if (!atLoc.length) return (
              <div className="mb-4 text-center py-4 border-2 border-dashed border-slate-200 rounded-xl">
                <p className="text-sm text-slate-400">No products assigned here yet</p>
              </div>
            )
            return (
              <div className="mb-5">
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">At this location — {atLoc.length} part{atLoc.length !== 1 ? 's' : ''}</p>
                <div className="space-y-1.5">
                  {atLoc.map((p: any) => {
                    const ago = confirmedAgo(p.last_stock_confirmed_at)
                    const isClearing = assignLoading === ('clear-' + p.id)
                    return (
                      <div key={p.id} className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.sku}</span>
                          <p className="font-semibold text-slate-900 text-sm leading-tight mt-0.5">{p.name}</p>
                          {(p.make || p.model) && <p className="text-xs text-slate-400">{p.make} {p.model}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-slate-700 text-sm">qty: {p.quantity}</p>
                          {ago
                            ? <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${ago.cls}`}>✓ {ago.label}</span>
                            : <span className="text-[10px] text-slate-300">not confirmed</span>}
                        </div>
                        <button
                          disabled={isClearing}
                          onClick={async () => {
                            setAssignLoading('clear-' + p.id)
                            await fetch('/api/vendor/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'update', productId: p.id, data: { loc_store: null, loc_floor: null, loc_sub1: null, loc_sub2: null } }) })
                            await onDataChanged()
                            setAssignLoading(null)
                            showToast('Location cleared')
                          }}
                          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 active:bg-red-100 border border-slate-200 text-lg font-bold disabled:opacity-40 transition">
                          {isClearing ? '…' : '✕'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {assignResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase mb-1">Search results — {assignResults.length}{assignResults.length === 20 ? '+' : ''}</p>
              {assignResults.map((p: any) => {
                const currentLoc = locLabel(p)
                const alreadyHere = anyAssignLoc &&
                  (!assignLoc.store || p.loc_store === assignLoc.store) &&
                  (!assignLoc.floor || p.loc_floor === assignLoc.floor) &&
                  (!assignLoc.sub1  || p.loc_sub1  === assignLoc.sub1) &&
                  (!assignLoc.sub2  || p.loc_sub2  === assignLoc.sub2)
                return (
                  <div key={p.id} className={`bg-white rounded-xl border p-4 flex items-center gap-3 ${alreadyHere ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
                    <div className="flex-1 min-w-0">
                      <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{p.sku}</span>
                      <p className="font-bold text-slate-900 leading-tight mt-0.5">{p.name}</p>
                      {(p.make || p.model) && <p className="text-xs text-slate-400">{p.make} {p.model}</p>}
                      {currentLoc
                        ? <p className="text-[10px] font-semibold text-amber-700 mt-0.5">📍 {currentLoc}</p>
                        : <p className="text-[10px] text-slate-300 mt-0.5">No location set</p>}
                    </div>
                    {alreadyHere ? (
                      <span className="text-emerald-600 font-bold text-sm shrink-0">✓ Here</span>
                    ) : assignBasket.some((b: any) => b.id === p.id) ? (
                      <button onClick={() => removeFromBasket(p.id)}
                        className="text-amber-700 font-bold text-sm shrink-0 px-3 py-2.5 rounded-xl border-2 border-amber-300 bg-amber-50">
                        ✓ Added
                      </button>
                    ) : (
                      /* Adds to the basket (counted qty defaults to 1) and clears
                         the search — ready to type the next SKU. Everything
                         commits together via Assign all. */
                      <button
                        onClick={() => { setAssignBasket(prev => [...prev, p]); setBasketQty(prev => ({ ...prev, [p.id]: 1 })); setAssignSearch('') }}
                        className="bg-amber-500 active:bg-amber-600 text-white text-sm font-bold px-4 py-2.5 rounded-xl shrink-0">
                        + Add
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {assignSearch.length >= 2 && assignBasketBlock}

          {/* Sticky assign bar — mobile: reachable without scrolling back up */}
          {assignBasket.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-amber-300 p-3 z-50 sm:hidden">
              <button onClick={assignAllBasket} disabled={!anyAssignLoc || assignSaving}
                className="w-full bg-amber-500 active:bg-amber-600 text-white font-bold py-3 rounded-xl disabled:opacity-40 text-sm">
                {assignSaving ? 'Assigning…' : anyAssignLoc ? `📍 Assign all ${assignBasket.length}` : `${assignBasket.length} picked — set a location first`}
              </button>
            </div>
          )}
        </div>
      )}
      </div>
      )}{/* end stocktake view */}

      {/* ── STOCKTAKE COST PROMPT MODAL ── */}
      {stocktakeCostPrompt && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
            <div className="bg-amber-50 px-5 py-4 border-b border-amber-100">
              <h3 className="font-bold text-base text-amber-800">📦 Stock Added — Track Cost?</h3>
              <p className="text-xs text-amber-600 mt-1">You increased stock for {stocktakeCostPrompt.length} product{stocktakeCostPrompt.length !== 1 ? 's' : ''}. Enter the purchase cost to keep FIFO and Gross Profit accurate.</p>
            </div>
            <div className="px-5 py-4 space-y-3 max-h-80 overflow-y-auto">
              {stocktakeCostPrompt.map((item, i) => (
                <div key={item.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-800 truncate">{item.name}</p>
                    <p className="text-[11px] text-slate-400">{item.oldQty} → {item.newQty} <span className="text-green-600 font-bold">(+{item.delta})</span></p>
                  </div>
                  <div className="shrink-0">
                    <label className="text-[10px] font-bold text-slate-400 block mb-1">Cost/unit (Rs.)</label>
                    <input type="number" min="0" placeholder="optional"
                      value={item.cost}
                      onChange={e => setStocktakeCostPrompt(prev => prev!.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))}
                      className="w-28 px-2 py-1.5 border-2 border-slate-200 rounded-lg text-sm text-right outline-none focus:border-orange-400" />
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 pb-5 space-y-2">
              <button onClick={saveStocktakeWithCost} disabled={stocktakeCostSaving}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-bold text-sm py-3 rounded-xl">
                {stocktakeCostSaving ? '⏳ Saving…' : '✅ Save with Cost Tracking'}
              </button>
              <button onClick={() => { setStocktakeCostPrompt(null); saveAllStockChanges(true) }}
                className="w-full text-sm text-slate-400 font-semibold py-2 hover:text-slate-600">
                Save without cost tracking (GP won't be accurate for these units)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSFER STOCK ── */}
      {stockMainView === 'transfer' && (
        <StockTransfer vendor={vendor} products={products} showToast={showToast} onDataChanged={onDataChanged} />
      )}

      {/* ── Damage capture sheet (from stock count) ── */}
      {damageProduct && (
        <DamageCapture
          product={damageProduct}
          showToast={showToast}
          onClose={() => setDamageProduct(null)}
          onSaved={() => onDataChanged()}
        />
      )}

      {/* ── Did you pay for this now? (after posting a GRN) ── */}
      {payNow && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5">
            <h3 className="text-lg font-black text-slate-900">Did you pay for this now?</h3>
            <p className="text-xs text-slate-500 mt-0.5 mb-4">
              {payNow.payable.invoice_no} · Rs.{Number(payNow.payable.amount).toLocaleString()} owed to the supplier
            </p>

            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {([{ v: 'cash', l: '💵 Cash / drawer' }, { v: 'online', l: '🏦 Online' }] as const).map(m => (
                <button key={m.v} onClick={() => setPayNowMethod(m.v)}
                  className={`py-2.5 rounded-xl border-2 text-sm font-bold ${payNowMethod === m.v ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>
                  {m.l}
                </button>
              ))}
            </div>
            {payNowMethod === 'cash'
              ? <p className="text-[11px] text-amber-700 mb-3">Rs.{Number(payNow.payable.amount).toLocaleString()} comes off today&apos;s drawer count.</p>
              : <p className="text-[11px] text-slate-400 mb-3">You&apos;ll get an 8-digit confirmation number to type into the transfer&apos;s remarks.</p>}

            <div className="flex flex-col gap-2">
              <button onClick={settlePayableNow} disabled={payNowBusy}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-50">
                {payNowBusy ? 'Recording…' : `Yes — paid Rs.${Number(payNow.payable.amount).toLocaleString()}`}
              </button>
              <button onClick={() => setPayNow(null)}
                className="w-full py-2.5 rounded-xl border-2 border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50">
                No — paying later (due {payNow.payable.due_date})
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-2">
              Either way the amount is tracked in Suppliers &amp; Payables — nothing is forgotten.
            </p>
          </div>
        </div>
      )}

      {/* 8-digit confirmation for an online pay-now (same drill as Payables) */}
      {payNowSlip && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={() => setPayNowSlip(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 text-center" onClick={e => e.stopPropagation()}>
            <p className="text-xs font-bold text-slate-500 uppercase">Type this into the transfer remarks</p>
            <p className="text-4xl font-black tracking-[0.3em] text-slate-900 my-4 font-mono">{payNowSlip.no}</p>
            <p className="text-xs text-slate-400 mb-4">Rs.{payNowSlip.amount.toLocaleString()} — the bank statement will carry this number</p>
            <button onClick={() => setPayNowSlip(null)} className="w-full py-2.5 rounded-xl bg-slate-800 text-white text-sm font-black">Done — number entered</button>
          </div>
        </div>
      )}
    </div>
  )
}
