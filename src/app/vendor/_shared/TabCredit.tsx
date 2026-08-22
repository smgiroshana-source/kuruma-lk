'use client'
import { toWhatsAppNumber } from '@/lib/constants'
import { escapeHtml } from '@/lib/escapeHtml'
import { isValidSLPhone, PHONE_FORMAT_MSG } from '@/lib/phone'
import { useState, useEffect } from 'react'

const PAY_METHODS = ['cash', 'cheque', 'bank', 'card']
const PAY_LABELS: Record<string, string> = { cash: 'Cash', cheque: 'Cheque', bank: 'Bank Transfer', card: 'Card', advance: 'Advance', credit: 'Credit' }

function formatDateShort(d: string) { return new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short' }) }

function creditAge(dateStr: string | null): { label: string; pill: string; dot: string } | null {
  if (!dateStr) return null
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
  if (days >= 60) return { label: `${days}d overdue`, pill: 'text-red-700 bg-red-100 border border-red-300', dot: 'bg-red-500' }
  if (days >= 45) return { label: `${days}d overdue`, pill: 'text-orange-700 bg-orange-100 border border-orange-300', dot: 'bg-orange-500' }
  if (days >= 30) return { label: `${days}d overdue`, pill: 'text-yellow-700 bg-yellow-100 border border-yellow-300', dot: 'bg-yellow-500' }
  return null
}

export interface CommonTabProps {
  vendor: any
  products: any[]
  vendorSettings: any
  showToast: (msg: string) => void
  onDataChanged: () => void
}

// mode (optional): 'credit' = Receivables view (who owes; no registration),
// 'registry' = Customers view (register/edit/search everyone; all customers).
// Omitted (Sakura) = the original combined screen with the Show All checkbox.
export default function TabCredit({ vendor, vendorSettings, showToast, onDataChanged, mode }: CommonTabProps & { mode?: 'credit' | 'registry' }) {
  const registry = mode === 'registry'
  // TIN and VAT status only mean anything where tax invoices are issued.
  const isLkTax = vendorSettings?.invoice_mode === 'lk_tax'
  const creditOnly = mode === 'credit'
  const [creditCustomers, setCreditCustomers] = useState<any[]>([])
  const [creditLoading, setCreditLoading] = useState(false)
  const [showAllCustomers, setShowAllCustomers] = useState(registry)
  const [customerSearch, setCustomerSearch] = useState('')
  const [selectedCreditCustomer, setSelectedCreditCustomer] = useState<any>(null)
  const [outstandingSales, setOutstandingSales] = useState<any[]>([])
  const [settleSale, setSettleSale] = useState<any>(null)
  const [settlePayments, setSettlePayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [settleLoading, setSettleLoading] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<any>(null)
  const [editCustomerLoading, setEditCustomerLoading] = useState(false)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', whatsapp: '', email: '', address: '', notes: '', advance: '', credit: '', require_vehicle_no: false })
  const [addCustomerLoading, setAddCustomerLoading] = useState(false)
  const [adjustAdvanceAmount, setAdjustAdvanceAmount] = useState('')
  const [bulkSettleMode, setBulkSettleMode] = useState(false)
  const [bulkSettlePayments, setBulkSettlePayments] = useState<any[]>([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }])
  const [bulkSettleLoading, setBulkSettleLoading] = useState(false)
  const [bulkSettleConfirm, setBulkSettleConfirm] = useState(false)
  const [reversingPayment, setReversingPayment] = useState<string | null>(null)
  const [recentPayments, setRecentPayments] = useState<any[]>([])
  const [recentPaymentsOpen, setRecentPaymentsOpen] = useState(false)

  useEffect(() => { fetchCreditCustomers() }, [showAllCustomers])

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
    if (!isValidSLPhone(newCustomer.phone)) { showToast('⚠️ ' + PHONE_FORMAT_MSG); return }
    if (newCustomer.whatsapp.trim() && !isValidSLPhone(newCustomer.whatsapp)) { showToast('⚠️ WhatsApp: ' + PHONE_FORMAT_MSG); return }
    setAddCustomerLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create', name: newCustomer.name, phone: newCustomer.phone,
          whatsapp: newCustomer.whatsapp || newCustomer.phone, email: newCustomer.email,
          address: newCustomer.address, notes: newCustomer.notes,
          advance_balance: newCustomer.advance ? parseFloat(newCustomer.advance) : 0,
          require_vehicle_no: newCustomer.require_vehicle_no || false,
        })
      })
      const j = await r.json()
      if (j.success) {
        if (newCustomer.credit && parseFloat(newCustomer.credit) > 0) {
          // Opening-balance sale — surface failure instead of silently registering
          // the customer with no opening credit.
          try {
            const obRes = await fetch('/api/vendor/sales', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'create_sale', customerId: j.customer.id,
                items: [{ productId: null, productName: 'Opening Balance (Past Transactions)', productSku: 'OPENING-BAL', unitPrice: parseFloat(newCustomer.credit), quantity: 1 }],
                payments: [], notes: 'Opening credit balance from past transactions',
              })
            })
            const obJ = await obRes.json()
            if (!obRes.ok || !obJ.success) showToast('⚠️ Customer saved, but opening balance failed: ' + (obJ.error || 'unknown error'))
          } catch { showToast('⚠️ Customer saved, but opening balance failed (network)') }
        }
        showToast('Customer registered!')
        setNewCustomer({ name: '', phone: '', whatsapp: '', email: '', address: '', notes: '', advance: '', credit: '', require_vehicle_no: false })
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
        if (editingCustomer) setEditingCustomer({ ...editingCustomer, advance_balance: j.advance ?? (editingCustomer.advance_balance + (type === 'add' ? amount : -amount)) })
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setEditCustomerLoading(false)
  }

  async function loadOutstanding(customer: any) {
    setSelectedCreditCustomer(customer); setOutstandingSales([]); setRecentPayments([]); setRecentPaymentsOpen(false); setBulkSettleConfirm(false)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_outstanding', customerId: customer.id }) })
      if (r.ok) {
        const j = await r.json()
        setOutstandingSales(j.sales || [])
        // get_outstanding auto-offsets any advance against outstanding invoices —
        // refresh the customer list so the left-hand cards reflect the new balances.
        if (parseFloat(customer.advance_balance ?? customer.advance ?? 0) > 0) fetchCreditCustomers()
      } else {
        showToast('Could not load outstanding invoices')
      }
    } catch { showToast('Network error loading outstanding invoices') }
    loadRecentPayments(customer.id)
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

  async function handleEditCustomer() {
    if (!editingCustomer) return
    if (editingCustomer.phone?.trim() && !isValidSLPhone(editingCustomer.phone)) { showToast('⚠️ ' + PHONE_FORMAT_MSG); return }
    if (editingCustomer.whatsapp?.trim() && !isValidSLPhone(editingCustomer.whatsapp)) { showToast('⚠️ WhatsApp: ' + PHONE_FORMAT_MSG); return }
    // Same rule as suppliers: the gazette wants 9 digits, and a short one
    // silently produces an invalid tax invoice for the customer to bounce back.
    if (isLkTax && editingCustomer.vat_registered && !/^\d{9}$/.test(String(editingCustomer.tin || ''))) {
      showToast('⚠️ A VAT-registered customer needs a 9-digit TIN — it is printed on their tax invoice')
      return
    }
    setEditCustomerLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'update', customerId: editingCustomer.id,
        data: {
          name: editingCustomer.name, phone: editingCustomer.phone, whatsapp: editingCustomer.whatsapp,
          email: editingCustomer.email, address: editingCustomer.address, notes: editingCustomer.notes,
          require_vehicle_no: editingCustomer.require_vehicle_no || false,
          // Only sent where they mean something; clearing VAT clears the TIN
          // with it, so a stale number can't linger on a de-registered customer.
          ...(isLkTax ? {
            vat_registered: !!editingCustomer.vat_registered,
            tin: editingCustomer.vat_registered ? (editingCustomer.tin || null) : null,
            is_insurance: !!editingCustomer.is_insurance,
          } : {}),
        },
      }) })
      const j = await r.json()
      if (j.success) { showToast('Customer updated'); setEditingCustomer(null); fetchCreditCustomers(); if (selectedCreditCustomer?.id === editingCustomer.id) setSelectedCreditCustomer({ ...selectedCreditCustomer, ...editingCustomer }) }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setEditCustomerLoading(false)
  }

  async function handleBulkSettle() {
    if (!selectedCreditCustomer) return
    const totalPay = bulkSettlePayments.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0)
    if (totalPay <= 0) { showToast('Enter payment amount'); return }
    setBulkSettleConfirm(true)
  }

  async function confirmBulkSettle() {
    if (!selectedCreditCustomer) return
    setBulkSettleLoading(true)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        action: 'bulk_settle', customerId: selectedCreditCustomer.id,
        payments: bulkSettlePayments.filter((p: any) => parseFloat(p.amount) > 0),
      }) })
      const j = await r.json()
      if (j.success) { showToast(j.message); setBulkSettleMode(false); setBulkSettleConfirm(false); setBulkSettlePayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]); fetchCreditCustomers(); loadOutstanding(selectedCreditCustomer) }
      else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setBulkSettleLoading(false)
  }

  async function handleReversePayment(paymentId: string) {
    if (!confirm('Reverse this payment? The invoice balance will be restored.')) return
    setReversingPayment(paymentId)
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse_payment', paymentId }) })
      const j = await r.json()
      if (j.success) {
        showToast('Payment reversed — invoice balance restored')
        if (selectedCreditCustomer) { loadOutstanding(selectedCreditCustomer); loadRecentPayments(selectedCreditCustomer.id) }
        fetchCreditCustomers()
      } else showToast('Error: ' + j.error)
    } catch { showToast('Network error') }
    setReversingPayment(null)
  }

  async function loadRecentPayments(customerId: string) {
    try {
      const r = await fetch('/api/vendor/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'get_recent_payments', customerId }) })
      if (r.ok) { const j = await r.json(); setRecentPayments(j.payments || []) }
    } catch {}
  }

  function printCreditReport(customer: any, sales: any[], vendorInfo: any) {
    const totalDue = sales.reduce((s: number, sale: any) => s + parseFloat(sale.balance_due || 0), 0)
    const advanceBalance = parseFloat(customer.advance_balance || 0)
    const netDue = Math.max(0, totalDue - advanceBalance)
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Credit Report - ${escapeHtml(customer.name)}</title>
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
  .total-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px 8px 0 0; padding: 12px 15px; margin-top: 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: none; }
  .total-label { font-size: 14px; font-weight: 700; color: #dc2626; }
  .total-amount { font-size: 22px; font-weight: 900; color: #dc2626; }
  .footer { text-align: center; padding: 20px 0; color: #94a3b8; font-size: 11px; border-top: 1px solid #e2e8f0; margin-top: 30px; }
  .date-generated { font-size: 11px; color: #94a3b8; text-align: right; margin-bottom: 15px; }
  .advance-deduct-box { background: #ecfdf5; border: 2px solid #dc2626; border-top: 1px dashed #dc2626; border-bottom: none; padding: 10px 15px; display: flex; justify-content: space-between; align-items: center; }
  .advance-deduct-label { font-size: 13px; font-weight: 700; color: #059669; }
  .advance-deduct-amount { font-size: 18px; font-weight: 900; color: #059669; }
  .net-box { background: #dc2626; border: 2px solid #dc2626; border-radius: 0 0 8px 8px; padding: 15px; display: flex; justify-content: space-between; align-items: center; }
  .net-label { font-size: 16px; font-weight: 700; color: #fff; }
  .net-amount { font-size: 30px; font-weight: 900; color: #fff; }
  .standalone-total-box { background: #fef2f2; border: 2px solid #dc2626; border-radius: 8px; padding: 15px; margin-top: 20px; display: flex; justify-content: space-between; align-items: center; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head><body>
<div class="header">
  <div class="shop-name">${escapeHtml(vendorInfo?.name) || 'kuruma.lk'}</div>
  ${vendorInfo?.location ? `<div style="font-size:12px;color:#666">${escapeHtml(vendorInfo.location)} ${vendorInfo?.phone ? '| Tel: ' + escapeHtml(vendorInfo.phone) : ''}</div>` : ''}
  <div class="report-title">Credit Statement</div>
</div>
<div class="date-generated">Generated: ${new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' } as any)}</div>
<div class="customer-info">
  <h3>Customer Details</h3>
  <p class="customer-name">${escapeHtml(customer.name)}</p>
  ${customer.phone ? `<p>Phone: ${escapeHtml(customer.phone)}</p>` : ''}
  ${customer.email ? `<p>Email: ${escapeHtml(customer.email)}</p>` : ''}
  ${customer.address ? `<p>Address: ${escapeHtml(customer.address)}</p>` : ''}
</div>
${sales.length > 0 ? `
<table>
  <thead><tr><th>Invoice #</th><th>Date</th><th>Items</th><th class="text-right">Total</th><th class="text-right">Paid</th><th class="text-right">Balance Due</th></tr></thead>
  <tbody>
    ${sales.map((s: any) => `<tr>
      <td><strong>${escapeHtml(s.invoice_no)}</strong></td>
      <td>${formatDateShort(s.created_at)}</td>
      <td style="font-size:11px;color:#666">${escapeHtml((s.items || []).map((i: any) => i.product_name).join(', '))}</td>
      <td class="text-right">Rs.${(parseFloat(s.total) || 0).toLocaleString()}</td>
      <td class="text-right amount-paid">Rs.${(parseFloat(s.paid_amount) || 0).toLocaleString()}</td>
      <td class="text-right amount-due">Rs.${(parseFloat(s.balance_due) || 0).toLocaleString()}</td>
    </tr>`).join('')}
  </tbody>
</table>
` : '<p style="text-align:center;color:#94a3b8;padding:20px">No outstanding invoices</p>'}
${advanceBalance > 0 ? `
<div class="total-box"><span class="total-label">TOTAL OUTSTANDING</span><span class="total-amount">Rs. ${totalDue.toLocaleString()}</span></div>
<div class="advance-deduct-box"><span class="advance-deduct-label">Less: Advance Balance</span><span class="advance-deduct-amount">( Rs. ${advanceBalance.toLocaleString()} )</span></div>
<div class="net-box"><span class="net-label">NET AMOUNT DUE</span><span class="net-amount">Rs. ${netDue.toLocaleString()}</span></div>
` : `<div class="standalone-total-box"><span class="total-label" style="font-size:16px">TOTAL OUTSTANDING</span><span class="total-amount" style="font-size:28px">Rs. ${totalDue.toLocaleString()}</span></div>`}
<div class="footer">
  <p>This is a computer-generated statement. Please settle outstanding amounts at your earliest convenience.</p>
  <p style="margin-top:5px">Contact: ${escapeHtml(vendorInfo?.phone)} ${vendorInfo?.whatsapp ? '| WhatsApp: ' + escapeHtml(vendorInfo.whatsapp) : ''}</p>
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
    const advanceBalance = parseFloat(customer.advance_balance || 0)
    const netDue = Math.max(0, totalDue - advanceBalance)
    let msg = `*CREDIT STATEMENT*%0A${vendorInfo?.name || 'kuruma.lk'}%0ADate: ${new Date().toLocaleDateString('en-LK', { day: '2-digit', month: 'long', year: 'numeric' })}%0A%0ADear ${customer.name},%0A%0AHere is your outstanding balance:%0A`
    sales.forEach((s: any) => {
      msg += `%0A📋 *${s.invoice_no}* (${formatDateShort(s.created_at)})%0A`
      msg += `   Total: Rs.${parseFloat(s.total).toLocaleString()} | Paid: Rs.${parseFloat(s.paid_amount).toLocaleString()}%0A`
      msg += `   *Due: Rs.${parseFloat(s.balance_due).toLocaleString()}*%0A`
    })
    msg += `%0A━━━━━━━━━━━━━━━━%0A`
    if (advanceBalance > 0) {
      msg += `Total Outstanding: Rs.${totalDue.toLocaleString()}%0A`
      msg += `Less Advance Balance: (Rs.${advanceBalance.toLocaleString()})%0A`
      msg += `━━━━━━━━━━━━━━━━%0A*NET AMOUNT DUE: Rs.${netDue.toLocaleString()}*%0A`
    } else {
      msg += `*TOTAL OUTSTANDING: Rs.${totalDue.toLocaleString()}*%0A`
    }
    msg += `%0APlease settle at your earliest convenience.%0AThank you! - ${vendorInfo?.name || 'kuruma.lk'}`
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank')
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-black text-slate-900">{registry ? '👥 Customers' : creditOnly ? '💰 Receivables' : '💳 Credit & Customers'}</h1>
        {!creditOnly && <button onClick={() => setShowAddCustomer(!showAddCustomer)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold px-4 py-2 rounded-lg">{showAddCustomer ? 'Cancel' : '+ Add Customer'}</button>}
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
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mt-3">
            <div>
              <p className="text-xs font-semibold text-amber-800">Require Vehicle Number</p>
              <p className="text-[10px] text-amber-600">POS will block sale if vehicle no. is blank</p>
            </div>
            <button type="button" onClick={() => setNewCustomer({...newCustomer, require_vehicle_no: !newCustomer.require_vehicle_no})} className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (newCustomer.require_vehicle_no ? 'bg-amber-500' : 'bg-slate-300')}>
              <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (newCustomer.require_vehicle_no ? 'translate-x-6' : 'translate-x-1')} />
            </button>
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
        {!registry && !creditOnly && (
          <label className="flex items-center gap-2 cursor-pointer bg-white px-3 py-2 rounded-lg border border-slate-200">
            <input type="checkbox" checked={showAllCustomers} onChange={e => setShowAllCustomers(e.target.checked)} className="w-4 h-4 accent-orange-500" />
            <span className="text-xs font-semibold text-slate-600">Show All Customers</span>
          </label>
        )}
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
            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
              <div>
                <p className="text-xs font-semibold text-amber-800">Require Vehicle Number</p>
                <p className="text-[10px] text-amber-600">POS will block sale if vehicle no. is blank</p>
              </div>
              <button type="button" onClick={() => setEditingCustomer({...editingCustomer, require_vehicle_no: !editingCustomer.require_vehicle_no})} className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (editingCustomer.require_vehicle_no ? 'bg-amber-500' : 'bg-slate-300')}>
                <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (editingCustomer.require_vehicle_no ? 'translate-x-6' : 'translate-x-1')} />
              </button>
            </div>
            {isLkTax && (
              <div className="border border-slate-200 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">VAT-registered</p>
                    <p className="text-[10px] text-slate-400">Their TIN is printed on the tax invoice</p>
                  </div>
                  <button type="button"
                    onClick={() => setEditingCustomer({ ...editingCustomer, vat_registered: !editingCustomer.vat_registered })}
                    className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (editingCustomer.vat_registered ? 'bg-emerald-500' : 'bg-slate-300')}>
                    <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (editingCustomer.vat_registered ? 'translate-x-6' : 'translate-x-1')} />
                  </button>
                </div>
                {editingCustomer.vat_registered && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1">VAT / TIN (9 digits)</label>
                    <input type="text" inputMode="numeric" value={editingCustomer.tin || ''}
                      onChange={e => setEditingCustomer({ ...editingCustomer, tin: e.target.value.replace(/\D/g, '').slice(0, 9) })}
                      placeholder="134007958"
                      className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none font-mono focus:border-orange-400" />
                    {/* 999999999 is the placeholder used while a real number is
                        awaited — it must never reach a gazette invoice. */}
                    {editingCustomer.tin === '999999999' && (
                      <p className="text-[10px] font-bold text-red-600 mt-1">Placeholder number — replace before issuing a tax invoice.</p>
                    )}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-slate-700">Insurance company</p>
                    <p className="text-[10px] text-slate-400">POS enters prices EXCLUDING VAT for these</p>
                  </div>
                  <button type="button"
                    onClick={() => setEditingCustomer({ ...editingCustomer, is_insurance: !editingCustomer.is_insurance })}
                    className={'relative inline-flex h-6 w-11 items-center rounded-full transition-colors ' + (editingCustomer.is_insurance ? 'bg-indigo-500' : 'bg-slate-300')}>
                    <span className={'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ' + (editingCustomer.is_insurance ? 'translate-x-6' : 'translate-x-1')} />
                  </button>
                </div>
              </div>
            )}
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
            <h3 className="font-bold text-slate-800 text-sm mb-2">{showAllCustomers ? 'All Customers' : 'Customers with Credit'} ({creditCustomers.length})</h3>
            {(() => { const filtered = creditCustomers.filter((c: any) => { if (!customerSearch) return true; const s = customerSearch.toLowerCase(); return c.name?.toLowerCase().includes(s) || c.phone?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) }); return filtered.length === 0 })() ? <div className="bg-white rounded-xl border border-slate-200 p-6 text-center"><p className="text-2xl opacity-30">✅</p><p className="text-slate-400 text-sm font-semibold mt-2">No outstanding credit or advances</p></div> : creditCustomers.filter((c: any) => { if (!customerSearch) return true; const s = customerSearch.toLowerCase(); return c.name?.toLowerCase().includes(s) || c.phone?.toLowerCase().includes(s) || c.email?.toLowerCase().includes(s) }).map((c: any) => (
              <button key={c.id} onClick={() => loadOutstanding(c)} className={'w-full text-left bg-white rounded-xl border px-4 py-3 hover:shadow-md transition ' + (selectedCreditCustomer?.id === c.id ? 'border-orange-500 bg-orange-50' : 'border-slate-200')}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-sm">
                      {c.name}
                      {isLkTax && c.is_insurance && (
                        <span className="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 align-middle">INSURANCE</span>
                      )}
                    </p>
                    {/* Visible without opening the form — it is the field most
                        often checked before raising a tax invoice. */}
                    {isLkTax && c.vat_registered && (
                      <p className={'text-[10px] font-mono font-bold ' + (c.tin === '999999999' ? 'text-red-600' : 'text-slate-500')}>
                        VAT {c.tin || '— missing'}{c.tin === '999999999' ? ' (placeholder)' : ''}
                      </p>
                    )}
                    {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                    {(() => { const age = creditAge(c.credit?.oldestDueDate); return age ? <span className={'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded mt-1 ' + age.pill}><span className={'w-1.5 h-1.5 rounded-full ' + age.dot} />{age.label}</span> : null })()}
                  </div>
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

              {outstandingSales.length > 0 && (
                <div className="flex gap-2 mb-4 flex-wrap">
                  <button onClick={() => printCreditReport(selectedCreditCustomer, outstandingSales, vendor)} className="text-xs font-semibold text-slate-600 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">📄 Print Statement</button>
                  <button onClick={() => sendWhatsAppCreditReport(selectedCreditCustomer, outstandingSales, vendor)} className="text-xs font-semibold text-green-600 px-3 py-2 rounded-lg border border-green-200 hover:bg-green-50">💬 WhatsApp Statement</button>
                  <button onClick={() => setBulkSettleMode(!bulkSettleMode)} className="text-xs font-semibold text-purple-700 px-3 py-2 rounded-lg border border-purple-300 bg-purple-50 hover:bg-purple-100">{bulkSettleMode ? '✕ Cancel' : '💰 Lump Payment'}</button>
                </div>
              )}

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
                  {bulkSettleConfirm ? (
                    <div className="mt-3 bg-white border-2 border-red-400 rounded-xl p-4 space-y-3">
                      <p className="text-xs font-bold text-red-500 uppercase tracking-wider text-center">⚠️ Confirm Payment</p>
                      <p className="text-center text-slate-500 text-xs">You are applying</p>
                      <p className="text-center font-black text-2xl text-slate-800">Rs.{bulkSettlePayments.reduce((s: number, p: any) => s + (parseFloat(p.amount) || 0), 0).toLocaleString()}</p>
                      <p className="text-center text-slate-500 text-xs">to</p>
                      <p className="text-center font-black text-xl text-orange-600">{selectedCreditCustomer?.name}</p>
                      <div className="flex gap-2 pt-1">
                        <button onClick={confirmBulkSettle} disabled={bulkSettleLoading} className="flex-1 bg-green-600 hover:bg-green-700 text-white font-black text-sm py-3 rounded-xl disabled:opacity-50">
                          {bulkSettleLoading ? 'Processing…' : '✅ Yes, confirm'}
                        </button>
                        <button onClick={() => setBulkSettleConfirm(false)} disabled={bulkSettleLoading} className="flex-1 border-2 border-slate-300 text-slate-600 font-bold text-sm py-3 rounded-xl hover:bg-slate-50">
                          ✕ Go back
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 flex gap-2">
                      <button onClick={handleBulkSettle} disabled={bulkSettleLoading} className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50">💰 Apply Payment</button>
                      <p className="text-xs text-purple-500 self-center">Excess amount will be added to advance</p>
                    </div>
                  )}
                </div>
              )}

              {outstandingSales.length > 0 && (<div className="mb-4">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Outstanding Invoices</h4>
                <div className="space-y-3">{outstandingSales.map((sale: any) => {
                  const age = creditAge(sale.created_at)
                  const borderCls = age
                    ? age.dot === 'bg-red-500'    ? 'border-red-300 bg-red-50/30'
                    : age.dot === 'bg-orange-500' ? 'border-orange-300 bg-orange-50/30'
                    :                               'border-yellow-300 bg-yellow-50/30'
                    : 'border-slate-200'
                  return (
                  <div key={sale.id} className={'bg-white rounded-xl border p-4 ' + borderCls}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs font-bold bg-slate-100 px-2 py-1 rounded">{sale.invoice_no}</span>
                        <span className="text-xs text-slate-400">{formatDateShort(sale.created_at)}</span>
                        {age && <span className={'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ' + age.pill}><span className={'w-1.5 h-1.5 rounded-full ' + age.dot} />{age.label}</span>}
                      </div>
                      <div className="text-right"><p className="text-xs text-slate-400">Total: Rs.{parseFloat(sale.total).toLocaleString()}</p><p className="text-xs text-green-600">Paid: Rs.{parseFloat(sale.paid_amount).toLocaleString()}</p><p className="font-black text-red-600">Due: Rs.{parseFloat(sale.balance_due).toLocaleString()}</p></div>
                    </div>
                    <div className="text-xs text-slate-500 mb-2">{(sale.items || []).map((i: any) => `${i.product_name} x${i.quantity}`).join(', ')}</div>
                    {sale.payments && sale.payments.length > 0 && (
                      <div className="text-xs text-slate-400 mb-2">
                        Payments: {sale.payments.map((p: any) => `${PAY_LABELS[p.payment_method] || p.payment_method} Rs.${parseFloat(p.amount).toLocaleString()}${p.cheque_number ? ' #' + p.cheque_number : ''}${p.bank_ref ? ' ref:' + p.bank_ref : ''}`).join(' + ')}
                      </div>
                    )}
                    <button onClick={() => { setSettleSale(sale); setSettlePayments([{ method: 'cash', amount: '', chequeNumber: '', chequeDate: '', bankRef: '' }]) }} className="bg-green-500 hover:bg-green-600 text-white text-xs font-bold px-4 py-2 rounded-lg">💰 Record Payment</button>
                  </div>
                )})}</div>
              </div>)}

              {outstandingSales.length === 0 && selectedCreditCustomer.credit?.balance <= 0 && (
                <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center mb-4">
                  <p className="text-emerald-600 font-semibold">No outstanding invoices</p>
                </div>
              )}

              {recentPayments.length > 0 && (
                <div className="mb-4">
                  <button onClick={() => setRecentPaymentsOpen(o => !o)} className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase mb-2 hover:text-slate-700">
                    <span>{recentPaymentsOpen ? '▾' : '▸'}</span> Recent Payments (last 7 days) — tap to reverse a mistake
                  </button>
                  {recentPaymentsOpen && (
                    <div className="space-y-2">
                      {recentPayments.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                          <div>
                            <span className="text-xs font-bold text-slate-700">Rs.{parseFloat(p.amount).toLocaleString()}</span>
                            <span className="text-xs text-slate-400 ml-2">{PAY_LABELS[p.payment_method] || p.payment_method}</span>
                            {p.sale?.invoice_no && <span className="text-xs text-slate-400 ml-2">· {p.sale.invoice_no}</span>}
                            <span className="text-xs text-slate-300 ml-2">· {formatDateShort(p.created_at)}</span>
                          </div>
                          <button onClick={() => handleReversePayment(p.id)} disabled={reversingPayment === p.id} className="text-xs font-bold text-red-400 hover:text-red-600 hover:bg-red-50 border border-red-200 px-2.5 py-1 rounded-lg ml-3 disabled:opacity-40 shrink-0">
                            {reversingPayment === p.id ? '…' : '↩ Reverse'}
                          </button>
                        </div>
                      ))}
                      <p className="text-[10px] text-slate-400 text-center pt-1">Reversing a payment restores the invoice balance so it reappears as outstanding</p>
                    </div>
                  )}
                </div>
              )}

            </div>) : (<div className="bg-white rounded-xl border border-slate-200 p-8 text-center"><p className="text-3xl opacity-20">👈</p><p className="text-slate-400 font-semibold mt-2">Select a customer</p></div>)}
          </div>
        </div>
      )}
    </div>
  )
}
