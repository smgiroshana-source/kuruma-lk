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
}

type ExpenseCategory =
  | 'rent'
  | 'utilities'
  | 'salaries'
  | 'fuel'
  | 'maintenance'
  | 'repairs'
  | 'bank_charges'
  | 'tax'
  | 'petty_cash'
  | 'other'

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

const CATEGORY_LABELS: Record<string, string> = {
  rent: 'Rent',
  utilities: 'Utilities',
  salaries: 'Salaries',
  fuel: 'Fuel',
  maintenance: 'Maintenance',
  repairs: 'Repairs',
  bank_charges: 'Bank Charges',
  tax: 'Tax',
  petty_cash: 'Petty Cash',
  other: 'Other',
}

const CATEGORY_COLORS: Record<string, string> = {
  rent: 'bg-violet-100 text-violet-700',
  utilities: 'bg-blue-100 text-blue-700',
  salaries: 'bg-indigo-100 text-indigo-700',
  fuel: 'bg-amber-100 text-amber-700',
  maintenance: 'bg-teal-100 text-teal-700',
  repairs: 'bg-rose-100 text-rose-700',
  bank_charges: 'bg-slate-100 text-slate-700',
  tax: 'bg-red-100 text-red-700',
  petty_cash: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-600',
}

const METHOD_BADGE: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-700',
  bank: 'bg-blue-100 text-blue-700',
  card: 'bg-purple-100 text-purple-700',
}

// ── Blank form factories ──────────────────────────────────────────────────────

function blankExpenseForm() {
  return {
    expense_date: todayStr(),
    category: 'other' as ExpenseCategory,
    description: '',
    amount: '' as number | '',
    payment_method: 'cash',
    reference: '',
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TabCash({ vendor, showToast, initialView, onInitialViewConsumed }: Props & { initialView?: string | null; onInitialViewConsumed?: () => void }) {
  // Dashboard deep-links: 'expenses' opens the expenses view; 'add-expense'
  // additionally opens the Add Expense modal ready to type.
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'expenses'>(
    initialView === 'expenses' || initialView === 'add-expense' ? 'expenses' : 'reconciliation'
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
  const [savingExp, setSavingExp] = useState(false)

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
      if (data.session) {
        fetchTodayExpenses()
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

  async function handleReopenSession() {
    if (!todaySession) return
    if (!confirm('Re-open this session? The closing data will be cleared.')) return
    try {
      const res = await fetch('/api/vendor/cash-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reopen', sessionId: todaySession.id }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? 'Failed to reopen session')
      }
      showToast('Session reopened')
      await fetchTodaySession()
      await fetchRecentSessions()
    } catch (e: any) {
      showToast(e.message)
    }
  }

  // ── Expense actions ────────────────────────────────────────────────────────

  async function handleAddInlineExpense() {
    if (!inlineExpForm.description.trim()) {
      showToast('Description is required')
      return
    }
    if (inlineExpForm.amount === '' || Number(inlineExpForm.amount) <= 0) {
      showToast('Enter a valid amount')
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
          description: inlineExpForm.description.trim(),
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
    if (!expForm.description.trim()) {
      showToast('Description is required')
      return
    }
    if (expForm.amount === '' || Number(expForm.amount) <= 0) {
      showToast('Enter a valid amount')
      return
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
          description: expForm.description.trim(),
          amount: Math.round(Number(expForm.amount)),
          payment_method: expForm.payment_method,
          reference: expForm.reference.trim() || null,
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
      showToast('Expense added')
      setShowAddExpModal(false)
      setExpForm(blankExpenseForm())
      await fetchExpenses()
      await fetchTodayExpenses()
      await fetchTodaySession()
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
                  <button
                    onClick={() => { setShowAddExpenseInline(true); setInlineExpForm(blankExpenseForm()) }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-colors"
                  >
                    <span>+</span> Add Expense
                  </button>
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
                          {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
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
                          <option value="bank">Bank</option>
                          <option value="card">Card</option>
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
                              <span className={`inline-block text-[11px] font-bold px-1.5 py-0.5 rounded-full capitalize ${METHOD_BADGE[e.payment_method] ?? 'bg-gray-100 text-gray-600'}`}>
                                {e.payment_method}
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
                  onClick={handleReopenSession}
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
                        <tr key={s.id} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="text-sm font-semibold text-slate-700">{formatDate(s.session_date)}</p>
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
            <button
              onClick={() => { setExpForm(blankExpenseForm()); setShowAddExpModal(true) }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors shadow-sm"
            >
              <span className="text-base leading-none">+</span>
              Add Expense
            </button>
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
                            <span className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full capitalize ${METHOD_BADGE[e.payment_method] ?? 'bg-gray-100 text-gray-600'}`}>
                              {e.payment_method}
                            </span>
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
          <div className="flex flex-col gap-3">
            {/* Date */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Date</label>
              <input
                type="date"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={expForm.expense_date}
                onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))}
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Category</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                value={expForm.category}
                onChange={e => setExpForm(p => ({ ...p, category: e.target.value as ExpenseCategory }))}
              >
                {Object.entries(CATEGORY_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="What was the expense for?"
                value={expForm.description}
                onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))}
              />
            </div>

            {/* Amount */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">
                Amount (Rs.) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="0"
                value={expForm.amount}
                onChange={e => setExpForm(p => ({ ...p, amount: e.target.value === '' ? '' : Math.round(Number(e.target.value)) }))}
              />
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Payment Method</label>
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white"
                value={expForm.payment_method}
                onChange={e => setExpForm(p => ({ ...p, payment_method: e.target.value }))}
              >
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
                <option value="card">Card</option>
              </select>
            </div>

            {/* Reference */}
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Reference (optional)</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Cheque no., bank ref…"
                value={expForm.reference}
                onChange={e => setExpForm(p => ({ ...p, reference: e.target.value }))}
              />
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
              disabled={savingExp}
              className="px-5 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold transition-colors disabled:opacity-50"
            >
              {savingExp ? 'Adding…' : 'Add Expense'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
