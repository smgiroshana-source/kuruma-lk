'use client'
// ── WHEEL MART ONLY — THE supplier form ──────────────────────────────────────
//
// One form, used everywhere a supplier is created or edited (Stock → Suppliers
// and Suppliers & Payables). Two separate forms is how VAT/TIN silently
// stopped saving: each asked what its author remembered, and the API dropped
// the rest. Whatever screen opens it, the supplier record ends up the same.

import { useState } from 'react'
import { colomboToday } from '@/lib/dates'

type Props = {
  // Existing supplier row (snake_case, as the API returns it) — null to create
  initial?: any | null
  showToast: (m: string) => void
  onSaved: (supplier: any) => void
  onCancel: () => void
}

export default function SupplierForm({ initial, showToast, onSaved, onCancel }: Props) {
  const editing = !!initial?.id
  const [f, setF] = useState(() => ({
    name: initial?.name || '',
    contact_name: initial?.contact_name || '',
    phone: initial?.phone || '',
    email: initial?.email || '',
    address: initial?.address || '',
    payment_terms: initial?.payment_terms ?? 30,
    notes: initial?.notes || '',
    country: initial?.country || 'LK',
    currency: initial?.currency || 'LKR',
    vat_registered: initial?.vat_registered === true,
    tin: initial?.tin || '',
    // Pre-system debt — only asked when creating; afterwards it's an invoice
    opening_balance: '' as number | '',
    opening_date: '',
  }))
  const [saving, setSaving] = useState(false)
  const set = (patch: any) => setF(p => ({ ...p, ...patch }))

  async function save() {
    if (!f.name.trim()) { showToast('Supplier name is required'); return }
    if (f.vat_registered && !/^\d{9}$/.test(f.tin.trim())) {
      showToast('Enter the supplier\'s 9-digit TIN'); return
    }
    const opening = Math.round(Number(f.opening_balance) || 0)
    setSaving(true)
    try {
      const { opening_balance, opening_date, ...fields } = f
      const body = editing
        ? { action: 'update', supplierId: initial.id, ...fields }
        : { action: 'create', ...fields }
      const r = await fetch('/api/vendor/suppliers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed to save supplier')
      const saved = j.supplier || { ...initial, ...fields }

      // The old debt becomes a real invoice — it ages, nags when overdue and
      // takes part-payments, which a number on the supplier row never could.
      if (!editing && opening > 0 && saved?.id) {
        const asAt = opening_date || colomboToday()
        const invRes = await fetch('/api/vendor/supplier-invoices', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'create_invoice',
            supplier_id: saved.id,
            invoice_no: 'OPENING-BALANCE',
            invoice_date: asAt,
            due_date: asAt,
            amount: opening,
            notes: 'Opening balance — owed before the system started',
          }),
        })
        if (!invRes.ok) {
          const e2 = await invRes.json()
          showToast(`Supplier saved, but the opening balance failed: ${e2.error ?? 'unknown'} — add it via Add Invoice`)
        } else {
          showToast(`Supplier saved — Rs.${opening.toLocaleString()} opening balance recorded`)
        }
      } else {
        showToast(editing ? 'Supplier updated' : 'Supplier added')
      }
      onSaved(saved)
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  const inp = 'w-full px-3 py-2 rounded-lg border-2 border-slate-200 text-sm outline-none focus:border-orange-400'
  const lbl = 'text-[10px] font-bold text-slate-400 uppercase block mb-1'

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className={lbl}>Supplier Name <span className="text-red-400">*</span></label>
          <input type="text" value={f.name} onChange={e => set({ name: e.target.value })}
            placeholder="e.g. Toyota Lanka (Pvt) Ltd" className={inp} />
        </div>
        <div>
          <label className={lbl}>Contact Name</label>
          <input type="text" value={f.contact_name} onChange={e => set({ contact_name: e.target.value })}
            placeholder="e.g. Kamal Perera" className={inp} />
        </div>
        <div>
          <label className={lbl}>Phone</label>
          <input type="tel" value={f.phone} onChange={e => set({ phone: e.target.value })}
            placeholder="e.g. 0112345678" className={inp} />
        </div>
        <div>
          <label className={lbl}>Email</label>
          <input type="email" value={f.email} onChange={e => set({ email: e.target.value })}
            placeholder="e.g. orders@supplier.lk" className={inp} />
        </div>
        <div>
          <label className={lbl}>Payment Terms (days)</label>
          <input type="number" min={0} value={f.payment_terms}
            onChange={e => set({ payment_terms: Number(e.target.value) || 0 })} className={inp} />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Address</label>
          <input type="text" value={f.address} onChange={e => set({ address: e.target.value })}
            placeholder="Street, City" className={inp} />
        </div>
        <div>
          <label className={lbl}>Country</label>
          <select value={f.country} onChange={e => set({ country: e.target.value })} className={inp + ' bg-white'}>
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
          <label className={lbl}>Currency</label>
          <select value={f.currency} onChange={e => set({ currency: e.target.value })} className={inp + ' bg-white'}>
            <option value="LKR">LKR — Sri Lankan Rupee</option>
            <option value="JPY">JPY — Japanese Yen</option>
            <option value="USD">USD — US Dollar</option>
            <option value="CNY">CNY — Chinese Yuan</option>
            <option value="INR">INR — Indian Rupee</option>
            <option value="EUR">EUR — Euro</option>
            <option value="KRW">KRW — Korean Won</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Notes</label>
          <input type="text" value={f.notes} onChange={e => set({ notes: e.target.value })}
            placeholder="Optional notes" className={inp} />
        </div>
      </div>

      {/* VAT status drives the GRN default rate and Schedule 02 eligibility */}
      <div className={`rounded-xl border-2 p-3 ${f.vat_registered ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200'}`}>
        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" checked={f.vat_registered}
            onChange={e => set({ vat_registered: e.target.checked })}
            className="w-4 h-4 mt-0.5 accent-emerald-600" />
          <span>
            <span className="block text-xs font-bold text-slate-700">VAT-registered supplier</span>
            <span className="block text-[11px] text-slate-400">GRN lines default to the standard rate and their invoices count as input VAT</span>
          </span>
        </label>
        {f.vat_registered && (
          <input type="text" inputMode="numeric" maxLength={9}
            className="mt-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-400"
            placeholder="9-digit TIN *"
            value={f.tin}
            onChange={e => set({ tin: e.target.value.replace(/\D/g, '') })} />
        )}
      </div>

      {/* Only on create: pre-system debt becomes a real, ageing invoice */}
      {!editing && (
        <div className="rounded-xl border-2 border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-700 mb-0.5">Already owe this supplier money?</p>
          <p className="text-[11px] text-slate-400 mb-2">The old balance is saved as an invoice, so it ages and takes payments like any other.</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={0}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Amount owed (Rs.)"
              value={f.opening_balance}
              onChange={e => set({ opening_balance: e.target.value === '' ? '' : Math.round(Number(e.target.value)) })} />
            <input type="date"
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={f.opening_date}
              onChange={e => set({ opening_date: e.target.value })} />
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving}
          className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-lg">
          {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Supplier'}
        </button>
        <button onClick={onCancel} className="text-xs font-bold text-slate-500 px-4 py-2 rounded-lg hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  )
}
