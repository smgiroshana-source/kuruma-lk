'use client'
import { colomboToday } from '@/lib/dates'
import { useState, useEffect } from 'react'

type Props = {
  vendor: any
  showToast: (msg: string) => void
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface CashSession {
  id: string
  vendor_id: string
  session_date: string
  opening_balance: number
  closing_balance: number | null
  expected_cash: number | null
  cash_expenses: number | null
  variance: number | null
  status: 'open' | 'closed'
  notes: string | null
  opened_by: string | null
  closed_by: string | null
  opened_at: string | null
  closed_at: string | null
  expense_count?: number
}

interface Expense {
  id: string
  expense_date: string
  category: string
  description: string
  amount: number
  payment_method: string
  reference: string | null
  cash_session_id: string | null
  created_at: string
  supplier_name?: string | null
  supplier_tin?: string | null
  supplier_invoice_no?: string | null
  supplier_invoice_date?: string | null
  input_vat?: number | null
}

type ExpenseCategory = string

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRs(n: number): string {
  return 'Rs. ' + Math.round(n).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

function todayStr(): string {
  return colomboToday()
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-LK', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
}

function formatTime(isoStr: string | null): string {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Colombo' })
}

// What the operator picks. Kept short and concrete — a shop assistant should
// find the right one without reading the whole list.
const CATEGORIES: { v: string; l: string; icon: string }[] = [
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

// Display names — the picker list plus every legacy value already in the table
// (and 'salaries', which Staff/HR writes; it is never chosen by hand).
const CATEGORY_LABELS: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map(c => [c.v, c.l])),
  repairs: 'Repair',
  salaries: 'Salaries & Wages',
  utilities: 'Utilities',
  fuel: 'Fuel',
  bank_charges: 'Bank Charges',
  tax: 'Tax',
  petty_cash: 'Petty Cash',
  consumables: 'Consumables',
  tools: 'Tools & Equipment',
  insurance: 'Insurance',
  advertising: 'Advertising',
}

const CATEGORY_COLORS: Record<string, string> = {
  grocery: 'bg-lime-100 text-lime-700',
  rent: 'bg-violet-100 text-violet-700',
  electricity: 'bg-amber-100 text-amber-700',
  water: 'bg-sky-100 text-sky-700',
  stationery: 'bg-cyan-100 text-cyan-700',
  internet: 'bg-blue-100 text-blue-700',
  transport: 'bg-orange-100 text-orange-700',
  repairs: 'bg-rose-100 text-rose-700',
  commission: 'bg-rose-100 text-rose-700',
  maintenance: 'bg-teal-100 text-teal-700',
  other: 'bg-gray-100 text-gray-600',
  salaries: 'bg-indigo-100 text-indigo-700',
  utilities: 'bg-blue-100 text-blue-700',
  fuel: 'bg-amber-100 text-amber-700',
  bank_charges: 'bg-slate-100 text-slate-700',
  tax: 'bg-red-100 text-red-700',
  petty_cash: 'bg-orange-100 text-orange-700',
  consumables: 'bg-lime-100 text-lime-700',
  tools: 'bg-fuchsia-100 text-fuchsia-700',
  insurance: 'bg-sky-100 text-sky-700',
  advertising: 'bg-pink-100 text-pink-700',
}

const MOVEMENT_LABEL: Record<string, string> = {
  owner_in: 'Owner put money in', bank_in: 'Drawn from bank',
  to_bank: 'Banked to account', owner_out: 'Given to owner',
}
const MOVEMENT_ICON: Record<string, string> = {
  owner_in: '👤→💵', bank_in: '🏦→💵', to_bank: '💵→🏦', owner_out: '💵→👤',
}

const METHOD_BADGE: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-700',
  online: 'bg-blue-100 text-blue-700',
  cheque: 'bg-purple-100 text-purple-700',
  bank: 'bg-blue-100 text-blue-700',
  card: 'bg-blue-100 text-blue-700',
}

// Legacy rows stored 'bank'/'card'; both were online bank movements
const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', online: 'Online', cheque: 'Cheque', bank: 'Online', card: 'Online',
}

// ── Blank form factories ──────────────────────────────────────────────────────

function blankExpenseForm() {
  return {
    expense_date: todayStr(),
    category: '' as ExpenseCategory,
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

// ── Main component ────────────────────────────────────────────────────────────

export default function TabCash({ vendor, showToast, initialView, onInitialViewConsumed }: Props & { initialView?: string | null; onInitialViewConsumed?: () => void }) {
  // Dashboard deep-links: 'expenses' opens the expenses view; 'add-expense'
  // additionally opens the Add Expense modal ready to type.
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'expenses'>(
    initialView === 'expenses' || initialView === 'add-expense' || initialView === 'advance' ? 'expenses' : 'reconciliation'
  )

  // ── Cash Reconciliation state ──────────────────────────────────────────────
  const [todaySession, setTodaySession] = useState<CashSession | null | undefined>(undefined) // undefined = loading
  const [loadingToday, setLoadingToday] = useState(false)
  const [recentSessions, setRecentSessions] = useState<CashSession[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)

  // Open session form
  const [openingBalance, setOpeningBalance] = useState<number | ''>(0)
  const [opening, setOpening] = useState(false)
  const [openingPrefilled, setOpeningPrefilled] = useState(false)

  // Close session form
  const [showCloseForm, setShowCloseForm] = useState(false)
  const [closingBalance, setClosingBalance] = useState<number | ''>('')
  const [closeNotes, setCloseNotes] = useState('')
  const [closing, setClosing] = useState(false)

  // Today's cash expenses (shown in session card)
  const [todayExpenses, setTodayExpenses] = useState<Expense[]>([])
  const [loadingTodayExp, setLoadingTodayExp] = useState(false)
  const [showAddExpenseInline, setShowAddExpenseInline] = useState(false)
  const [inlineExpForm, setInlineExpForm] = useState(blankExpenseForm())
  const [savingInlineExp, setSavingInlineExp] = useState(false)

  // ── Expenses tab state ─────────────────────────────────────────────────────
  const [expMonth, setExpMonth] = useState<string>(todayStr().slice(0, 7)) // YYYY-MM
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loadingExp, setLoadingExp] = useState(false)
  const [showAddExpModal, setShowAddExpModal] = useState(false)
  const [expForm, setExpForm] = useState(blankExpenseForm())
  // Attaching a tax invoice to an expense already recorded (the bill usually
  // arrives after the money went out)
  const [vatFor, setVatFor] = useState<Expense | null>(null)
  // Money handed to a staff member out of the till. Recorded against the
  // person in Staff (so payroll can net it off), and posted as an expense so
  // the drawer still reconciles at close.
  const [showAdvance, setShowAdvance] = useState(false)
  // Money moved, not earned: owner top-up, bank withdrawal, banking the
  // takings, owner drawings. Changes the drawer count, never profit.
  const [showMovement, setShowMovement] = useState(false)
  // Quick service income: a puncture or air-fill paid into the till with no
  // document. Real INCOME of the Proprietorship — it becomes an RCP receipt
  // (revenue, drawer, reports), just without the POS ceremony.
  const [showQuickIncome, setShowQuickIncome] = useState(false)
  const [movementPreset, setMovementPreset] = useState<{ dir: 'in' | 'out'; type: string }>({ dir: 'in', type: 'owner_in' })
  const [dayMovements, setDayMovements] = useState<any[]>([])
  const [monthMovements, setMonthMovements] = useState<any[]>([])
  async function fetchDayMovements() {
    try {
      const r = await fetch('/api/vendor/cash-movements?date=' + todayStr())
      if (r.ok) { const j = await r.json(); setDayMovements(j.movements || []) }
    } catch {}
  }
  async function fetchMonthMovements(month: string) {
    try {
      const r = await fetch('/api/vendor/cash-movements?month=' + month)
      if (r.ok) { const j = await r.json(); setMonthMovements(j.movements || []) }
    } catch {}
  }
  async function deleteMovement(m: any) {
    const label = MOVEMENT_LABEL[m.type] || m.type
    if (!confirm(`Delete "${label} — ${formatRs(m.amount)}" on ${m.movement_date}? The drawer count for that day will be recomputed.`)) return
    try {
      const r = await fetch('/api/vendor/cash-movements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: m.id }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Failed')
      showToast('Movement removed — drawer recomputed')
      await Promise.all([fetchDayMovements(), fetchMonthMovements(expMonth), fetchTodaySession(), fetchRecentSessions()])
    } catch (e: any) { showToast('⚠️ ' + e.message) }
  }
  const [savingExp, setSavingExp] = useState(false)

  // Opening ≠ previous day's closing (reported, fixed only on confirmation)
  const [carryMismatch, setCarryMismatch] = useState<any>(null)

  // A PAST day opened for correction (same tools as today's card)
  const [pastSession, setPastSession] = useState<CashSession | null>(null)
  const [pastCarry, setPastCarry] = useState<any>(null)
  const [pastCorrections, setPastCorrections] = useState<any[]>([])

  async function openPastSession(date: string) {
    try {
      const res = await fetch(`/api/vendor/cash-sessions?date=${date}`)
      if (!res.ok) throw new Error('Could not load that day')
      const d = await res.json()
      setPastSession(d.session ?? null)
      setPastCarry(d.carry_forward_mismatch ?? null)
      setPastCorrections(d.corrections ?? [])
    } catch (e: any) { showToast(e.message) }
  }

  // Post-close variance correction: {session, kind: 'in'|'out'|'opening'|'accept'}
  const [fixCash, setFixCash] = useState<any>(null)
  const [fixAmount, setFixAmount] = useState('')
  const [fixNote, setFixNote] = useState('')
  const [fixSaving, setFixSaving] = useState(false)

  async function submitFix() {
    if (!fixCash) return
    const { session, kind } = fixCash
    const body: any = { sessionId: session.id }
    if (kind === 'accept') {
      if (!fixNote.trim()) { showToast('Give a reason so the record makes sense later'); return }
      body.action = 'accept_variance'; body.reason = fixNote.trim()
    } else if (kind === 'opening') {
      const amt = Math.round(Number(fixAmount))
      if (!Number.isFinite(amt) || amt < 0) { showToast('Enter the correct opening balance'); return }
      body.action = 'set_opening'; body.opening_balance = amt
    } else {
      const amt = Math.round(Number(fixAmount))
      if (!Number.isFinite(amt) || amt <= 0) { showToast('Enter an amount'); return }
      body.action = 'adjust'; body.kind = kind; body.amount = amt; body.note = fixNote.trim()
    }
    setFixSaving(true)
    try {
      const res = await fetch('/api/vendor/cash-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed')
      showToast(d.variance === 0 ? '✓ Balanced — variance cleared' : `Updated — variance now ${formatRs(Math.abs(d.variance || 0))}`)
      const fixedDate = session.session_date
      setFixCash(null); setFixAmount(''); setFixNote('')
      await fetchTodaySession(); await fetchRecentSessions()
      if (pastSession && pastSession.session_date === fixedDate) await openPastSession(fixedDate)
    } catch (e: any) { showToast(e.message) }
    setFixSaving(false)
  }

  // Late-close for a past day's still-open session
  const [lateClose, setLateClose] = useState<CashSession | null>(null)
  const [lateCount, setLateCount] = useState('')
  const [lateNotes, setLateNotes] = useState('')
  const [lateSaving, setLateSaving] = useState(false)

  async function handleLateClose() {
    if (!lateClose) return
    const amt = Math.round(Number(lateCount))
    if (!Number.isFinite(amt) || amt < 0) { showToast('Enter the counted cash (0 is allowed)'); return }
    setLateSaving(true)
    try {
      const res = await fetch('/api/vendor/cash-sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', sessionId: lateClose.id, closing_balance: amt, notes: `LATE CLOSE (${todayStr()})${lateNotes.trim() ? ' — ' + lateNotes.trim() : ''}` }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to close session')
      showToast(`✓ ${lateClose.session_date} closed`)
      setLateClose(null)
      await fetchTodaySession(); await fetchRecentSessions()
    } catch (e: any) { showToast(e.message) }
    setLateSaving(false)
  }

  // Honour the dashboard deep-link once: land with the Add Expense modal open
  useEffect(() => {
    if (initialView === 'add-expense') { setExpForm(blankExpenseForm()); setShowAddExpModal(true) }
    if (initialView === 'advance') setShowAdvance(true)
    if (initialView === 'movement') setShowMovement(true)
    if (initialView === 'movement-in') { setMovementPreset({ dir: 'in', type: 'owner_in' }); setShowMovement(true) }
    if (initialView === 'movement-in-bank') { setMovementPreset({ dir: 'in', type: 'bank_in' }); setShowMovement(true) }
    if (initialView === 'movement-out') { setMovementPreset({ dir: 'out', type: 'to_bank' }); setShowMovement(true) }
    if (initialView === 'income') setShowQuickIncome(true)
    if (initialView && onInitialViewConsumed) onInitialViewConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── On mount ───────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchTodaySession()
    fetchRecentSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (activeTab === 'expenses') {
      fetchExpenses()
      fetchMonthMovements(expMonth)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, expMonth])

  // Most recent CLOSED session — its counted closing balance is the cash left in
  // the drawer overnight, i.e. the natural opening float for the next day.
  const lastClosed = [...recentSessions]
    .filter(s => s.status === 'closed' && s.closing_balance != null)
    .sort((a, b) => (a.session_date < b.session_date ? 1 : -1))[0] || null

  // Prefill the opening-balance field with the carried-over float once, when
  // there's no session yet today. Operator can still edit it (e.g. banked cash).
  useEffect(() => {
    // Only prefill an untouched field (still at the initial 0) — if the operator
    // already typed a value before the sessions fetch returned, keep theirs.
    if (!openingPrefilled && todaySession === null && lastClosed && (openingBalance === 0 || openingBalance === '')) {
      setOpeningBalance(Math.round(lastClosed.closing_balance as number))
      setOpeningPrefilled(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todaySession, recentSessions])

  // ── Fetch helpers ──────────────────────────────────────────────────────────

  async function fetchTodaySession() {
    setLoadingToday(true)
    try {
      const res = await fetch(`/api/vendor/cash-sessions?date=${todayStr()}`)
      if (!res.ok) throw new Error('Failed to load today\'s session')
      const data = await res.json()
      setTodaySession(data.session ?? null)
      setCarryMismatch(data.carry_forward_mismatch ?? null)
      if (data.session) {
        fetchTodayExpenses()
        fetchDayMovements()
      } else {
        setTodayExpenses([])
      }
    } catch (e: any) {
      showToast(e.message ?? 'Error loading session')
      setTodaySession(null)
    } finally {
      setLoadingToday(false)
    }
  }

  async function fetchRecentSessions() {
    setLoadingRecent(true)
    try {
      const res = await fetch('/api/vendor/cash-sessions')
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = await res.json()
      setRecentSessions((data.sessions ?? []).slice(0, 14))
    } catch (e: any) {
      showToast(e.message ?? 'Error loading sessions')
    } finally {
      setLoadingRecent(false)
    }
  }

  async function fetchTodayExpenses() {
    setLoadingTodayExp(true)
    try {
      const res = await fetch(`/api/vendor/expenses?date=${todayStr()}`)
      if (!res.ok) throw new Error('Failed to load expenses')
      const data = await res.json()
      setTodayExpenses(data.expenses ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading expenses')
    } finally {
      setLoadingTodayExp(false)
    }
  }

  async function fetchExpenses() {
    setLoadingExp(true)
    try {
      const res = await fetch(`/api/vendor/expenses?month=${expMonth}`)
      if (!res.ok) throw new Error('Failed to load expenses')
      const data = await res.json()
      setExpenses(data.expenses ?? [])
    } catch (e: any) {
      showToast(e.message ?? 'Error loading expenses')
    } finally {
      setLoadingExp(false)
    }
  }

  // ── Session actions ────────────────────────────────────────────────────────

  async function handleOpenSession() {
    setOpening(true)
    try {
      const res = await fetch('/api/vendor/cash-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'open',
          session_date: todayStr(),
          opening_balance: Math.round(Number(openingBalance) || 0),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to open session')
      }
      showToast('Cash session opened')
      setOpeningBalance(0)
      await fetchTodaySession()
      await fetchRecentSessions()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setOpening(false)
    }
  }

  async function handleCloseSession() {
    if (!todaySession) return
    if (closingBalance === '') {
      showToast('Enter the counted cash amount')
      return
    }
    setClosing(true)
    try {
      const res = await fetch('/api/vendor/cash-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close',
          sessionId: todaySession.id,
          closing_balance: Math.round(Number(closingBalance)),
          notes: closeNotes.trim() || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to close session')
      }
      showToast('Session closed')
      setShowCloseForm(false)
      setClosingBalance('')
      setCloseNotes('')
      await fetchTodaySession()
      await fetchRecentSessions()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setClosing(false)
    }
  }

  async function handleReopenSession(target?: CashSession | null) {
    const sess = target || todaySession
    if (!sess) return
    if (!confirm('Re-open this session? The closing data will be cleared.')) return
    try {
      const res = await fetch('/api/vendor/cash-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen', sessionId: sess.id }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to reopen session')
      }
      showToast('Session reopened')
      await fetchTodaySession()
      await fetchRecentSessions()
      if (pastSession && pastSession.id === sess.id) await openPastSession(sess.session_date)
    } catch (e: any) {
      showToast(e.message)
    }
  }

  // ── Expense actions ────────────────────────────────────────────────────────

  async function handleAddInlineExpense() {
    if (!inlineExpForm.category) {
      showToast('Pick what the expense was for')
      return
    }
    if (inlineExpForm.amount === '' || Number(inlineExpForm.amount) <= 0) {
      showToast('Enter a valid amount')
      return
    }
    if (inlineExpForm.payment_method !== 'cash' && !inlineExpForm.reference.trim()) {
      showToast(inlineExpForm.payment_method === 'cheque' ? 'Enter the cheque number' : 'Enter the 8-digit bank confirmation number')
      return
    }
    setSavingInlineExp(true)
    try {
      const res = await fetch('/api/vendor/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          expense_date: todayStr(),
          category: inlineExpForm.category,
          description: inlineExpForm.description.trim() || CATEGORY_LABELS[inlineExpForm.category] || 'Expense',
          amount: Math.round(Number(inlineExpForm.amount)),
          payment_method: inlineExpForm.payment_method,
          reference: inlineExpForm.reference.trim() || null,
          cash_session_id: todaySession?.id ?? null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to add expense')
      }
      showToast('Expense added')
      setShowAddExpenseInline(false)
      setInlineExpForm(blankExpenseForm())
      await fetchTodayExpenses()
      await fetchTodaySession()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSavingInlineExp(false)
    }
  }

  async function handleDeleteExpense(expId: string, locked: boolean) {
    if (locked) {
      showToast('Cannot delete — expense is locked in a closed session')
      return
    }
    if (!confirm('Delete this expense?')) return
    try {
      const res = await fetch('/api/vendor/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', expenseId: expId }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to delete expense')
      }
      showToast('Expense deleted')
      await fetchTodayExpenses()
      await fetchTodaySession()
      if (activeTab === 'expenses') await fetchExpenses()
    } catch (e: any) {
      showToast(e.message)
    }
  }

  async function handleAddExpense() {
    if (!expForm.category) {
      showToast('Pick what the expense was for')
      return
    }
    if (expForm.amount === '' || Number(expForm.amount) <= 0) {
      showToast('Enter a valid amount')
      return
    }
    if (expForm.payment_method !== 'cash' && !expForm.reference.trim()) {
      showToast(expForm.payment_method === 'cheque' ? 'Enter the cheque number' : 'Enter the 8-digit bank confirmation number')
      return
    }
    if (expForm.claim_vat) {
      if (!/^\d{9}$/.test(expForm.supplier_tin.trim())) { showToast('Enter the shop\'s 9-digit VAT / TIN number'); return }
      if (!expForm.supplier_invoice_no.trim()) { showToast('Enter the bill number'); return }
      if (Number(expForm.input_vat) <= 0) { showToast('Enter the VAT shown on the bill'); return }
    }
    setSavingExp(true)
    try {
      const res = await fetch('/api/vendor/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          expense_date: expForm.expense_date,
          category: expForm.category,
          // The note is optional — the category name says enough on its own
          description: expForm.description.trim() || CATEGORY_LABELS[expForm.category] || 'Expense',
          amount: Math.round(Number(expForm.amount)),
          payment_method: expForm.payment_method,
          reference: expForm.reference.trim() || null,
          supplier_name:         expForm.claim_vat ? expForm.supplier_name.trim() : null,
          supplier_tin:          expForm.claim_vat ? expForm.supplier_tin.trim() : null,
          supplier_invoice_no:   expForm.claim_vat ? expForm.supplier_invoice_no.trim() : null,
          supplier_invoice_date: expForm.claim_vat ? (expForm.supplier_invoice_date || expForm.expense_date) : null,
          input_vat:             expForm.claim_vat ? Math.round(Number(expForm.input_vat) || 0) : 0,
          // A cash expense dated today belongs in the open till session so the
          // expected-cash count reconciles; non-cash / back-dated stay unlinked.
          cash_session_id:
            expForm.payment_method === 'cash' && expForm.expense_date === todayStr() && todaySession?.status === 'open'
              ? todaySession.id
              : null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to add expense')
      }
      // A cash expense added late for an ALREADY-CLOSED day changes what the
      // drawer should have held — recheck that session so the variance updates
      // instead of standing as a phantom shortage.
      if (expForm.payment_method === 'cash') {
        const target = [todaySession, ...recentSessions].find(
          s => s && s.session_date === expForm.expense_date && s.status === 'closed'
        )
        if (target) {
          await fetch('/api/vendor/cash-sessions', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'recompute', sessionId: target.id }),
          }).catch(() => {})
        }
      }
      showToast('Expense added')
      setShowAddExpModal(false)
      setExpForm(blankExpenseForm())
      await fetchExpenses()
      await fetchTodayExpenses()
      await fetchTodaySession()
      await fetchRecentSessions()
    } catch (e: any) {
      showToast(e.message)
    } finally {
      setSavingExp(false)
    }
  }

  // ── Month navigation ───────────────────────────────────────────────────────

  function prevMonth() {
    const [y, m] = expMonth.split('-').map(Number)
    const d = new Date(y, m - 2, 1)
    setExpMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  function nextMonth() {
    const [y, m] = expMonth.split('-').map(Number)
    const d = new Date(y, m, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (next <= todayStr().slice(0, 7)) setExpMonth(next)
  }

  function monthLabel(ym: string): string {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('en-LK', { month: 'long', year: 'numeric' })
  }

  // ── Category totals for month ──────────────────────────────────────────────

  function categoryTotals(list: Expense[]): { category: string; total: number }[] {
    const map: Record<string, number> = {}
    for (const e of list) {
      map[e.category] = (map[e.category] ?? 0) + e.amount
    }
    return Object.entries(map)
      .filter(([, v]) => v > 0)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
  }

  // ── Variance display ───────────────────────────────────────────────────────

  function varianceBadge(variance: number | null) {
    if (variance === null) return <span className="text-slate-300">—</span>
    if (variance === 0) return (
      <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
        Balanced
      </span>
    )
    if (variance > 0) return (
      <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
        +{formatRs(variance)} Over
      </span>
    )
    return (
      <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
        {formatRs(Math.abs(variance))} Short
      </span>
    )
  }

  // ── Cash expenses total ────────────────────────────────────────────────────

  const todayCashExpTotal = todayExpenses
    .filter(e => e.payment_method === 'cash')
    .reduce((sum, e) => sum + e.amount, 0)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Sub-tab bar */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab('reconciliation')}
          className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
            activeTab === 'reconciliation'
              ? 'bg-orange-500 border-orange-500 text-white'
              : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
          }`}
        >
          Cash Reconciliation
        </button>
        <button
          onClick={() => setActiveTab('expenses')}
          className={`px-4 py-2 rounded-full text-sm font-bold transition-colors border ${
            activeTab === 'expenses'
              ? 'bg-orange-500 border-orange-500 text-white'
              : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
          }`}
        >
          Expenses
        </button>
      </div>

      {/* ── Cash Reconciliation tab ────────────────────────────────────────── */}
      {activeTab === 'reconciliation' && (
        <div>
          <h1 className="text-2xl font-black text-slate-900 mb-5">Cash Reconciliation</h1>

          {/* Today's session card */}
          {loadingToday ? (
            <Spinner />
          ) : todaySession === undefined ? null : todaySession === null ? (
            /* State A — No session */
            <div className="bg-white rounded-xl border-2 border-dashed border-slate-200 p-10 text-center mb-6">
              <p className="text-slate-500 font-bold text-base mb-1">No session open for today</p>
              <p className="text-slate-400 text-xs mb-5">{formatDate(todayStr())}</p>
              <div className="flex flex-col items-center gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-sm font-semibold text-slate-600 whitespace-nowrap">Opening Balance (Rs.)</label>
                  <input
                    type="number"
                    min={0}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm w-36 focus:outline-none focus:ring-2 focus:ring-orange-400 text-right"
                    placeholder="0"
                    value={openingBalance}
                    onChange={e => setOpeningBalance(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
                  />
                </div>
                {lastClosed && (
                  <p className="text-[11px] text-slate-400">
                    Carried over from {formatDate(lastClosed.session_date)} closing:{' '}
                    <button
                      type="button"
                      onClick={() => setOpeningBalance(Math.round(lastClosed.closing_balance as number))}
                      className="font-bold text-orange-500 hover:text-orange-600 underline decoration-dotted"
                    >
                      {formatRs(lastClosed.closing_balance as number)}
                    </button>
                    {' '}— edit if you banked cash overnight.
                  </p>
                )}
                <button
                  onClick={handleOpenSession}
                  disabled={opening}
                  className="px-5 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
                >
                  {opening ? 'Opening…' : 'Open Session'}
                </button>
              </div>
            </div>
          ) : todaySession.status === 'open' ? (
            /* State B — Session open */
            <div className="bg-white rounded-xl border-l-4 border-l-emerald-500 border border-slate-200 mb-6 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📂</span>
                  <span className="font-black text-slate-800 text-base">Session Open — {formatDate(todaySession.session_date)}</span>
                </div>
                {!showCloseForm && (
                  <button
                    onClick={() => setShowCloseForm(true)}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold transition-colors"
                  >
                    Close Session
                  </button>
                )}
              </div>

              {/* Info chips */}
              <div className="flex flex-wrap gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
                <div className="text-xs text-slate-500 font-semibold">
                  Opening: <span className="text-slate-800 font-bold">{formatRs(todaySession.opening_balance)}</span>
                </div>
                <div className="text-xs">
                  <span className="inline-block px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-bold text-[11px]">OPEN</span>
                </div>
                <div className="text-xs text-slate-500 font-semibold">
                  Opened: <span className="text-slate-700">{formatTime(todaySession.opened_at)}</span>
                </div>
              </div>

              {/* Expenses section */}
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Cash Expenses Today</p>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => { setMovementPreset({ dir: 'in', type: 'owner_in' }); setShowMovement(true) }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-xs font-bold transition-colors"
                    >
                      ⬆ Money In
                    </button>
                    <button
                      onClick={() => { setMovementPreset({ dir: 'out', type: 'to_bank' }); setShowMovement(true) }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-xs font-bold transition-colors"
                    >
                      ⬇ Money Out
                    </button>
                    <button
                      onClick={() => setShowAdvance(true)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-bold transition-colors"
                    >
                      🧑‍🔧 Salary Advance
                    </button>
                    <button
                      onClick={() => { setShowAddExpenseInline(true); setInlineExpForm(blankExpenseForm()) }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors"
                    >
                      <span>+</span> Add Expense
                    </button>
                  </div>
                </div>

                {/* Inline add expense form */}
                {showAddExpenseInline && (
                  <div className="mb-3 p-3 bg-orange-50 rounded-xl border border-orange-200">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Category</label>
                        <select
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                          value={inlineExpForm.category}
                          onChange={e => setInlineExpForm(p => ({ ...p, category: e.target.value as ExpenseCategory }))}
                        >
                          <option value="">Choose…</option>
                          {CATEGORIES.map(c => (
                            <option key={c.v} value={c.v}>{c.icon} {c.l}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Amount (Rs.) *</label>
                        <input
                          type="number"
                          min={1}
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                          placeholder="0"
                          value={inlineExpForm.amount}
                          onChange={e => setInlineExpForm(p => ({ ...p, amount: e.target.value === '' ? '' : Math.round(Number(e.target.value)) }))}
                        />
                      </div>
                    </div>
                    <div className="mb-2">
                      <label className="block text-[11px] font-bold text-slate-500 mb-1">Description *</label>
                      <input
                        type="text"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                        placeholder="What was the expense for?"
                        value={inlineExpForm.description}
                        onChange={e => setInlineExpForm(p => ({ ...p, description: e.target.value }))}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Method</label>
                        <select
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                          value={inlineExpForm.payment_method}
                          onChange={e => setInlineExpForm(p => ({ ...p, payment_method: e.target.value }))}
                        >
                          <option value="cash">Cash</option>
                          <option value="online">Online</option>
                          <option value="cheque">Cheque</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-500 mb-1">Reference</label>
                        <input
                          type="text"
                          className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                          placeholder="Cheque no., ref…"
                          value={inlineExpForm.reference}
                          onChange={e => setInlineExpForm(p => ({ ...p, reference: e.target.value }))}
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => setShowAddExpenseInline(false)}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleAddInlineExpense}
                        disabled={savingInlineExp}
                        className="px-4 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        {savingInlineExp ? 'Adding…' : 'Add'}
                      </button>
                    </div>
                  </div>
                )}

                {loadingTodayExp ? (
                  <div className="flex justify-center py-4">
                    <div className="w-6 h-6 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
                  </div>
                ) : todayExpenses.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">No expenses recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className="pb-1.5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wide">Category</th>
                          <th className="pb-1.5 text-left text-[11px] font-bold text-slate-400 uppercase tracking-wide">Description</th>
                          <th className="pb-1.5 text-right text-[11px] font-bold text-slate-400 uppercase tracking-wide">Amount</th>
                          <th className="pb-1.5 text-center text-[11px] font-bold text-slate-400 uppercase tracking-wide">Method</th>
                          <th className="pb-1.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayExpenses.map(e => (
                          <tr key={e.id} className="border-t border-slate-50 hover:bg-slate-50 transition-colors">
                            <td className="py-1.5 pr-2">
                              <span className={`inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-full ${CATEGORY_COLORS[e.category] ?? 'bg-gray-100 text-gray-600'}`}>
                                {CATEGORY_LABELS[e.category] ?? e.category}
                              </span>
                            </td>
                            <td className="py-1.5 pr-2 text-slate-600">{e.description}</td>
                            <td className="py-1.5 pr-2 text-right font-bold text-slate-800">{formatRs(e.amount)}</td>
                            <td className="py-1.5 pr-2 text-center">
                              <span className={`inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-full ${METHOD_BADGE[e.payment_method] ?? 'bg-gray-100 text-gray-600'}`}>
                                {METHOD_LABEL[e.payment_method] ?? e.payment_method}
                              </span>
                            </td>
                            <td className="py-1.5 text-right">
                              <button
                                onClick={() => handleDeleteExpense(e.id, false)}
                                className="text-red-400 hover:text-red-600 font-bold transition-colors leading-none text-sm"
                                title="Delete expense"
                              >
                                ×
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {todayCashExpTotal > 0 && (
                      <div className="flex justify-end pt-2 border-t border-slate-100 mt-1">
                        <p className="text-xs text-slate-500 font-semibold">
                          Cash expenses total: <span className="text-slate-800 font-black">{formatRs(todayCashExpTotal)}</span>
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {/* ── Money moved today — the drawer follows these, profit never sees them ── */}
                {dayMovements.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-sky-100">
                    <p className="text-[11px] font-bold text-sky-700 uppercase tracking-wide mb-1.5">🔁 Money moved today (not sales, not expenses)</p>
                    {dayMovements.map(m => {
                      const isIn = m.type === 'owner_in' || m.type === 'bank_in'
                      return (
                        <div key={m.id} className="flex items-center gap-2 text-xs py-1">
                          <span className="font-mono text-[10px] text-slate-400 shrink-0">{MOVEMENT_ICON[m.type]}</span>
                          <span className="flex-1 text-slate-600 truncate">{MOVEMENT_LABEL[m.type]}{m.note ? <span className="text-slate-400"> — {m.note}</span> : null}</span>
                          <span className={`font-bold ${isIn ? 'text-emerald-600' : 'text-amber-700'}`}>{isIn ? '+' : '−'}{formatRs(m.amount)}</span>
                          <button onClick={() => deleteMovement(m)} className="text-red-300 hover:text-red-500 font-bold text-sm leading-none" title="Delete (owner/manager)">×</button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Close Session form (inline expand) */}
              {showCloseForm && (
                <div className="px-5 py-4 bg-slate-50 border-t border-slate-100">
                  <p className="text-sm font-bold text-slate-700 mb-3">Count physical cash and enter amount:</p>
                  <div className="flex flex-col gap-3 max-w-sm">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Closing Balance (Rs.) *</label>
                      <input
                        type="number"
                        min={0}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                        placeholder="Enter counted cash"
                        value={closingBalance}
                        onChange={e => setClosingBalance(e.target.value === '' ? '' : Math.round(Number(e.target.value)))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1">Notes (optional)</label>
                      <textarea
                        rows={2}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                        placeholder="Any notes about the closing…"
                        value={closeNotes}
                        onChange={e => setCloseNotes(e.target.value)}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={handleCloseSession}
                        disabled={closing}
                        className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-colors disabled:opacity-50"
                      >
                        {closing ? 'Closing…' : 'Confirm Close'}
                      </button>
                      <button
                        onClick={() => { setShowCloseForm(false); setClosingBalance(''); setCloseNotes('') }}
                        className="text-sm text-slate-500 hover:text-slate-700 font-semibold transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* State C — Session closed */
            <div className="bg-white rounded-xl border-l-4 border-l-slate-400 border border-slate-200 mb-6 overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔒</span>
                  <span className="font-black text-slate-800 text-base">Session Closed — {formatDate(todaySession.session_date)}</span>
                </div>
                <button
                  onClick={() => handleReopenSession()}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Re-open
                </button>
              </div>

              {/* Summary grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 px-5 py-4">
                <SummaryCell label="Opening Balance" value={formatRs(todaySession.opening_balance)} />
                <SummaryCell label="Expected Cash" value={todaySession.expected_cash != null ? formatRs(todaySession.expected_cash) : '—'} />
                <SummaryCell label="Cash Expenses" value={todaySession.cash_expenses != null ? formatRs(todaySession.cash_expenses) : formatRs(0)} />
                <SummaryCell label="Counted Cash" value={todaySession.closing_balance != null ? formatRs(todaySession.closing_balance) : '—'} />
                <div>
                  <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">Variance</p>
                  {varianceBadge(todaySession.variance)}
                </div>
                <SummaryCell
                  label="Closed At"
                  value={todaySession.closed_at ? formatTime(todaySession.closed_at) : '—'}
                />
              </div>

              {todaySession.notes && (
                <div className="px-5 pb-4">
                  <p className="text-xs text-slate-500 italic">&ldquo;{todaySession.notes}&rdquo;</p>
                </div>
              )}

              {/* Yesterday's counted cash IS today's opening float. Shown, not
                  auto-applied: money figures shouldn't move on their own. */}
              {carryMismatch && (
                <div className="mx-5 mb-4 rounded-xl border-2 border-sky-300 bg-sky-50 p-3.5">
                  <p className="text-xs font-black text-sky-900">
                    Opening balance doesn&apos;t match {formatDate(carryMismatch.prev_date)}&apos;s counted cash
                    ({formatRs(carryMismatch.prev_closing)} vs {formatRs(carryMismatch.opening)} — {formatRs(Math.abs(carryMismatch.difference))} difference)
                  </p>
                  <p className="text-[11px] text-sky-700 mt-1">Cash left in the drawer overnight carries into today. If nothing was removed after the count, match it.</p>
                  <button onClick={() => { setFixCash({ session: todaySession, kind: 'opening' }); setFixAmount(String(carryMismatch.prev_closing)); setFixNote(`Matched to ${carryMismatch.prev_date} closing`) }}
                    className="mt-2 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold">
                    Set opening to {formatRs(carryMismatch.prev_closing)}
                  </button>
                </div>
              )}

              {/* Variance is almost always a forgotten entry, not missing money —
                  offer the three real explanations before accepting a loss */}
              {todaySession.variance != null && todaySession.variance !== 0 && !(todaySession as any).variance_accepted && (
                <div className="mx-5 mb-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5">
                  <p className="text-xs font-black text-amber-800 mb-2">
                    {todaySession.variance > 0 ? `Rs.${Math.abs(todaySession.variance).toLocaleString()} more in the drawer than expected` : `Rs.${Math.abs(todaySession.variance).toLocaleString()} less in the drawer than expected`}
                    {' '}— was something not entered?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {todaySession.variance < 0 && (
                      <button onClick={() => { setExpForm({ ...blankExpenseForm(), expense_date: todaySession.session_date }); setShowAddExpModal(true) }}
                        className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">
                        🧾 Money paid out — add the missed expense
                      </button>
                    )}
                    {todaySession.variance > 0 && (
                      <button onClick={() => setFixCash({ session: todaySession, kind: 'in' })}
                        className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">
                        💵 Cash received but not recorded
                      </button>
                    )}
                    {todaySession.variance < 0 && (
                      <button onClick={() => setFixCash({ session: todaySession, kind: 'out' })}
                        className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">
                        💸 Cash taken out (not an expense)
                      </button>
                    )}
                    <button onClick={() => setFixCash({ session: todaySession, kind: 'opening' })}
                      className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">
                      ↩ Fix opening balance
                    </button>
                    <button onClick={() => setFixCash({ session: todaySession, kind: 'accept' })}
                      className="px-3 py-2 rounded-lg bg-white border-2 border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">
                      ✓ It really is short/over
                    </button>
                  </div>
                  {((todaySession as any).adjustment_note) && (
                    <p className="text-[11px] text-amber-700 mt-2">Corrections: {(todaySession as any).adjustment_note}</p>
                  )}
                </div>
              )}
              {(todaySession as any)?.variance_accepted && (
                <div className="mx-5 mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-bold text-slate-600">Variance accepted: {(todaySession as any).variance_reason}</p>
                </div>
              )}
            </div>
          )}

          {/* Recent Sessions */}
          <div>
            <h2 className="text-base font-black text-slate-800 mb-3">Recent Sessions</h2>
            {loadingRecent ? (
              <Spinner />
            ) : recentSessions.length === 0 ? (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
                <p className="text-slate-400 text-sm font-semibold">No sessions yet.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Date</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Opening</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Expected</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Counted</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Variance</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Expenses</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentSessions.map(s => (
                        <tr key={s.id}
                          onClick={() => { if (s.status === 'closed' && s.session_date !== todayStr()) openPastSession(s.session_date) }}
                          className={'border-t border-slate-100 transition-colors ' + (s.status === 'closed' && s.session_date !== todayStr() ? 'hover:bg-orange-50 cursor-pointer' : 'hover:bg-slate-50')}>
                          <td className="px-4 py-3">
                            <p className="text-sm font-semibold text-slate-700">{formatDate(s.session_date)}</p>
                            {s.status === 'closed' && s.session_date !== todayStr() && (s.variance ?? 0) !== 0 && !(s as any).variance_accepted &&
                              <p className="text-[10px] font-bold text-orange-500 mt-0.5">tap to correct →</p>}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-slate-600">{formatRs(s.opening_balance)}</td>
                          <td className="px-4 py-3 text-right text-sm text-slate-600">
                            {s.expected_cash != null ? formatRs(s.expected_cash) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right text-sm text-slate-600">
                            {s.closing_balance != null ? formatRs(s.closing_balance) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">{varianceBadge(s.variance)}</td>
                          <td className="px-4 py-3 text-center">
                            {(s.expense_count ?? 0) > 0 ? (
                              <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                                {s.expense_count} expense{(s.expense_count ?? 0) !== 1 ? 's' : ''}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.status === 'open' ? (
                              s.session_date !== todayStr() ? (
                                // A drawer left open on a PAST day — variance is unknown
                                // until someone counts and closes it late
                                <button onClick={() => { setLateClose(s); setLateCount(''); setLateNotes('') }}
                                  className="inline-block text-[11px] font-black px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-300 hover:bg-red-200 animate-pulse">
                                  ⚠ STILL OPEN — Close now
                                </button>
                              ) : (
                                <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">OPEN</span>
                              )
                            ) : (
                              <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">CLOSED</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Expenses tab ────────────────────────────────────────────────────── */}
      {activeTab === 'expenses' && (
        <div>
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-2xl font-black text-slate-900">Expenses</h1>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setMovementPreset({ dir: 'in', type: 'owner_in' }); setShowMovement(true) }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm font-bold transition-colors"
              >
                ⬆ Money In
              </button>
              <button
                onClick={() => { setMovementPreset({ dir: 'out', type: 'to_bank' }); setShowMovement(true) }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 text-sm font-bold transition-colors"
              >
                ⬇ Money Out
              </button>
              <button
                onClick={() => setShowAdvance(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border-2 border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-sm font-bold transition-colors"
              >
                🧑‍🔧 Salary Advance
              </button>
              <button
                onClick={() => { setExpForm(blankExpenseForm()); setShowAddExpModal(true) }}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
              >
                <span className="text-base leading-none">+</span>
                Add Expense
              </button>
            </div>
          </div>

          {/* Month filter */}
          <div className="flex items-center gap-3 mb-5">
            <button
              onClick={prevMonth}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors font-bold"
            >
              ‹
            </button>
            <span className="text-sm font-bold text-slate-700 min-w-[140px] text-center">{monthLabel(expMonth)}</span>
            <button
              onClick={nextMonth}
              disabled={expMonth >= todayStr().slice(0, 7)}
              className="w-8 h-8 flex items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors font-bold disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ›
            </button>
          </div>

          {/* ── Money moved this month — owner account + banking, tracked ──
              These never appear in expenses or profit; this card is where the
              owner sees the running position instead. */}
          {monthMovements.length > 0 && (() => {
            const sum = (t: string) => monthMovements.filter(m => m.type === t).reduce((s, m) => s + Number(m.amount || 0), 0)
            const ownerIn = sum('owner_in'), ownerOut = sum('owner_out')
            const bankIn = sum('bank_in'), toBank = sum('to_bank')
            const ownerNet = ownerIn - ownerOut
            return (
              <div className="bg-sky-50 rounded-xl border border-sky-200 p-4 mb-4">
                <p className="text-[11px] font-black text-sky-800 uppercase tracking-wide mb-2">🔁 Money moved this month — not in expenses or profit</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                  {[
                    { l: 'Owner put in', v: ownerIn, tone: 'text-emerald-700' },
                    { l: 'Given to owner', v: ownerOut, tone: 'text-amber-700' },
                    { l: 'Drawn from bank', v: bankIn, tone: 'text-emerald-700' },
                    { l: 'Banked', v: toBank, tone: 'text-amber-700' },
                  ].map(c => (
                    <div key={c.l} className="bg-white rounded-lg px-3 py-2">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">{c.l}</p>
                      <p className={`text-sm font-black ${c.tone}`}>{formatRs(c.v)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-sky-800 font-semibold">
                  Owner this month: {ownerNet === 0 ? 'even' : ownerNet > 0 ? `put in ${formatRs(ownerNet)} more than taken` : `took ${formatRs(-ownerNet)} more than put in`}
                </p>
                <div className="mt-2 max-h-40 overflow-y-auto">
                  {monthMovements.map(m => {
                    const isIn = m.type === 'owner_in' || m.type === 'bank_in'
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-xs py-1 border-t border-sky-100">
                        <span className="text-slate-400 font-mono text-[10px] shrink-0 w-14">{String(m.movement_date).slice(5)}</span>
                        <span className="font-mono text-[10px] text-slate-400 shrink-0">{MOVEMENT_ICON[m.type]}</span>
                        <span className="flex-1 text-slate-600 truncate">{MOVEMENT_LABEL[m.type]}{m.note ? <span className="text-slate-400"> — {m.note}</span> : null}</span>
                        <span className={`font-bold ${isIn ? 'text-emerald-600' : 'text-amber-700'}`}>{isIn ? '+' : '−'}{formatRs(m.amount)}</span>
                        <button onClick={() => deleteMovement(m)} className="text-red-300 hover:text-red-500 font-bold text-sm leading-none" title="Delete (owner/manager)">×</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* Category totals */}
          {!loadingExp && expenses.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {categoryTotals(expenses).map(({ category, total }) => (
                <span
                  key={category}
                  className={`text-xs font-bold px-2.5 py-1 rounded-full ${CATEGORY_COLORS[category] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {CATEGORY_LABELS[category] ?? category}: {formatRs(total)}
                </span>
              ))}
            </div>
          )}

          {/* Expense table */}
          {loadingExp ? (
            <Spinner />
          ) : expenses.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <p className="text-slate-400 font-semibold text-sm">No expenses for {monthLabel(expMonth)}.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Category</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Description</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Amount</th>
                      <th className="px-4 py-3 text-center text-xs font-bold text-slate-400 uppercase tracking-wide">Method</th>
                      <th className="px-4 py-3 text-right text-xs font-bold text-slate-400 uppercase tracking-wide">Input VAT</th>
                      <th className="px-4 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">Ref</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenses.map(e => {
                      const isLocked = Boolean(e.cash_session_id)
                      return (
                        <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                            {new Date(e.expense_date + 'T00:00:00').toLocaleDateString('en-LK', { day: '2-digit', month: 'short' })}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${CATEGORY_COLORS[e.category] ?? 'bg-gray-100 text-gray-600'}`}>
                              {CATEGORY_LABELS[e.category] ?? e.category}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">{e.description}</td>
                          <td className="px-4 py-3 text-right font-bold text-slate-800 whitespace-nowrap">{formatRs(e.amount)}</td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full ${METHOD_BADGE[e.payment_method] ?? 'bg-gray-100 text-gray-600'}`}>
                              {METHOD_LABEL[e.payment_method] ?? e.payment_method}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            {e.input_vat ? (
                              <button onClick={() => setVatFor(e)} className="group">
                                <span className="text-xs font-bold text-violet-700 group-hover:underline">{formatRs(e.input_vat)}</span>
                                <span className="block text-[10px] text-slate-400 font-mono">{e.supplier_invoice_no}</span>
                              </button>
                            ) : (
                              <button onClick={() => setVatFor(e)}
                                className="text-[10px] font-bold text-slate-400 hover:text-violet-600 border border-slate-200 hover:border-violet-300 rounded-lg px-2 py-1">
                                + claim VAT
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {e.reference ?? <span className="text-slate-200">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!isLocked && (
                              <button
                                onClick={() => handleDeleteExpense(e.id, false)}
                                className="text-red-400 hover:text-red-600 font-bold transition-colors text-base leading-none"
                                title="Delete expense"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50">
                      <td colSpan={3} className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">
                        Total — {expenses.length} expense{expenses.length !== 1 ? 's' : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-black text-slate-800 whitespace-nowrap">
                        {formatRs(expenses.reduce((s, e) => s + e.amount, 0))}
                      </td>
                      <td colSpan={3}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PAST SESSION PANEL (correct any earlier day) ─────────────────────── */}
      {pastSession && (
        <Modal title={`${formatDate(pastSession.session_date)} — cash session`} onClose={() => setPastSession(null)}>
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <SummaryCell label="Opening Balance" value={formatRs(pastSession.opening_balance)} />
              <SummaryCell label="Expected Cash" value={pastSession.expected_cash != null ? formatRs(pastSession.expected_cash) : '—'} />
              <SummaryCell label="Counted Cash" value={pastSession.closing_balance != null ? formatRs(pastSession.closing_balance) : '—'} />
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">Variance</p>
                {varianceBadge(pastSession.variance)}
              </div>
            </div>

            {pastCarry && (
              <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3">
                <p className="text-xs font-black text-sky-900">
                  Opening doesn&apos;t match {formatDate(pastCarry.prev_date)}&apos;s counted cash ({formatRs(pastCarry.prev_closing)} vs {formatRs(pastCarry.opening)})
                </p>
                <button onClick={() => { setFixCash({ session: pastSession, kind: 'opening' }); setFixAmount(String(pastCarry.prev_closing)); setFixNote(`Matched to ${pastCarry.prev_date} closing`) }}
                  className="mt-2 px-3 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold">
                  Set opening to {formatRs(pastCarry.prev_closing)}
                </button>
              </div>
            )}

            {pastSession.variance != null && pastSession.variance !== 0 && !(pastSession as any).variance_accepted && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-black text-amber-800 mb-2">
                  {pastSession.variance > 0 ? `Rs.${Math.abs(pastSession.variance).toLocaleString()} more than expected` : `Rs.${Math.abs(pastSession.variance).toLocaleString()} less than expected`} — was something not entered?
                </p>
                <div className="flex flex-wrap gap-2">
                  {pastSession.variance < 0 && (
                    <button onClick={() => { setExpForm({ ...blankExpenseForm(), expense_date: pastSession.session_date }); setPastSession(null); setActiveTab('expenses'); setShowAddExpModal(true) }}
                      className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">🧾 Add the missed expense</button>
                  )}
                  {pastSession.variance > 0 && (
                    <button onClick={() => setFixCash({ session: pastSession, kind: 'in' })}
                      className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">💵 Cash received, not recorded</button>
                  )}
                  {pastSession.variance < 0 && (
                    <button onClick={() => setFixCash({ session: pastSession, kind: 'out' })}
                      className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">💸 Cash taken out</button>
                  )}
                  <button onClick={() => setFixCash({ session: pastSession, kind: 'opening' })}
                    className="px-3 py-2 rounded-lg bg-white border-2 border-amber-300 text-xs font-bold text-amber-800 hover:bg-amber-100">↩ Fix opening balance</button>
                  <button onClick={() => setFixCash({ session: pastSession, kind: 'accept' })}
                    className="px-3 py-2 rounded-lg bg-white border-2 border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">✓ It really is short/over</button>
                </div>
              </div>
            )}
            {(pastSession as any).variance_accepted && (
              <p className="text-xs font-bold text-slate-500">Variance accepted: {(pastSession as any).variance_reason}</p>
            )}

            {pastCorrections.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-black text-slate-500 uppercase tracking-wide mb-1.5">Corrections after closing</p>
                {pastCorrections.map((c, i) => (
                  <p key={i} className="text-[11px] text-slate-600">
                    • {c.action === 'adjust' ? (c.detail?.kind === 'in' ? 'Cash in' : 'Cash out') : c.action === 'set_opening' ? 'Opening changed' : 'Accepted'}
                    {c.detail?.amount != null ? ` Rs.${Number(c.detail.amount).toLocaleString()}` : ''} — {c.actor} · {new Date(c.created_at).toLocaleDateString('en-LK')}
                    {c.detail?.note ? ` — “${c.detail.note}”` : ''}
                  </p>
                ))}
              </div>
            )}

            <button onClick={() => handleReopenSession(pastSession)}
              className="w-full py-2.5 rounded-xl border-2 border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50">
              Re-open this day (clears the count so it can be re-counted)
            </button>
          </div>
        </Modal>
      )}

      {/* ── VARIANCE CORRECTION MODAL ────────────────────────────────────────── */}
      {fixCash && (
        <Modal
          title={fixCash.kind === 'accept' ? 'Accept the difference' : fixCash.kind === 'opening' ? 'Fix opening balance' : fixCash.kind === 'in' ? 'Cash received, not recorded' : 'Cash taken out, not recorded'}
          onClose={() => !fixSaving && setFixCash(null)}
        >
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500">
              {fixCash.kind === 'accept' ? 'The count is right and nothing is missing from the records — note why, and the difference is filed as a genuine short/over.'
                : fixCash.kind === 'opening' ? 'The drawer started the day with a different amount than recorded (usually cash carried over from the previous day).'
                : fixCash.kind === 'in' ? 'Money that came into the drawer but was never entered — e.g. a cash sale rung up the next day, or money put in by the owner.'
                : 'Money that left the drawer without an expense record — e.g. cash moved to the safe or handed to the owner.'}
            </p>
            {fixCash.kind !== 'accept' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">{fixCash.kind === 'opening' ? 'Correct opening balance (Rs.)' : 'Amount (Rs.)'}</label>
                <input type="number" inputMode="numeric" min="0" value={fixAmount} onChange={e => setFixAmount(e.target.value)}
                  className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-bold focus:outline-none focus:border-orange-400" placeholder="0" />
              </div>
            )}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">{fixCash.kind === 'accept' ? 'Reason *' : 'Note'}</label>
              <input value={fixNote} onChange={e => setFixNote(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                placeholder={fixCash.kind === 'accept' ? 'e.g. genuine shortage — investigated with staff' : 'what it was for'} />
            </div>
            <button onClick={submitFix} disabled={fixSaving}
              className="w-full py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-black disabled:opacity-50">
              {fixSaving ? 'Saving…' : '✓ Apply and recheck'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── LATE CLOSE MODAL (past day's drawer left open) ───────────────────── */}
      {lateClose && (
        <Modal title={`Close ${formatDate(lateClose.session_date)} (late)`} onClose={() => !lateSaving && setLateClose(null)}>
          <div className="flex flex-col gap-3">
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700 font-semibold">
              This drawer was never closed on the day. Count what the cash SHOULD have been carried over as (or what was physically set aside), enter it, and the session closes with a late-close note for the record.
            </div>
            <div className="text-xs text-slate-500">Opening balance was <b>{formatRs(lateClose.opening_balance)}</b>{lateClose.expected_cash != null ? <> · expected <b>{formatRs(lateClose.expected_cash)}</b></> : null}</div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Counted cash (Rs.) *</label>
              <input type="number" inputMode="numeric" min="0" value={lateCount} onChange={e => setLateCount(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-bold focus:outline-none focus:border-orange-400" placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Note (why it was left open)</label>
              <input value={lateNotes} onChange={e => setLateNotes(e.target.value)}
                className="w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400" placeholder="e.g. forgot to close before leaving" />
            </div>
            <button onClick={handleLateClose} disabled={lateSaving}
              className="w-full py-3 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-black disabled:opacity-50">
              {lateSaving ? 'Closing…' : `✓ Close ${lateClose.session_date} now`}
            </button>
          </div>
        </Modal>
      )}

      {/* ── ADD EXPENSE MODAL ────────────────────────────────────────────────── */}
      {showAddExpModal && (
        <Modal title="Add Expense" onClose={() => setShowAddExpModal(false)}>
          <div className="flex flex-col gap-4">

            {/* 1 — What was it for. Tiles, not a dropdown: one tap, and the
                   operator sees every option at once instead of scrolling. */}
            <div>
              <p className="text-xs font-bold text-slate-500 mb-2">1. What was it for?</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {CATEGORIES.map(c => {
                  const on = expForm.category === c.v
                  return (
                    <button
                      key={c.v}
                      onClick={() => setExpForm(p => ({ ...p, category: c.v }))}
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
                  value={expForm.amount}
                  onChange={e => {
                    const amt = e.target.value === '' ? '' : Math.round(Number(e.target.value))
                    setExpForm(p => ({
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
                  const on = expForm.payment_method === m.v
                  return (
                    <button
                      key={m.v}
                      onClick={() => setExpForm(p => ({ ...p, payment_method: m.v }))}
                      className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border-2 text-sm font-bold transition min-h-[44px] ${
                        on ? 'border-orange-500 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <span>{m.icon}</span>{m.l}
                    </button>
                  )
                })}
              </div>
              {expForm.payment_method !== 'cash' && (
                <>
                  <input
                    type="text"
                    className="mt-2 w-full border-2 border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400"
                    placeholder={expForm.payment_method === 'cheque'
                      ? 'Cheque number *'
                      : 'Bank reference — the 8-digit confirmation number *'}
                    value={expForm.reference}
                    onChange={e => setExpForm(p => ({ ...p, reference: e.target.value }))}
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    {expForm.payment_method === 'cheque'
                      ? 'The cheque counts as paid the day it is written. Nothing comes off the till.'
                      : 'A bank transfer or standing order. Nothing comes off the till.'}
                  </p>
                </>
              )}
            </div>

            {/* 4 — A note. Optional: the category already says most of it. */}
            <div>
              <p className="text-xs font-bold text-slate-500 mb-2">4. Note <span className="font-normal text-slate-400">(optional)</span></p>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder={`e.g. ${expForm.category === 'grocery' ? 'tea and sugar for the office'
                  : expForm.category === 'transport' ? 'three-wheeler to Customs'
                  : expForm.category === 'electricity' ? 'CEB bill for July'
                  : expForm.category === 'commission' ? 'broker who brought the lorry job'
                  : 'what exactly was bought'}`}
                value={expForm.description}
                onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>

            {/* Date — almost always today, so it stays out of the way */}
            <div className="flex items-center gap-2 text-xs">
              <span className="font-bold text-slate-500">Date</span>
              <input
                type="date"
                max={todayStr()}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={expForm.expense_date}
                onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))}
              />
              {expForm.expense_date === todayStr()
                ? <span className="text-slate-400">Today</span>
                : <button onClick={() => setExpForm(p => ({ ...p, expense_date: todayStr() }))} className="text-orange-600 font-bold">back to today</button>}
            </div>

            {/* 5 — The VAT bill. Asked as a plain yes/no question about the
                   piece of paper in the operator's hand, not as tax jargon. */}
            <div className={`rounded-xl border-2 p-3 ${expForm.claim_vat ? 'border-violet-300 bg-violet-50' : 'border-slate-200'}`}>
              <p className="text-xs font-bold text-slate-500 mb-2">5. Did you get a VAT bill?</p>
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { on: false, l: 'No / just a receipt' },
                  { on: true,  l: 'Yes — VAT bill' },
                ].map(o => (
                  <button
                    key={String(o.on)}
                    onClick={() => setExpForm(p => ({
                      ...p,
                      claim_vat: o.on,
                      // Bills are quoted VAT-inclusive — pull the 18% back out
                      input_vat: o.on && p.amount !== '' ? Math.round(Number(p.amount) * 18 / 118) : '',
                    }))}
                    className={`py-2.5 rounded-xl border-2 text-sm font-bold transition min-h-[44px] ${
                      expForm.claim_vat === o.on
                        ? (o.on ? 'border-violet-500 bg-white text-violet-700' : 'border-slate-400 bg-white text-slate-700')
                        : 'border-slate-200 text-slate-400 hover:border-slate-300'
                    }`}
                  >
                    {o.l}
                  </button>
                ))}
              </div>

              {!expForm.claim_vat ? (
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
                        value={expForm.input_vat}
                        onChange={e => setExpForm(p => ({ ...p, input_vat: e.target.value === '' ? '' : Math.round(Number(e.target.value)) }))}
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
                      value={expForm.supplier_tin}
                      onChange={e => setExpForm(p => ({ ...p, supplier_tin: e.target.value.replace(/\D/g, '') }))}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Bill no. <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400"
                      placeholder="On the bill"
                      value={expForm.supplier_invoice_no}
                      onChange={e => setExpForm(p => ({ ...p, supplier_invoice_no: e.target.value }))}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Shop name</label>
                    <input
                      type="text"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
                      placeholder="e.g. Ceylon Electricity Board"
                      value={expForm.supplier_name}
                      onChange={e => setExpForm(p => ({ ...p, supplier_name: e.target.value }))}
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
              onClick={() => setShowAddExpModal(false)}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAddExpense}
              disabled={savingExp || !expForm.category || expForm.amount === '' || Number(expForm.amount) <= 0}
              className="px-5 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-black transition-colors disabled:opacity-40"
            >
              {savingExp ? 'Saving…' : expForm.amount !== '' && Number(expForm.amount) > 0 ? `Save ${formatRs(Number(expForm.amount))}` : 'Save'}
            </button>
          </div>
        </Modal>
      )}

      {showQuickIncome && (
        <QuickIncomeModal
          onClose={() => setShowQuickIncome(false)}
          onSaved={async () => {
            setShowQuickIncome(false)
            await Promise.all([fetchTodaySession(), fetchRecentSessions()])
          }}
          showToast={showToast}
        />
      )}

      {showMovement && (
        <MovementModal
          onClose={() => setShowMovement(false)}
          onSaved={async () => {
            setShowMovement(false)
            await Promise.all([fetchTodaySession(), fetchRecentSessions(), fetchDayMovements(), fetchMonthMovements(expMonth)])
          }}
          showToast={showToast}
          drawerExpected={todaySession?.status === 'open' && todaySession.expected_cash != null ? Number(todaySession.expected_cash) : null}
          todayMovements={dayMovements}
          initialDir={movementPreset.dir}
          initialType={movementPreset.type}
        />
      )}

      {showAdvance && (
        <AdvanceModal
          onClose={() => setShowAdvance(false)}
          onSaved={async () => {
            setShowAdvance(false)
            await fetchExpenses(); await fetchTodayExpenses(); await fetchTodaySession()
          }}
          showToast={showToast}
        />
      )}

      {vatFor && (
        <ExpenseVatModal
          expense={vatFor}
          onClose={() => setVatFor(null)}
          onSaved={async () => { setVatFor(null); await fetchExpenses() }}
          showToast={showToast}
        />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

// Attach the supplier's tax invoice to an expense already recorded, so its VAT
// reaches Schedule 02. Kept separate from the Add Expense form because the bill
// and the payment rarely happen on the same day.
function ExpenseVatModal({
  expense, onClose, onSaved, showToast,
}: {
  expense: Expense
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const suggested = Math.round(expense.amount * 18 / 118)
  const [name, setName] = useState(expense.supplier_name || '')
  const [tin, setTin] = useState(expense.supplier_tin || '')
  const [invNo, setInvNo] = useState(expense.supplier_invoice_no || '')
  const [invDate, setInvDate] = useState(expense.supplier_invoice_date || expense.expense_date)
  const [vat, setVat] = useState(String(expense.input_vat || suggested))
  const [saving, setSaving] = useState(false)

  async function save(clear = false) {
    setSaving(true)
    try {
      const res = await fetch('/api/vendor/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_vat',
          expenseId: expense.id,
          supplier_name: clear ? null : name.trim(),
          supplier_tin: clear ? null : tin.trim(),
          supplier_invoice_no: clear ? null : invNo.trim(),
          supplier_invoice_date: clear ? null : invDate,
          input_vat: clear ? 0 : Math.round(Number(vat) || 0),
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'Failed to save')
      showToast(clear ? 'VAT claim removed' : 'Input VAT recorded')
      onSaved()
    } catch (e: any) { showToast('⚠️ ' + e.message) }
    setSaving(false)
  }

  return (
    <Modal title="Input VAT on this expense" onClose={onClose}>
      <p className="text-xs text-slate-500 -mt-2 mb-4">
        {expense.description} · {formatRs(expense.amount)} paid on{' '}
        {new Date(expense.expense_date + 'T00:00:00').toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' })}
      </p>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="col-span-2">
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Supplier</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Sri Lanka Telecom"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Supplier TIN <span className="text-red-500">*</span></label>
          <input type="text" inputMode="numeric" maxLength={9} value={tin}
            onChange={e => setTin(e.target.value.replace(/\D/g, ''))} placeholder="9 digits"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Tax invoice no. <span className="text-red-500">*</span></label>
          <input type="text" value={invNo} onChange={e => setInvNo(e.target.value)} placeholder="On the bill"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">Invoice date</label>
          <input type="date" value={invDate} onChange={e => setInvDate(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <div>
          <label className="block text-[11px] font-bold text-slate-500 mb-1">VAT on the bill (Rs.)</label>
          <input type="number" min={0} value={vat} onChange={e => setVat(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-bold focus:outline-none focus:ring-2 focus:ring-violet-400" />
        </div>
        <p className="col-span-2 text-[11px] text-slate-400">
          18% of a VAT-inclusive {formatRs(expense.amount)} is {formatRs(suggested)} — match the invoice exactly.
          The claim lands in the month of the invoice date and can be deferred from VAT Filing.
        </p>
      </div>

      <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-slate-100">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50">Cancel</button>
        {Boolean(expense.input_vat) && (
          <button onClick={() => save(true)} disabled={saving}
            className="px-4 py-2 rounded-lg border border-red-200 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-50">Remove claim</button>
        )}
        <button onClick={() => save(false)} disabled={saving}
          className="px-5 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold disabled:opacity-50">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className="text-sm font-bold text-slate-800">{value}</p>
    </div>
  )
}

function Modal({
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

function Spinner() {
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
function AdvanceModal({
  onClose, onSaved, showToast,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const [people, setPeople] = useState<{ id: string; name: string; branch?: string | null }[]>([])
  const [loading, setLoading] = useState(true)
  const [employeeId, setEmployeeId] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
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
function MovementModal({
  onClose, onSaved, showToast, drawerExpected, todayMovements, initialDir, initialType,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
  drawerExpected?: number | null
  todayMovements?: any[]
  initialDir: 'in' | 'out'
  initialType?: string
}) {
  const TYPES = [
    { v: 'owner_in',  icon: '👤', l: 'From owner',  d: 'Owner’s own money into the till', dir: 'in' },
    { v: 'bank_in',   icon: '🏦', l: 'From bank',   d: 'Cash drawn from the business account', dir: 'in' },
    { v: 'to_bank',   icon: '🏦', l: 'To bank',     d: 'Banking the day’s cash', dir: 'out' },
    { v: 'owner_out', icon: '👤', l: 'To owner',    d: 'Excess cash / drawings handed to the owner', dir: 'out' },
  ] as const
  const dir = initialDir
  const [type, setType] = useState<string>(initialType || (dir === 'in' ? 'owner_in' : 'to_bank'))
  const [amount, setAmount] = useState<number | ''>('')
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
function QuickIncomeModal({
  onClose, onSaved, showToast,
}: {
  onClose: () => void
  onSaved: () => void
  showToast: (m: string) => void
}) {
  const PRESETS = ['Puncture repair', 'Air / nitrogen fill', 'Tube fitting', 'Quick service']
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState<number | ''>('')
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
