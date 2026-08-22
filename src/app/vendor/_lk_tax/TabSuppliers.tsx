'use client'
import { colomboToday } from '@/lib/dates'
import SupplierForm from './SupplierForm'
import { useState, useEffect } from 'react'

type Props = {
  vendor: any
  showToast: (msg: string) => void
}

function formatRs(amount: number): string {
  return 'Rs. ' + Math.round(amount).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

function todayStr(): string {
  return colomboToday()
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  return Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 86400000)
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    paid: 'bg-emerald-100 text-emerald-700',
    partial: 'bg-blue-100 text-blue-700',
    unpaid: 'bg-amber-100 text-amber-700',
    overdue: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full capitalize ${map[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  )
}


const BLANK_INVOICE = {
  invoice_no: '',
  invoice_date: todayStr(),
  due_date: '',
  amount: '',
  notes: '',
}

const BLANK_PAYMENT = {
  amount: '',
  payment_date: todayStr(),
  method: 'Cash',
  reference: '',
  notes: '',
}

export default function TabSuppliers({ vendor, showToast }: Props) {
  // ── view state ────────────────────────────────────────────────────────────
  const [view, setView] = useState<'list' | 'invoices'>('list')
  const [selectedSupplier, setSelectedSupplier] = useState<any | null>(null)

  // ── data ──────────────────────────────────────────────────────────────────
  const [suppliers, setSuppliers] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // ── modal open states ────────────────────────────────────────────────────
  const [showAddSupplier, setShowAddSupplier] = useState(false)
  // Editing lived only on Stock → Suppliers, so this screen — the one called
  // "Suppliers" — could create a supplier but never correct one.
  const [editingSupplier, setEditingSupplier] = useState<any>(null)
  const [showAddInvoice, setShowAddInvoice] = useState(false)
  const [showRecordPayment, setShowRecordPayment] = useState<any | null>(null)

  // ── filters ───────────────────────────────────────────────────────────────
  const [showIncludePaid, setShowIncludePaid] = useState(false)

  // ── form states ───────────────────────────────────────────────────────────
  const [newInvoice, setNewInvoice] = useState({ ...BLANK_INVOICE })
  const [newPayment, setNewPayment] = useState({ ...BLANK_PAYMENT })
  // 8-digit payment confirmation overlay: {no, kind: 'cheque'|'bank', supplier, amount, reference, date}
  const [paySlip, setPaySlip] = useState<any>(null)
  const [saving, setSaving] = useState(false)

  // ── effects ───────────────────────────────────────────────────────────────
  useEffect(() => { fetchSuppliers() }, [])

  useEffect(() => {
    if (selectedSupplier) fetchInvoices(selectedSupplier.id)
  }, [selectedSupplier, showIncludePaid])

  // ── fetch helpers ─────────────────────────────────────────────────────────
  async function fetchSuppliers() {
    setLoading(true)
    try {
      const res = await fetch(`/api/vendor/suppliers?vendor_id=${vendor.id}`)
      if (!res.ok) throw new Error('Failed to load suppliers')
      const data = await res.json()
      setSuppliers(data.suppliers ?? data ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading suppliers')
    } finally {
      setLoading(false)
    }
  }

  async function fetchInvoices(supplierId: string) {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/vendor/supplier-invoices?vendor_id=${vendor.id}&supplier_id=${supplierId}&include_paid=${showIncludePaid}`
      )
      if (!res.ok) throw new Error('Failed to load invoices')
      const data = await res.json()
      setInvoices(data.invoices ?? data ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading invoices')
    } finally {
      setLoading(false)
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────
  async function handleAddInvoice() {
    if (!newInvoice.invoice_no.trim()) { showToast('Invoice number is required'); return }
    if (!newInvoice.amount || Number(newInvoice.amount) <= 0) { showToast('Amount must be > 0'); return }
    if (!newInvoice.due_date) { showToast('Due date is required'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vendor/supplier-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_invoice',
          vendor_id: vendor.id,
          supplier_id: selectedSupplier.id,
          ...newInvoice,
          amount: Math.round(Number(newInvoice.amount)),
        }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed to add invoice') }
      showToast('Invoice added')
      setShowAddInvoice(false)
      setNewInvoice({ ...BLANK_INVOICE })
      await fetchInvoices(selectedSupplier.id)
      await fetchSuppliers()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleRecordPayment() {
    const invoice = showRecordPayment
    if (!invoice) return
    const balance = invoice.amount - (invoice.amount_paid ?? 0)
    const amt = Math.round(Number(newPayment.amount))
    if (!amt || amt <= 0) { showToast('Payment amount must be > 0'); return }
    if (amt > balance) { showToast(`Amount exceeds balance of ${formatRs(balance)}`); return }
    if (String(newPayment.method).toLowerCase().includes('cheque') && !newPayment.reference.trim()) {
      showToast('⚠️ Enter the cheque number — a cheque without one cannot be traced'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/vendor/supplier-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          vendor_id: vendor.id,
          invoice_id: invoice.id,
          // Required by the API and never sent before — every payment 400'd
          supplier_id: invoice.supplier_id || selectedSupplier?.id,
          ...newPayment,
          amount: amt,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed to record payment')
      // Cheque/bank payments come back with the 8-digit confirmation number —
      // show it full-screen for the operator to copy (slip or transfer remarks)
      if (d.confirm_no) {
        setPaySlip({ no: d.confirm_no, kind: d.confirm_kind, supplier: selectedSupplier?.name || invoice.supplier_name || '', amount: amt, reference: newPayment.reference, date: newPayment.payment_date })
      } else {
        showToast('Payment recorded')
      }
      setShowRecordPayment(null)
      setNewPayment({ ...BLANK_PAYMENT })
      await fetchInvoices(selectedSupplier.id)
      await fetchSuppliers()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteInvoice(inv: any) {
    if (!confirm(`Delete invoice ${inv.invoice_no}? This cannot be undone.`)) return
    try {
      const res = await fetch('/api/vendor/supplier-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_invoice', vendor_id: vendor.id, invoice_id: inv.id }),
      })
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? 'Failed to delete invoice') }
      showToast('Invoice deleted')
      await fetchInvoices(selectedSupplier.id)
      await fetchSuppliers()
    } catch (e: any) {
      showToast(e.message)
    }
  }

  // ── derived data ──────────────────────────────────────────────────────────
  function agingBuckets(invList: any[]) {
    const today = todayStr()
    let current = 0, b30 = 0, b60 = 0, b60plus = 0
    for (const inv of invList) {
      if (inv.status === 'paid') continue
      const balance = (inv.amount ?? 0) - (inv.amount_paid ?? 0)
      if (balance <= 0) continue
      const overdueDays = daysBetween(inv.due_date, today)
      if (overdueDays <= 0) current += balance
      else if (overdueDays <= 30) b30 += balance
      else if (overdueDays <= 60) b60 += balance
      else b60plus += balance
    }
    return { current, b30, b60, b60plus }
  }

  const hasUnpaid = invoices.some(i => i.status !== 'paid')
  const aging = agingBuckets(invoices)

  // ── open invoice date sync ────────────────────────────────────────────────
  function handleInvoiceDateChange(date: string) {
    const terms = selectedSupplier?.payment_terms ?? 30
    setNewInvoice(prev => ({
      ...prev,
      invoice_date: date,
      due_date: addDays(date, terms),
    }))
  }

  // initialise due_date when modal opens
  function openAddInvoiceModal() {
    const terms = selectedSupplier?.payment_terms ?? 30
    setNewInvoice({
      ...BLANK_INVOICE,
      invoice_date: todayStr(),
      due_date: addDays(todayStr(), terms),
    })
    setShowAddInvoice(true)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div>
      {view === 'list' ? (
        <SupplierListView
          suppliers={suppliers}
          loading={loading}
          onAddSupplier={() => setShowAddSupplier(true)}
          onSelectSupplier={(s) => {
            setSelectedSupplier(s)
            setView('invoices')
          }}
          onEditSupplier={(s) => setEditingSupplier(s)}
        />
      ) : (
        <InvoiceListView
          supplier={selectedSupplier}
          invoices={invoices}
          loading={loading}
          showIncludePaid={showIncludePaid}
          onToggleIncludePaid={() => setShowIncludePaid(p => !p)}
          onBack={() => { setView('list'); setSelectedSupplier(null); setInvoices([]) }}
          onAddInvoice={openAddInvoiceModal}
          onPay={(inv) => { setShowRecordPayment(inv); setNewPayment({ ...BLANK_PAYMENT }) }}
          onDelete={handleDeleteInvoice}
          hasUnpaid={hasUnpaid}
          aging={aging}
        />
      )}

      {/* ── ADD SUPPLIER MODAL ─────────────────────────────────────────────── */}
      {showAddSupplier && (
        <Modal title="Add Supplier" onClose={() => setShowAddSupplier(false)}>
          {/* THE supplier form — same component as Stock → Suppliers, so both
              screens always ask the same questions */}
          <SupplierForm
            showToast={showToast}
            onSaved={async () => { setShowAddSupplier(false); await fetchSuppliers() }}
            onCancel={() => setShowAddSupplier(false)}
          />
        </Modal>
      )}

      {/* ── EDIT SUPPLIER MODAL ─────────────────────────────────────────────── */}
      {editingSupplier && (
        <Modal title={`Edit ${editingSupplier.name}`} onClose={() => setEditingSupplier(null)}>
          <SupplierForm
            initial={editingSupplier}
            showToast={showToast}
            onSaved={async () => { setEditingSupplier(null); await fetchSuppliers() }}
            onCancel={() => setEditingSupplier(null)}
          />
        </Modal>
      )}

      {/* ── ADD INVOICE MODAL ──────────────────────────────────────────────── */}
      {showAddInvoice && selectedSupplier && (
        <Modal title={`Add Invoice — ${selectedSupplier.name}`} onClose={() => setShowAddInvoice(false)}>
          <p className="text-[11px] text-slate-400 -mt-2 mb-3">
            New stock arrivals create their invoice automatically when the GRN is posted — use this for
            <strong> old pre-system debts</strong> (enter each as an opening balance) or an invoice with no GRN.
          </p>
          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Supplier Invoice No. <span className="text-red-500">*</span></label>
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. INV-2026-0042"
                value={newInvoice.invoice_no}
                onChange={e => setNewInvoice(p => ({ ...p, invoice_no: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Invoice Date</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={newInvoice.invoice_date}
                  onChange={e => handleInvoiceDateChange(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Due Date</label>
                <input
                  type="date"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={newInvoice.due_date}
                  onChange={e => setNewInvoice(p => ({ ...p, due_date: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Amount (Rs.) <span className="text-red-500">*</span></label>
              <input
                type="number"
                min={1}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="0"
                value={newInvoice.amount}
                onChange={e => setNewInvoice(p => ({ ...p, amount: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Notes</label>
              <textarea
                rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                placeholder="Optional"
                value={newInvoice.notes}
                onChange={e => setNewInvoice(p => ({ ...p, notes: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
            <button
              onClick={() => setShowAddInvoice(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddInvoice}
              disabled={saving}
              className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Add Invoice'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── RECORD PAYMENT MODAL ───────────────────────────────────────────── */}
      {/* 8-digit payment confirmation — the operator copies this before the money moves */}
      {paySlip && (
        <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full text-center">
            <p className="text-sm font-black text-emerald-600">✓ Payment recorded</p>
            <p className="text-xs text-slate-400 mt-3 font-bold uppercase tracking-widest">Payment Confirmation Number</p>
            <p className="font-mono text-4xl font-black tracking-[0.2em] text-slate-900 my-3">{paySlip.no}</p>
            {paySlip.kind === 'cheque' ? (
              <div className="text-left text-sm text-slate-600 bg-slate-50 rounded-xl p-3.5 leading-relaxed">
                ✍️ Write this number on the <b>cheque book slip</b> for cheque <b>{paySlip.reference || '—'}</b>, with:<br />
                • Supplier: <b>{paySlip.supplier}</b><br />
                • Amount: <b>{formatRs(paySlip.amount)}</b><br />
                • Date: <b>{paySlip.date}</b>
              </div>
            ) : (
              <div className="text-left text-sm text-slate-600 bg-slate-50 rounded-xl p-3.5 leading-relaxed">
                🏦 Type this number into the <b>remarks / reference field</b> of the online bank transfer <b>before sending</b> — the bank statement will then carry it.<br />
                • Supplier: <b>{paySlip.supplier}</b><br />
                • Amount: <b>{formatRs(paySlip.amount)}</b>
              </div>
            )}
            <p className="text-[11px] text-red-600 font-bold mt-3">{paySlip.kind === 'cheque' ? 'The owner signs ONLY cheques whose slip carries a confirmation number.' : 'Transfers without this number in remarks are treated as unauthorised.'}</p>
            <button onClick={() => setPaySlip(null)} className="mt-4 w-full py-3 rounded-xl bg-slate-800 text-white text-sm font-black hover:bg-slate-700">Done — number copied</button>
          </div>
        </div>
      )}

      {showRecordPayment && (
        <Modal title="Record Payment" onClose={() => setShowRecordPayment(null)}>
          {(() => {
            const inv = showRecordPayment
            const alreadyPaid = inv.amount_paid ?? 0
            const balance = inv.amount - alreadyPaid
            return (
              <>
                {/* Invoice summary */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4 text-sm">
                  <p className="font-bold text-slate-800 mb-1">{inv.invoice_no}</p>
                  <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                    <div>
                      <span className="block font-semibold text-slate-700">Total</span>
                      {formatRs(inv.amount)}
                    </div>
                    <div>
                      <span className="block font-semibold text-slate-700">Paid</span>
                      {formatRs(alreadyPaid)}
                    </div>
                    <div>
                      <span className="block font-semibold text-orange-600">Balance</span>
                      <span className="font-bold text-orange-600">{formatRs(balance)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Payment Amount (Rs.) <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      min={1}
                      max={balance}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder={String(balance)}
                      value={newPayment.amount}
                      onChange={e => setNewPayment(p => ({ ...p, amount: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Payment Date</label>
                      <input
                        type="date"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                        value={newPayment.payment_date}
                        onChange={e => setNewPayment(p => ({ ...p, payment_date: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Method</label>
                      <select
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                        value={newPayment.method}
                        onChange={e => setNewPayment(p => ({ ...p, method: e.target.value }))}
                      >
                        <option>Cash</option>
                        <option>Online</option>
                        <option>Cheque</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Reference</label>
                    <input
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                      placeholder={String(newPayment.method).toLowerCase().includes('cheque') ? 'Cheque number *' : 'Transfer reference'}
                      value={newPayment.reference}
                      onChange={e => setNewPayment(p => ({ ...p, reference: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 mb-1">Notes</label>
                    <textarea
                      rows={2}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                      placeholder="Optional"
                      value={newPayment.notes}
                      onChange={e => setNewPayment(p => ({ ...p, notes: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
                  <button
                    onClick={() => setShowRecordPayment(null)}
                    className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRecordPayment}
                    disabled={saving}
                    className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Record Payment'}
                  </button>
                </div>
              </>
            )
          })()}
        </Modal>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-slate-100">
          <h2 className="text-base font-black text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
    </div>
  )
}

// ── VIEW 1: Supplier List ─────────────────────────────────────────────────────
function SupplierListView({
  suppliers,
  loading,
  onAddSupplier,
  onSelectSupplier,
  onEditSupplier,
}: {
  suppliers: any[]
  loading: boolean
  onAddSupplier: () => void
  onSelectSupplier: (s: any) => void
  onEditSupplier: (s: any) => void
}) {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-black text-slate-900">Suppliers</h1>
        <button
          onClick={onAddSupplier}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
        >
          <span className="text-base leading-none">+</span>
          Add Supplier
        </button>
      </div>

      {loading ? (
        <Spinner />
      ) : suppliers.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400 font-semibold text-sm">No suppliers yet.</p>
          <p className="text-slate-300 text-xs mt-1">Add your first supplier to start tracking payables.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Supplier</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Contact</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Terms</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Total Owed</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Overdue</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s: any) => (
                  <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <p className="font-bold text-slate-800 text-sm">
                        {s.name}
                        {/* The code survives renames — quote it on orders and cheques */}
                        {s.supplier_code && <span className="ml-1.5 text-[10px] font-mono font-bold text-slate-400">{s.supplier_code}</span>}
                      </p>
                      {s.email && (
                        <p className="text-xs text-slate-400 mt-0.5">{s.email}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.contact_name && (
                        <p className="text-xs text-slate-600 font-semibold">{s.contact_name}</p>
                      )}
                      {s.phone && (
                        <p className="text-xs text-slate-400 mt-0.5">{s.phone}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-slate-500">{s.payment_terms ?? 30} days</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(s.total_owed ?? 0) > 0 ? (
                        <span className="font-bold text-orange-500 text-sm">{formatRs(s.total_owed)}</span>
                      ) : (
                        <span className="text-slate-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {(s.overdue_amount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-bold text-red-600 text-sm">{formatRs(s.overdue_amount)}</span>
                          {(s.overdue_count ?? 0) > 0 && (
                            <span className="inline-block text-[10px] font-black px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
                              {s.overdue_count}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-slate-300 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => onEditSupplier(s)}
                        className="px-3 py-1.5 mr-1.5 rounded-lg border border-blue-200 text-xs font-semibold text-blue-600 hover:bg-blue-50 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onSelectSupplier(s)}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
                      >
                        View Invoices
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── VIEW 2: Invoice List ──────────────────────────────────────────────────────
function InvoiceListView({
  supplier,
  invoices,
  loading,
  showIncludePaid,
  onToggleIncludePaid,
  onBack,
  onAddInvoice,
  onPay,
  onDelete,
  hasUnpaid,
  aging,
}: {
  supplier: any
  invoices: any[]
  loading: boolean
  showIncludePaid: boolean
  onToggleIncludePaid: () => void
  onBack: () => void
  onAddInvoice: () => void
  onPay: (inv: any) => void
  onDelete: (inv: any) => void
  hasUnpaid: boolean
  aging: { current: number; b30: number; b60: number; b60plus: number }
}) {
  const today = todayStr()

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          <span className="text-base">←</span> Suppliers
        </button>
        <h2 className="text-xl font-black text-slate-900 flex-1">{supplier.name}</h2>
        <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showIncludePaid}
            onChange={onToggleIncludePaid}
            className="rounded accent-orange-500"
          />
          Show paid
        </label>
        <button
          onClick={onAddInvoice}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
        >
          <span className="text-base leading-none">+</span>
          Add Invoice
        </button>
      </div>

      {/* Supplier summary card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Supplier</p>
          <p className="font-bold text-slate-800">{supplier.name}</p>
          {supplier.contact_name && <p className="text-xs text-slate-500 mt-0.5">{supplier.contact_name}</p>}
          {supplier.phone && <p className="text-xs text-slate-400">{supplier.phone}</p>}
          {supplier.email && <p className="text-xs text-slate-400">{supplier.email}</p>}
        </div>
        {supplier.address && (
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Address</p>
            <p className="text-xs text-slate-500 whitespace-pre-wrap">{supplier.address}</p>
          </div>
        )}
        <div>
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-1">Payment Terms</p>
          <p className="text-sm text-slate-600">{supplier.payment_terms ?? 30} days</p>
          {(supplier.total_owed ?? 0) > 0 && (
            <div className="mt-3">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-0.5">Total Outstanding</p>
              <p className="text-lg font-black text-orange-500">{formatRs(supplier.total_owed)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Invoice table */}
      {loading ? (
        <Spinner />
      ) : invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <p className="text-slate-400 font-semibold text-sm">No invoices{showIncludePaid ? '' : ' (unpaid)'}.</p>
          <p className="text-slate-300 text-xs mt-1">Add a supplier invoice to start tracking payables.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-5">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Invoice No.</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Invoice Date</th>
                  <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Due Date</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Balance</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Days</th>
                  <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv: any) => {
                  const amtPaid = inv.amount_paid ?? 0
                  const balance = inv.amount - amtPaid
                  const overdueDays = inv.status === 'overdue' ? daysBetween(inv.due_date, today) : 0
                  return (
                    <tr key={inv.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-slate-700">{inv.invoice_no}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{inv.invoice_date}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">{inv.due_date}</td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-slate-700">{formatRs(inv.amount)}</td>
                      <td className="px-4 py-3 text-right text-xs text-slate-400">{amtPaid > 0 ? formatRs(amtPaid) : '—'}</td>
                      <td className="px-4 py-3 text-right text-sm font-bold text-slate-800">
                        {balance > 0 ? formatRs(balance) : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">{statusBadge(inv.status)}</td>
                      <td className="px-4 py-3 text-center">
                        {inv.status === 'overdue' && overdueDays > 0 ? (
                          <span className="text-xs font-bold text-red-600">{overdueDays}d</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {inv.status !== 'paid' && (
                            <button
                              onClick={() => onPay(inv)}
                              className="px-2.5 py-1 rounded-lg border border-emerald-300 text-[11px] font-bold text-emerald-700 hover:bg-emerald-50 transition-colors"
                            >
                              Pay
                            </button>
                          )}
                          {amtPaid === 0 && (
                            <button
                              onClick={() => onDelete(inv)}
                              className="px-2.5 py-1 rounded-lg border border-red-200 text-[11px] font-bold text-red-500 hover:bg-red-50 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Aging summary */}
      {hasUnpaid && (
        <div className="mb-4">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Aging Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <AgingCard label="Current" amount={aging.current} color="text-emerald-600" bg="bg-emerald-50 border-emerald-200" />
            <AgingCard label="1–30 days" amount={aging.b30} color="text-amber-600" bg="bg-amber-50 border-amber-200" />
            <AgingCard label="31–60 days" amount={aging.b60} color="text-orange-600" bg="bg-orange-50 border-orange-200" />
            <AgingCard label="60+ days" amount={aging.b60plus} color="text-red-600" bg="bg-red-50 border-red-200" />
          </div>
        </div>
      )}
    </div>
  )
}

function AgingCard({ label, amount, color, bg }: { label: string; amount: number; color: string; bg: string }) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <p className={`text-base font-black ${amount > 0 ? color : 'text-slate-300'}`}>
        {amount > 0 ? formatRs(amount) : '—'}
      </p>
      <p className="text-[11px] font-semibold text-slate-400 mt-0.5">{label}</p>
    </div>
  )
}
