'use client'
// ── WHEEL MART ONLY — the money popups, shared ───────────────────────────────
//
// One implementation of every quick money form — expense, movement, staff
// advance, quick service income, plus the drawer open/close and attendance
// popups — used by BOTH the Cash tab and the dashboard's Today's-flow. Two
// copies of a form is how fields silently stop saving (the supplier form
// lesson), so the dashboard imports these, never re-implements them.

import { useState, useEffect } from 'react'
import { colomboToday } from '@/lib/dates'

export function formatRs(n: number): string {
  return 'Rs. ' + Math.round(n).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}
export function todayStr(): string { return colomboToday() }

export const MOVEMENT_LABEL: Record<string, string> = {
  owner_in: 'Owner put money in', bank_in: 'Drawn from bank',
  to_bank: 'Banked to account', owner_out: 'Given to owner',
}
export const MOVEMENT_ICON: Record<string, string> = {
  owner_in: '👤→💵', bank_in: '🏦→💵', to_bank: '💵→🏦', owner_out: '💵→👤',
}

// What the operator picks. Kept short and concrete — a shop assistant should
// find the right one without reading the whole list.
export const CATEGORIES: { v: string; l: string; icon: string }[] = [
  { v: 'grocery',     l: 'Grocery',     icon: '🛒' },
  { v: 'rent',        l: 'Rental',      icon: '🏠' },
  { v: 'electricity', l: 'Electricity', icon: '💡' },
  { v: 'water',       l: 'Water',       icon: '💧' },
  { v: 'stationery',  l: 'Stationery',  icon: '📄' },
  { v: 'internet',    l: 'Internet',    icon: '🌐' },
  { v: 'transport',   l: 'Transport',   icon: '🚚' },
  { v: 'maintenance', l: 'Maintenance', icon: '🧰' },
  { v: 'commission',  l: 'Commission',  icon: '🤝' },
  { v: 'other',       l: 'Other',       icon: '📌' },
]

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
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


export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-8 h-8 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
    </div>
  )
}


// ── Salary advance ───────────────────────────────────────────────────────────
// Cash handed to a staff member before payday. It is NOT an ordinary expense
// the cashier types by hand: recorded here it lands against the person in
// Staff, so payroll can deduct it, AND posts a salaries expense tied to the
// open session, so the drawer still balances at close. Typing it as a plain
// expense instead would count the money twice come payroll.
export function AdvanceModal({
  onClose, onSaved, showToast, initialAmount,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
  initialAmount?: number
}) {
  const [people, setPeople] = useState<{ id: string; name: string; branch?: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState<number | ''>(initialAmount && initialAmount > 0 ? Math.round(initialAmount) : '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/vendor/staff-hr?mode=names')
      .then(r => r.json())
      .then(j => setPeople(j.employees || []))
      .catch(() => showToast('Could not load staff list'))
      .finally(() => setLoading(false))
  }, [showToast])

  async function save() {
    if (!employeeId) { showToast('Pick who is taking the advance'); return }
    if (amount === '' || Number(amount) <= 0) { showToast('Enter the amount'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vendor/staff-hr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add_advance',
          employee_id: employeeId,
          amount: Math.round(Number(amount)),
          date: todayStr(),
          source: 'drawer',
          note: note.trim() || null,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to record advance')
      showToast('Advance recorded — it will be deducted at payroll')
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title="Salary Advance" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        Cash out of the till, before payday. It comes off what they are paid at the end of the month.
      </p>

      {loading ? (
        <Spinner />
      ) : people.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No staff on the system yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">1. Who is taking it?</p>
            <div className="grid grid-cols-2 gap-1.5 max-h-52 overflow-y-auto">
              {people.map(p => (
                <button
                  key={p.id}
                  onClick={() => setEmployeeId(p.id)}
                  className={`text-left px-3 py-2.5 rounded-xl border-2 transition min-h-[44px] ${
                    employeeId === p.id ? 'border-indigo-500 bg-indigo-50 text-indigo-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <span className="block text-sm font-bold leading-tight">{p.name}</span>
                  {p.branch && <span className="block text-[10px] text-slate-400 capitalize">{p.branch}</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">2. How much?</p>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">Rs.</span>
              <input
                type="number"
                min={1}
                className="w-full border-2 border-slate-200 rounded-xl pl-14 pr-4 py-3 text-2xl font-black text-slate-800 focus:outline-none focus:border-indigo-400"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-500 mb-2">3. Note <span className="font-normal text-slate-400">(optional)</span></p>
            <input
              type="text"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              placeholder="e.g. for hospital"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          <p className="text-[11px] text-slate-400">
            Paid from today&apos;s till. The drawer will expect {amount !== '' ? formatRs(Number(amount)) : 'this amount'} less at closing.
          </p>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button
          onClick={save}
          disabled={saving || !employeeId || amount === '' || Number(amount) <= 0}
          className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black disabled:opacity-40"
        >
          {saving ? 'Saving…' : amount !== '' && Number(amount) > 0 ? `Pay ${formatRs(Number(amount))}` : 'Pay'}
        </button>
      </div>
    </Modal>
  )
}


// ── Money in / out (not a sale) ──────────────────────────────────────────────
// Owner tops up the float, cash is drawn from the bank, the takings are
// banked, the owner takes drawings. Money MOVED, not earned or spent: the
// drawer count follows it, profit never sees it. The direction is decided by
// whichever button opened the modal — it is never asked twice.
export function MovementModal({
  onClose, onSaved, showToast, drawerExpected, todayMovements, initialDir, initialType, initialAmount,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
  drawerExpected?: number | null
  todayMovements?: any[]
  initialDir: 'in' | 'out'
  initialType?: string
  initialAmount?: number
}) {
  const TYPES = [
    { v: 'owner_in',  icon: '👤', l: 'From owner',  d: 'Owner’s own money into the till', dir: 'in' },
    { v: 'bank_in',   icon: '🏦', l: 'From bank',   d: 'Cash drawn from the business account', dir: 'in' },
    { v: 'to_bank',   icon: '🏦', l: 'To bank',     d: 'Banking the day’s cash', dir: 'out' },
    { v: 'owner_out', icon: '👤', l: 'To owner',    d: 'Excess cash / drawings handed to the owner', dir: 'out' },
  ] as const
  const dir = initialDir
  const [type, setType] = useState<string>(initialType || (dir === 'in' ? 'owner_in' : 'to_bank'))
  const [amount, setAmount] = useState<number | ''>(initialAmount && initialAmount > 0 ? Math.round(initialAmount) : '')
  const [date, setDate] = useState(todayStr())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const picked = TYPES.find(t => t.v === type)
  const visible = TYPES.filter(t => t.dir === dir)

  async function save() {
    if (!type) { showToast(dir === 'in' ? 'Pick where the money came from' : 'Pick where the money went'); return }
    if (amount === '' || Number(amount) <= 0) { showToast('Enter the amount'); return }
    const amt = Math.round(Number(amount))
    // Guardrail 1: taking out more than the drawer holds is usually a typo
    if (picked?.dir === 'out' && date === todayStr() && drawerExpected != null && amt > drawerExpected) {
      if (!confirm(`The drawer only expects ${formatRs(drawerExpected)} right now — taking out ${formatRs(amt)} would leave it negative.\n\nRecord anyway?`)) return
    }
    // Guardrail 2: the same movement twice in a day is usually a double-entry
    const dupe = (todayMovements || []).find(m => m.type === type && Number(m.amount) === amt && date === todayStr())
    if (dupe) {
      if (!confirm(`${MOVEMENT_LABEL[type]} of ${formatRs(amt)} is already recorded today.\n\nRecord it a second time?`)) return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/cash-movements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', movement_date: date, type, amount: amt, note: note.trim() || null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to record')
      showToast(picked?.dir === 'in'
        ? `✅ Recorded — the drawer expects ${formatRs(amt)} more`
        : `✅ Recorded — the drawer expects ${formatRs(amt)} less`)
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title={dir === 'in' ? 'Money into the till' : 'Money out of the till'} onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        {dir === 'in' ? 'Not a sale — ' : 'Not an expense — '}
        the drawer count follows it, profit never sees it.
      </p>

      <div className="grid grid-cols-2 gap-1.5 mb-4">
        {visible.map(t => (
          <button key={t.v} onClick={() => setType(t.v)}
            className={`text-left px-3 py-2.5 rounded-xl border-2 transition ${
              type === t.v
                ? (dir === 'in' ? 'border-emerald-500 bg-emerald-50' : 'border-amber-500 bg-amber-50')
                : 'border-slate-200 hover:border-slate-300'
            }`}>
            <span className="text-lg leading-none">{t.icon}</span>
            <span className="block text-xs font-black text-slate-800 mt-1">{t.l}</span>
            <span className="block text-[10px] text-slate-400 leading-tight mt-0.5">{t.d}</span>
          </button>
        ))}
      </div>

      <div className="relative mb-3">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">Rs.</span>
        <input type="number" min={1} value={amount}
          onChange={e => setAmount(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
          placeholder="0"
          className={`w-full border-2 rounded-xl pl-14 pr-4 py-3 text-2xl font-black text-slate-800 focus:outline-none ${dir === 'in' ? 'border-slate-200 focus:border-emerald-400' : 'border-slate-200 focus:border-amber-400'}`} />
      </div>
      {picked && amount !== '' && Number(amount) > 0 && (
        <p className={`text-[11px] font-bold mb-3 ${dir === 'in' ? 'text-emerald-700' : 'text-amber-700'}`}>
          {MOVEMENT_LABEL[picked.v]} — the drawer will expect {formatRs(Number(amount))} {dir === 'in' ? 'more' : 'less'}. Profit is untouched.
        </p>
      )}

      <div className="flex items-center gap-2 text-xs mb-3">
        <span className="font-bold text-slate-500">Date</span>
        <input type="date" max={todayStr()} value={date} onChange={e => setDate(e.target.value)}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400" />
        {date === todayStr() ? <span className="text-slate-400">Today</span> : null}
      </div>

      <input type="text" value={note} onChange={e => setNote(e.target.value)}
        placeholder="Note (optional) — e.g. float top-up for the long weekend"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400" />

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || !type || amount === '' || Number(amount) <= 0}
          className={`px-5 py-2.5 rounded-lg text-white text-sm font-black disabled:opacity-40 ${dir === 'in' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'}`}>
          {saving ? 'Saving…' : 'Record'}
        </button>
      </div>
    </Modal>
  )
}


// ── Quick service income (Proprietor) ────────────────────────────────────────
// Small cash jobs with no document — puncture, air fill, a quick fit. This is
// INCOME, not a movement: it saves as a real Proprietorship receipt (RCP
// series, SVC line, cash payment), so revenue, profit, the drawer and the
// daily report all see it through the one sales pipeline. No VAT — the
// Proprietorship isn't VAT-registered — and nothing touches the Pvt Ltd.
export function QuickIncomeModal({
  onClose, onSaved, showToast, initialAmount,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
  initialAmount?: number
}) {
  const PRESETS = ['Puncture repair', 'Air / nitrogen fill', 'Tube fitting', 'Quick service']
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState<number | ''>(initialAmount && initialAmount > 0 ? Math.round(initialAmount) : '')
  const [saving, setSaving] = useState(false)
  const [propEntity, setPropEntity] = useState<{ id: string; name: string } | null>(null)
  const [entityLoading, setEntityLoading] = useState(true)

  useEffect(() => {
    fetch('/api/vendor/invoice-entities')
      .then(r => r.json())
      .then(j => {
        // The Proprietorship = the entity that issues receipts, not tax invoices
        const prop = (j.entities || []).find((e: any) => e.invoice_mode !== 'lk_tax')
        setPropEntity(prop ? { id: prop.id, name: prop.name } : null)
      })
      .catch(() => {})
      .finally(() => setEntityLoading(false))
  }, [])

  async function save() {
    if (amount === '' || Number(amount) <= 0) { showToast('Enter the amount'); return }
    if (!propEntity) { showToast('No Proprietorship entity configured'); return }
    const amt = Math.round(Number(amount))
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/sales', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_sale',
          invoiceEntityId: propEntity.id,
          items: [{ productId: null, productName: desc.trim() || 'Service income', productSku: '', quantity: 1, unitPrice: amt, ssclStream: 'SVC' }],
          payments: [{ method: 'cash', amount: amt }],
          notes: 'Quick service income — no document issued',
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to record')
      showToast(`✅ ${formatRs(amt)} recorded as ${propEntity.name} income${j.invoiceNo ? ` (${j.invoiceNo})` : ''}`)
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title="Service income — no invoice" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        Quick cash jobs with no document. Counted as <strong>{propEntity?.name || 'Proprietor'}</strong> service
        income — it goes into revenue and the drawer like any sale. No VAT.
      </p>

      <div className="flex flex-wrap gap-1.5 mb-2">
        {PRESETS.map(p => (
          <button key={p} onClick={() => setDesc(p)}
            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border-2 transition ${
              desc === p ? 'border-emerald-500 bg-emerald-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300'
            }`}>
            {p}
          </button>
        ))}
      </div>
      <input type="text" value={desc} onChange={e => setDesc(e.target.value)}
        placeholder="Or type what the job was…"
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400 mb-3" />

      <div className="relative mb-4">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">Rs.</span>
        <input type="number" min={1} autoFocus value={amount}
          onChange={e => setAmount(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
          placeholder="0"
          className="w-full border-2 border-slate-200 rounded-xl pl-14 pr-4 py-3 text-2xl font-black text-slate-800 focus:outline-none focus:border-emerald-400" />
      </div>

      <p className="text-[11px] text-slate-400 mb-1">
        Cash into today&apos;s till. If the customer wants a receipt or pays later, use the POS instead.
      </p>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || entityLoading || amount === '' || Number(amount) <= 0}
          className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Saving…' : amount !== '' && Number(amount) > 0 ? `Record ${formatRs(Number(amount))}` : 'Record'}
        </button>
      </div>
    </Modal>
  )
}


// ── Add Expense — THE expense form (Cash tab and dashboard both mount it) ────
export function blankExpenseForm() {
  return {
    expense_date: todayStr(),
    category: '' as string,
    description: '',
    amount: '' as number | '',
    payment_method: 'cash',
    reference: '',
    // Input VAT on the bill — only claimable with a supplier tax invoice
    claim_vat: false,
    supplier_name: '',
    supplier_tin: '',
    supplier_invoice_no: '',
    supplier_invoice_date: '',
    input_vat: '' as number | '',
  }
}

export function ExpenseModal({
  onClose, onSaved, showToast, openSessionId, initialAmount, initialDate,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
  // Today's OPEN cash session id, when the caller has one — links cash
  // expenses to the till so the expected count reconciles
  openSessionId?: string | null
  initialAmount?: number
  initialDate?: string
}) {
  const [f, setF] = useState(() => ({
    ...blankExpenseForm(),
    ...(initialAmount && initialAmount > 0 ? { amount: Math.round(initialAmount) } : {}),
    ...(initialDate ? { expense_date: initialDate } : {}),
  }))
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!f.category) {
      showToast('Pick what the expense was for')
      return
    }
    if (f.amount === '' || Number(f.amount) <= 0) {
      showToast('Enter a valid amount')
      return
    }
    // Every other category names itself on the report; "Other" doesn't, so the
    // note has to say what the money was for or the line is unreadable later.
    if (f.category === 'other' && !f.description.trim()) {
      showToast('Say what it was for — "Other" on its own means nothing later')
      return
    }
    if (f.payment_method !== 'cash' && !f.reference.trim()) {
      showToast(f.payment_method === 'cheque' ? 'Enter the cheque number' : 'Enter the 8-digit bank confirmation number')
      return
    }
    if (f.claim_vat) {
      if (!/^\d{9}$/.test(f.supplier_tin.trim())) { showToast('Enter the shop\'s 9-digit VAT / TIN number'); return }
      if (!f.supplier_invoice_no.trim()) { showToast('Enter the bill number'); return }
      if (Number(f.input_vat) <= 0) { showToast('Enter the VAT shown on the bill'); return }
    }
    setSaving(true)
    try {
      const res = await fetch('/api/vendor/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          expense_date: f.expense_date,
          category: f.category,
          // The note is optional — the category name says enough on its own
          description: f.description.trim() || CATEGORIES.find(c => c.v === f.category)?.l || 'Expense',
          amount: Math.round(Number(f.amount)),
          payment_method: f.payment_method,
          reference: f.reference.trim() || null,
          supplier_name:         f.claim_vat ? f.supplier_name.trim() : null,
          supplier_tin:          f.claim_vat ? f.supplier_tin.trim() : null,
          supplier_invoice_no:   f.claim_vat ? f.supplier_invoice_no.trim() : null,
          supplier_invoice_date: f.claim_vat ? (f.supplier_invoice_date || f.expense_date) : null,
          input_vat:             f.claim_vat ? Math.round(Number(f.input_vat) || 0) : 0,
          // A cash expense dated today belongs in the open till session so the
          // expected-cash count reconciles; non-cash / back-dated stay unlinked.
          cash_session_id:
            f.payment_method === 'cash' && f.expense_date === todayStr() ? (openSessionId || null) : null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to add expense')
      }
      showToast('Expense added')
      onSaved()
    } catch (e: any) {
      showToast(e.message)
    }
    setSaving(false)
  }

  return (
        <Modal title="Add Expense" onClose={onClose}>
    <div className="flex flex-col gap-4">

      {/* 1 — What was it for. Tiles, not a dropdown: one tap, and the
             operator sees every option at once instead of scrolling. */}
      <div>
        <p className="text-xs font-bold text-slate-500 mb-2">1. What was it for?</p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
          {CATEGORIES.map(c => {
            const on = f.category === c.v
            return (
              <button
                key={c.v}
                onClick={() => setF(p => ({ ...p, category: c.v }))}
                className={`flex flex-col items-center justify-center gap-0.5 py-2.5 rounded-xl border-2 transition min-h-[62px] ${
                  on ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <span className="text-lg leading-none">{c.icon}</span>
                <span className="text-[11px] font-bold leading-tight text-center">{c.l}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 2 — How much. The one number that must be right, so it's big. */}
      <div>
        <p className="text-xs font-bold text-slate-500 mb-2">2. How much?</p>
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">Rs.</span>
          <input
            type="number"
            min={1}
            autoFocus
            className="w-full border-2 border-slate-200 rounded-xl pl-14 pr-4 py-3 text-2xl font-black text-slate-800 focus:outline-none focus:border-orange-400"
            placeholder="0"
            value={f.amount}
            onChange={e => {
              const amt = e.target.value === '' ? '' : Math.round(Number(e.target.value))
              setF(p => ({
                ...p,
                amount: amt,
                // Keep the suggested VAT in step while they type
                input_vat: p.claim_vat && amt !== '' ? Math.round(Number(amt) * 18 / 118) : p.input_vat,
              }))
            }}
          />
        </div>
      </div>

      {/* 3 — How it was paid. Buttons beat a select on a touchscreen. */}
      <div>
        <p className="text-xs font-bold text-slate-500 mb-2">3. Paid by</p>
        <div className="grid grid-cols-3 gap-1.5">
          {[
            { v: 'cash', l: 'Cash', icon: '💵' },
            { v: 'online', l: 'Online', icon: '🏦' },
            { v: 'cheque', l: 'Cheque', icon: '📝' },
          ].map(m => {
            const on = f.payment_method === m.v
            return (
              <button
                key={m.v}
                onClick={() => setF(p => ({ ...p, payment_method: m.v }))}
                className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-sm font-bold transition min-h-[44px] ${
                  on ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <span>{m.icon}</span>{m.l}
              </button>
            )
          })}
        </div>
        {f.payment_method !== 'cash' && (
          <>
            <input
              type="text"
              className="mt-2 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
              placeholder={f.payment_method === 'cheque'
                ? 'Cheque number *'
                : 'Bank reference — the 8-digit confirmation number *'}
              value={f.reference}
              onChange={e => setF(p => ({ ...p, reference: e.target.value }))}
            />
            <p className="text-[11px] text-slate-400 mt-1">
              {f.payment_method === 'cheque'
                ? 'The cheque counts as paid the day it is written. Nothing comes off the till.'
                : 'A bank transfer or standing order. Nothing comes off the till.'}
            </p>
          </>
        )}
      </div>

      {/* 4 — A note. Optional for named categories (they say most of it),
             REQUIRED for "Other" — which says nothing on its own. */}
      <div>
        <p className="text-xs font-bold text-slate-500 mb-2">
          4. Note{' '}
          {f.category === 'other'
            ? <span className="text-red-500">*</span>
            : <span className="font-normal text-slate-400">(optional)</span>}
        </p>
        <input
          type="text"
          className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 ${
            f.category === 'other' && !f.description.trim()
              ? 'border-amber-300 bg-amber-50/40 focus:ring-amber-400'
              : 'border-slate-200 focus:ring-orange-400'
          }`}
          placeholder={f.category === 'other'
            ? 'What was it for? e.g. new signboard for the shop'
            : `e.g. ${f.category === 'grocery' ? 'tea and sugar for the office'
              : f.category === 'transport' ? 'three-wheeler to Customs'
              : f.category === 'electricity' ? 'CEB bill for July'
              : f.category === 'commission' ? 'broker who brought the lorry job'
              : 'what exactly was bought'}`}
          value={f.description}
          onChange={e => setF(p => ({ ...p, description: e.target.value }))}
        />
        {f.category === 'other' && !f.description.trim() && (
          <p className="text-[11px] text-amber-700 font-semibold mt-1">
            Needed for &ldquo;Other&rdquo; — otherwise the report just says &ldquo;Other&rdquo;.
          </p>
        )}
      </div>

      {/* Date — almost always today, so it stays out of the way */}
      <div className="flex items-center gap-2 text-xs">
        <span className="font-bold text-slate-500">Date</span>
        <input
          type="date"
          max={todayStr()}
          className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
          value={f.expense_date}
          onChange={e => setF(p => ({ ...p, expense_date: e.target.value }))}
        />
        {f.expense_date === todayStr()
          ? <span className="text-slate-400">Today</span>
          : <button onClick={() => setF(p => ({ ...p, expense_date: todayStr() }))} className="text-orange-600 font-bold">back to today</button>}
      </div>

      {/* 5 — The VAT bill. Asked as a plain yes/no question about the
             piece of paper in the operator's hand, not as tax jargon. */}
      <div className={`rounded-xl border-2 p-3 ${f.claim_vat ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
        <p className="text-xs font-bold text-slate-500 mb-2">5. Did you get a VAT bill?</p>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { on: false, l: 'No / just a receipt' },
            { on: true,  l: 'Yes — VAT bill' },
          ].map(o => (
            <button
              key={String(o.on)}
              onClick={() => setF(p => ({
                ...p,
                claim_vat: o.on,
                // Bills are quoted VAT-inclusive — pull the 18% back out
                input_vat: o.on && p.amount !== '' ? Math.round(Number(p.amount) * 18 / 118) : '',
              }))}
              className={`py-2.5 rounded-xl border-2 text-sm font-bold transition min-h-[44px] ${
                f.claim_vat === o.on
                  ? (o.on ? 'border-violet-500 bg-white text-violet-700' : 'border-slate-400 bg-white text-slate-700')
                  : 'border-slate-200 text-slate-400 hover:border-slate-300'
              }`}
            >
              {o.l}
            </button>
          ))}
        </div>

        {!f.claim_vat ? (
          <p className="text-[11px] text-slate-400 mt-2">
            A VAT bill shows the shop&apos;s VAT number and the VAT amount. If one turns up later,
            add it from the list — no need to hold up the entry now.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="col-span-2 rounded-lg bg-white border border-violet-200 px-3 py-2">
              <p className="text-[11px] font-bold text-slate-500">VAT you can claim back</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-base font-bold text-slate-400">Rs.</span>
                <input
                  type="number"
                  min={0}
                  className="flex-1 text-xl font-black text-violet-700 outline-none"
                  value={f.input_vat}
                  onChange={e => setF(p => ({ ...p, input_vat: e.target.value === '' ? '' : Math.round(Number(e.target.value)) }))}
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-0.5">
                Filled in as 18% of the amount. <strong>Change it to the VAT printed on the bill.</strong>
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Shop&apos;s VAT / TIN no. <span className="text-red-500">*</span></label>
              <input
                type="text" inputMode="numeric" maxLength={9}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                placeholder="9 digits"
                value={f.supplier_tin}
                onChange={e => setF(p => ({ ...p, supplier_tin: e.target.value.replace(/\D/g, '') }))}
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Bill no. <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                placeholder="On the bill"
                value={f.supplier_invoice_no}
                onChange={e => setF(p => ({ ...p, supplier_invoice_no: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Shop name</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                placeholder="e.g. Ceylon Electricity Board"
                value={f.supplier_name}
                onChange={e => setF(p => ({ ...p, supplier_name: e.target.value }))}
              />
            </div>
            <p className="col-span-2 text-[11px] text-violet-700">
              Keep the bill in the file — the VAT office can ask for it.
            </p>
          </div>
        )}
      </div>
    </div>

    <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
      <button
        onClick={onClose}
        className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={save}
        disabled={saving || !f.category || f.amount === '' || Number(f.amount) <= 0 || (f.category === 'other' && !f.description.trim())}
        className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black transition-colors disabled:opacity-40"
      >
        {saving ? 'Saving…' : f.amount !== '' && Number(f.amount) > 0 ? `Save ${formatRs(Number(f.amount))}` : 'Save'}
      </button>
    </div>
  </Modal>
  )
}

// ── Open the drawer ──────────────────────────────────────────────────────────
// Yesterday's counted cash IS today's opening float — suggested, never forced.
export function OpenDrawerModal({
  onClose, onSaved, showToast,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const [opening, setOpening] = useState<number | ''>('')
  const [suggest, setSuggest] = useState<{ amount: number; date: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/vendor/cash-sessions')
      .then(r => r.json())
      .then(j => {
        const prev = (j.sessions || []).find((x: any) => x.status === 'closed' && x.closing_balance != null)
        if (prev) { setSuggest({ amount: parseInt(prev.closing_balance), date: prev.session_date }); setOpening(parseInt(prev.closing_balance)) }
      })
      .catch(() => {})
  }, [])

  async function save() {
    if (opening === '' || Number(opening) < 0) { showToast('Enter the opening cash'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/cash-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'open', session_date: todayStr(), opening_balance: Math.round(Number(opening)) }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to open')
      showToast('✅ Drawer open — good morning')
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title="Open the drawer" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        Count what&apos;s in the tray right now and confirm it. Everything today measures from this number.
      </p>
      <div className="relative mb-2">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">Rs.</span>
        <input type="number" min={0} autoFocus value={opening}
          onChange={e => setOpening(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
          placeholder="0"
          className="w-full border-2 border-slate-200 rounded-xl pl-14 pr-4 py-3 text-2xl font-black text-slate-800 focus:outline-none focus:border-orange-400" />
      </div>
      {suggest && (
        <p className="text-[11px] text-slate-400 mb-1">
          {Number(opening) === suggest.amount
            ? <>Matches the {formatRs(suggest.amount)} counted at close on {suggest.date}.</>
            : <>Counted at close on {suggest.date}: <button onClick={() => setOpening(suggest.amount)} className="font-bold text-orange-600 underline">{formatRs(suggest.amount)}</button> — a different figure means cash moved overnight.</>}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || opening === ''}
          className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Opening…' : 'Open drawer'}
        </button>
      </div>
    </Modal>
  )
}

// ── Count and close ──────────────────────────────────────────────────────────
// The operator types what they counted; the live variance is shown BEFORE they
// commit, so a typo is caught while the cash is still on the table.
export function CloseDrawerModal({
  session, onClose, onSaved, showToast,
}: {
  session: { id: string; live_expected?: number | null; expected_cash?: number | null }
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const expected = session.live_expected ?? session.expected_cash ?? null
  const [counted, setCounted] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const variance = counted === '' || expected == null ? null : Math.round(Number(counted)) - Math.round(Number(expected))

  async function save() {
    if (counted === '' || Number(counted) < 0) { showToast('Enter the counted cash'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/cash-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', sessionId: session.id, closing_balance: Math.round(Number(counted)) }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to close')
      showToast('✅ Drawer closed and reconciled')
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title="Count and close" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        Count every note and coin in the tray, then type the total.
      </p>
      {expected != null && (
        <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2 mb-3">
          <span className="text-xs font-bold text-slate-500">The drawer should hold</span>
          <span className="text-sm font-black text-slate-800">{formatRs(expected)}</span>
        </div>
      )}
      <div className="relative mb-2">
        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">Rs.</span>
        <input type="number" min={0} autoFocus value={counted}
          onChange={e => setCounted(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
          placeholder="Counted cash"
          className="w-full border-2 border-slate-200 rounded-xl pl-14 pr-4 py-3 text-2xl font-black text-slate-800 focus:outline-none focus:border-orange-400" />
      </div>
      {variance != null && (
        <p className={`text-xs font-bold mb-1 ${variance === 0 ? 'text-emerald-600' : variance < 0 ? 'text-red-600' : 'text-amber-600'}`}>
          {variance === 0 ? '✓ Balanced to the rupee'
            : variance < 0 ? `${formatRs(-variance)} SHORT — recount before closing, or close and fix from the variance panel`
            : `${formatRs(variance)} OVER — recount, or was something not entered?`}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || counted === ''}
          className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Closing…' : 'Close drawer'}
        </button>
      </div>
    </Modal>
  )
}

// ── Attendance ───────────────────────────────────────────────────────────────
// Everyone defaults to Present; the operator flips the exceptions and saves.
// Reopening later edits the same day — marks upsert.
export function AttendanceModal({
  onClose, onSaved, showToast,
}: {
  onClose: () => void
  onSaved: (marked: number, total: number) => void
  showToast: (m: string) => void
}) {
  const [people, setPeople] = useState<any[]>([])
  const [marks, setMarks] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/vendor/staff-hr?date=' + todayStr())
      .then(r => r.json())
      .then(j => {
        const emps = (j.employees || []).filter((e: any) => e.active !== false)
          .filter((e: any) => !e.join_date || e.join_date <= todayStr())
        setPeople(emps)
        const m: Record<string, string> = {}
        for (const e of emps) {
          const existing = (j.attendance || []).find((a: any) => a.employee_id === e.id)
          m[e.id] = existing?.status || 'present'
        }
        setMarks(m)
      })
      .catch(() => showToast('Could not load staff'))
      .finally(() => setLoading(false))
  }, [showToast])

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/staff-hr', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'mark_attendance', date: todayStr(),
          marks: people.map(p => ({ employee_id: p.id, status: marks[p.id] || 'present' })),
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to save')
      showToast(`✅ Attendance saved — ${people.length}/${people.length} marked`)
      onSaved(people.length, people.length)
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  const OPTIONS = [
    { v: 'present', l: 'P', full: 'Present', on: 'bg-emerald-600 text-white border-emerald-600' },
    { v: 'half',    l: '½', full: 'Half',    on: 'bg-amber-500 text-white border-amber-500' },
    { v: 'absent',  l: 'A', full: 'Absent',  on: 'bg-red-500 text-white border-red-500' },
  ]

  return (
    <Modal title="Today's attendance" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        Everyone starts as Present — tap only the exceptions. You can reopen and correct this any time today.
      </p>
      {loading ? <Spinner /> : people.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No active staff registered.</p>
      ) : (
        <div className="space-y-1.5">
          {people.map(p => (
            <div key={p.id} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-bold text-slate-800 truncate">{p.name}</span>
                <span className="block text-[10px] text-slate-400 capitalize">{p.branch}</span>
              </span>
              <div className="flex gap-1">
                {OPTIONS.map(op => (
                  <button key={op.v} title={op.full}
                    onClick={() => setMarks(m => ({ ...m, [p.id]: op.v }))}
                    className={`w-9 h-9 rounded-lg border-2 text-sm font-black transition ${
                      marks[p.id] === op.v ? op.on : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300'
                    }`}>
                    {op.l}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || loading || people.length === 0}
          className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Saving…' : 'Save attendance'}
        </button>
      </div>
    </Modal>
  )
}

// ── Pay a supplier, from the dashboard ───────────────────────────────────────
// The amount is already known (typed in the red box), so the only question is
// WHICH unpaid bill it settles. Sending the operator to the Payables page to
// re-type the same number was the wrong shape — this lists the open bills,
// they tap one, and the payment is recorded against it there and then.
export function SupplierPayModal({
  amount, onClose, onSaved, showToast,
}: {
  amount?: number
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const [invoices, setInvoices] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<any | null>(null)
  const [amt, setAmt] = useState<number | ''>(amount && amount > 0 ? Math.round(amount) : '')
  const [method, setMethod] = useState<'cash' | 'online' | 'cheque'>('cash')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [slip, setSlip] = useState<{ no: string; kind: string } | null>(null)

  useEffect(() => {
    // Every supplier's open bills in one list — one tap, no drill-down
    fetch('/api/vendor/suppliers')
      .then(r => r.json())
      .then(async j => {
        const owed = (j.suppliers || []).filter((s: any) => Number(s.total_owed || s.payables_due || 0) > 0)
        const lists = await Promise.all(owed.map((s: any) =>
          fetch(`/api/vendor/supplier-invoices?supplier_id=${s.id}`)
            .then(r => r.json())
            .then(k => (k.invoices || [])
              .filter((i: any) => i.status !== 'paid')
              .map((i: any) => ({ ...i, supplier_name: s.name, supplier_id: s.id,
                balance: Number(i.amount || 0) - Number(i.amount_paid || 0) })))
            .catch(() => [])
        ))
        const flat = lists.flat().filter((i: any) => i.balance > 0)
        // Oldest due first — that's the one to pay
        flat.sort((a: any, b: any) => String(a.due_date || '').localeCompare(String(b.due_date || '')))
        setInvoices(flat)
        if (flat.length === 1) setPicked(flat[0])
      })
      .catch(() => showToast('Could not load supplier bills'))
      .finally(() => setLoading(false))
  }, [showToast])

  const balance = picked ? Number(picked.balance) : 0
  const over = amt !== '' && balance > 0 && Number(amt) > balance

  async function save() {
    if (!picked) { showToast('Pick the bill you are paying'); return }
    if (amt === '' || Number(amt) <= 0) { showToast('Enter the amount'); return }
    if (over) { showToast(`That is more than the ${formatRs(balance)} outstanding on this bill`); return }
    if (method === 'cheque' && !reference.trim()) { showToast('Enter the cheque number'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/supplier-invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_payment',
          invoice_id: picked.id,
          supplier_id: picked.supplier_id,
          amount: Math.round(Number(amt)),
          payment_date: todayStr(),
          method,
          reference: reference.trim() || null,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to record payment')
      if (j.confirm_no) { setSlip({ no: j.confirm_no, kind: j.confirm_kind }); return }
      showToast(`✅ ${formatRs(Number(amt))} paid to ${picked.supplier_name}`)
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  if (slip) {
    return (
      <Modal title="Payment recorded" onClose={onSaved}>
        <p className="text-xs font-bold text-slate-500 uppercase text-center">
          {slip.kind === 'cheque' ? 'Write this on the cheque book slip' : 'Type this into the transfer remarks'}
        </p>
        <p className="text-4xl font-black tracking-[0.3em] text-slate-900 my-4 font-mono text-center">{slip.no}</p>
        <p className="text-xs text-slate-400 text-center mb-1">
          {formatRs(Number(amt))} to {picked?.supplier_name}
        </p>
        {/* The control differs by method: a cheque is authorised by the slip,
            a transfer by the number reaching the bank statement. */}
        <p className="text-[11px] font-bold text-red-600 text-center mb-4">
          {slip.kind === 'cheque'
            ? 'The owner signs ONLY cheques whose slip carries a confirmation number.'
            : 'Transfers without this number in the remarks are treated as unauthorised.'}
        </p>
        <button onClick={onSaved} className="w-full py-2.5 rounded-xl bg-slate-800 text-white text-sm font-black">Done</button>
      </Modal>
    )
  }

  return (
    <Modal title={amount ? `${formatRs(amount)} — which bill?` : 'Pay a supplier'} onClose={onClose}>
      {loading ? <Spinner /> : invoices.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">No unpaid supplier bills.</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">
            {invoices.map(inv => {
              const on = picked?.id === inv.id
              const overdue = inv.due_date && inv.due_date < todayStr()
              return (
                <button key={inv.id} onClick={() => setPicked(inv)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition ${
                    on ? 'border-orange-500 bg-orange-50' : 'border-slate-200 hover:border-slate-300'
                  }`}>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-bold text-slate-800 truncate">{inv.supplier_name}</span>
                    <span className="block text-[11px] text-slate-400 truncate">
                      {inv.invoice_no}
                      {inv.due_date && <span className={overdue ? 'text-red-600 font-bold' : ''}> · due {inv.due_date}{overdue ? ' — overdue' : ''}</span>}
                    </span>
                  </span>
                  <span className="text-sm font-black text-slate-800 shrink-0">{formatRs(inv.balance)}</span>
                </button>
              )
            })}
          </div>

          {picked && (
            <div className="border-t border-slate-100 pt-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 shrink-0">Paying</span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">Rs.</span>
                  <input type="number" min={1} value={amt}
                    onChange={e => setAmt(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
                    className={`w-full border-2 rounded-lg pl-11 pr-3 py-2 text-base font-black outline-none ${
                      over ? 'border-red-300 text-red-700' : 'border-slate-200 text-slate-800 focus:border-orange-400'
                    }`} />
                </div>
                <button onClick={() => setAmt(balance)}
                  className="text-[11px] font-bold text-orange-600 shrink-0 hover:underline">full {formatRs(balance)}</button>
              </div>
              {over && <p className="text-[11px] font-bold text-red-600">More than this bill&apos;s {formatRs(balance)} balance.</p>}

              <div className="grid grid-cols-3 gap-1.5">
                {([{ v: 'cash', l: '💵 Cash' }, { v: 'online', l: '🏦 Online' }, { v: 'cheque', l: '📝 Cheque' }] as const).map(m => (
                  <button key={m.v} onClick={() => setMethod(m.v)}
                    className={`py-2 rounded-lg border-2 text-xs font-bold transition ${
                      method === m.v ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500'
                    }`}>{m.l}</button>
                ))}
              </div>
              {method !== 'cash' && (
                <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                  placeholder={method === 'cheque' ? 'Cheque number *' : 'Bank reference (optional)'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400" />
              )}
              <p className="text-[11px] text-slate-400">
                {method === 'cash' ? 'Comes off today’s drawer.' : 'Does not touch the till — you’ll get an 8-digit confirmation number.'}
              </p>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || !picked || amt === '' || Number(amt) <= 0 || over}
          className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Recording…' : 'Record payment'}
        </button>
      </div>
    </Modal>
  )
}

// ── Collect from a credit customer, from the dashboard ───────────────────────
// Same shape as the supplier picker: the amount is known, so the only question
// is WHO paid. Applied oldest-invoice-first via bulk_settle.
export function CustomerCollectModal({
  amount, onClose, onSaved, showToast,
}: {
  amount?: number
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [picked, setPicked] = useState<any | null>(null)
  const [amt, setAmt] = useState<number | ''>(amount && amount > 0 ? Math.round(amount) : '')
  const [method, setMethod] = useState<'cash' | 'online' | 'cheque'>('cash')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/vendor/customers?credit=true')
      .then(r => r.json())
      .then(j => {
        const owing = (j.customers || [])
          // The credit view returns { credit: { balance } } per customer
          .map((c: any) => ({ ...c, owed: Number(c.credit?.balance ?? 0) }))
          .filter((c: any) => c.owed > 0)
          .sort((a: any, b: any) => b.owed - a.owed)
        setCustomers(owing)
        if (owing.length === 1) setPicked(owing[0])
      })
      .catch(() => showToast('Could not load credit customers'))
      .finally(() => setLoading(false))
  }, [showToast])

  const owed = picked ? Number(picked.owed) : 0

  async function save() {
    if (!picked) { showToast('Pick who is paying'); return }
    if (amt === '' || Number(amt) <= 0) { showToast('Enter the amount'); return }
    if (method === 'cheque' && !reference.trim()) { showToast('Enter the cheque number'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/vendor/customers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_settle',
          customerId: picked.id,
          payments: [{
            method,
            amount: Math.round(Number(amt)),
            chequeNumber: method === 'cheque' ? reference.trim() : null,
            bankRef: method === 'online' ? reference.trim() : null,
            notes: 'Collected at the counter',
          }],
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Failed to record collection')
      showToast(j.message || `✅ ${formatRs(Number(amt))} collected from ${picked.name}`)
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title={amount ? `${formatRs(amount)} — who is paying?` : 'Collect credit'} onClose={onClose}>
      {loading ? <Spinner /> : customers.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">Nobody owes you right now.</p>
      ) : (
        <>
          <div className="space-y-1.5 max-h-64 overflow-y-auto mb-3">
            {customers.map(c => (
              <button key={c.id} onClick={() => setPicked(c)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition ${
                  picked?.id === c.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold text-slate-800 truncate">{c.name}</span>
                  {c.phone && <span className="block text-[11px] text-slate-400">{c.phone}</span>}
                </span>
                <span className="text-sm font-black text-slate-800 shrink-0">{formatRs(c.owed)}</span>
              </button>
            ))}
          </div>

          {picked && (
            <div className="border-t border-slate-100 pt-3 space-y-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 shrink-0">Paying</span>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">Rs.</span>
                  <input type="number" min={1} value={amt}
                    onChange={e => setAmt(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
                    className="w-full border-2 border-slate-200 rounded-lg pl-11 pr-3 py-2 text-base font-black text-slate-800 outline-none focus:border-emerald-400" />
                </div>
                <button onClick={() => setAmt(owed)}
                  className="text-[11px] font-bold text-emerald-700 shrink-0 hover:underline">all {formatRs(owed)}</button>
              </div>
              {amt !== '' && Number(amt) > owed && (
                <p className="text-[11px] font-bold text-amber-700">
                  {formatRs(Number(amt) - owed)} more than owed — the excess is kept as an advance on their account.
                </p>
              )}

              <div className="grid grid-cols-3 gap-1.5">
                {([{ v: 'cash', l: '💵 Cash' }, { v: 'online', l: '🏦 Online' }, { v: 'cheque', l: '📝 Cheque' }] as const).map(m => (
                  <button key={m.v} onClick={() => setMethod(m.v)}
                    className={`py-2 rounded-lg border-2 text-xs font-bold transition ${
                      method === m.v ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'
                    }`}>{m.l}</button>
                ))}
              </div>
              {method !== 'cash' && (
                <input type="text" value={reference} onChange={e => setReference(e.target.value)}
                  placeholder={method === 'cheque' ? 'Cheque number *' : 'Bank reference (optional)'}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400" />
              )}
              <p className="text-[11px] text-slate-400">
                Applied to their oldest unpaid invoices first.
                {method === 'cash' ? ' Goes into today’s drawer.' : ' Does not touch the till.'}
              </p>
            </div>
          )}
        </>
      )}

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        <button onClick={save} disabled={saving || !picked || amt === '' || Number(amt) <= 0}
          className="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black disabled:opacity-40">
          {saving ? 'Recording…' : 'Record collection'}
        </button>
      </div>
    </Modal>
  )
}
