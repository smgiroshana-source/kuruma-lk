'use client'
// ── WHEEL MART ONLY — operator-first dashboard. Never import from _standard/ ──
//
// Design goals (owner brief, Aug 2026): staff find things fast and nothing gets
// forgotten. Three pillars:
//   1. "Today's flow" — the daily rhythm (open drawer → attendance → trade →
//      count & close → send report) as live checklist steps that nag until green.
//   2. "Needs attention" — every detectable leak as one actionable row that
//      deep-links to the exact fix (aging credit, overdue payables, missing
//      costs, low stock, unposted GRNs, a drawer left open yesterday).
//   3. Role-aware: cashiers see only what they can act on; managers add staff
//      and supplier duties; the owner sees everything.

import { useState, useEffect, useCallback } from 'react'
import { colomboToday } from '@/lib/dates'
import {
  Modal, ExpenseModal, MovementModal, AdvanceModal, QuickIncomeModal,
  OpenDrawerModal, CloseDrawerModal, AttendanceModal,
  SupplierPayModal, CustomerCollectModal,
} from './CashModals'

type Dashboard = {
  todaySales: number
  todayCount: number
  cashSession: { status: string; expected: number; openedAt?: string | null } | null
  staleOpenSessionDate?: string | null
  attendance?: { marked: number; total: number }
  creditOwed: number
  creditCustomers: number
  creditInternalOwed?: number
  creditOldestDays?: number
  creditOldestName?: string
  payables: { due: number; overdueCount: number; oldestDays: number }
  grnDrafts: number
  salaryRaisesDue?: number
  salaryRaiseName?: string
  recentActivity: { time: string; customer: string; amount: number; method: string }[]
}

function ActionIcon({ name }: { name: string }) {
  const P = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'card': return <svg {...P}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
    case 'spark': return <svg {...P}><path d="M13 2L4.5 13.5H11L9.5 22 19 10.5h-6.5z"/></svg>
    case 'user': return <svg {...P}><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a7 7 0 0 1 14 0v1"/></svg>
    case 'bank': return <svg {...P}><path d="M3 21h18M4 18h16M6 18v-7M10 18v-7M14 18v-7M18 18v-7M3 8l9-5 9 5z"/></svg>
    case 'bankout': return <svg {...P}><path d="M3 21h18M4 18h16M6 18v-7M12 18v-7M3 8l9-5 9 5z"/><path d="M17 14l3 3-3 3M20 17h-6"/></svg>
    case 'receipt': return <svg {...P}><path d="M6 2h12v20l-2-1.5L14 22l-2-1.5L10 22l-2-1.5L6 22zM9.5 7h5M9.5 11h5M9.5 15h3"/></svg>
    case 'factory': return <svg {...P}><path d="M3 21V9l6 4V9l6 4V4h6v17zM8 17h.01M13 17h.01M18 17h.01"/></svg>
    case 'wallet': return <svg {...P}><path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16V7"/><path d="M16 14h.01"/></svg>
    case 'boxin': return <svg {...P}><path d="M12 3v8m0 0l-3-3m3 3l3-3"/><path d="M4 13l8 4 8-4M4 13v5l8 4 8-4v-5M4 13l4-2M20 13l-4-2"/></svg>
    case 'ship': return <svg {...P}><path d="M4 18l-1-5 9-2 9 2-1 5"/><path d="M6 11V7h4V4h4v3h4v4"/><path d="M2 21c1.5 0 2-1 3.5-1s2 1 3.5 1 2-1 3.5-1 2 1 3.5 1 2-1 3.5-1 2 1 2.5 1"/></svg>
    default: return null
  }
}

type Props = {
  vendor: any
  stats: {
    totalProducts: number
    activeProducts: number
    totalStock: number
    stockValue: number
    totalSales: number
  }
  dashboard?: Dashboard
  staffRole?: string
  products: any[]
  vendorSettings: any
  onNavigate: (tab: string, sub?: string) => void
  showToast: (msg: string) => void
  // Re-pull the page-level catalog/stats after a popup writes something —
  // without it the dashboard tiles kept yesterday's numbers until a reload.
  onDataChanged?: () => void | Promise<void>
  // Opens the printable daily report directly (page.tsx owns the generator)
  onDailyReport?: () => void
}

function formatRs(amount: number): string {
  return 'Rs.' + Math.round(amount || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

function colomboHour(): number {
  return parseInt(new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false }), 10)
}

function getGreeting(): string {
  const h = colomboHour()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-LK', {
    timeZone: 'Asia/Colombo', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-LK', { timeZone: 'Asia/Colombo', hour: 'numeric', minute: '2-digit', hour12: true })
  } catch { return '' }
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash', card: 'Card', cheque: 'Cheque', bank: 'Bank', credit: 'Credit', advance: 'Advance',
}

// One step in the daily-flow strip
type FlowStep = {
  key: string
  icon: string
  title: string
  sub: string
  state: 'done' | 'now' | 'later'
  tab?: string
  tabSub?: string
  clickable?: boolean
}

export default function TabOverview({ vendor, stats, dashboard, staffRole, products, onNavigate, showToast, onDailyReport, onDataChanged }: Props) {
  const role = staffRole || 'owner'
  const isCashier = role === 'cashier'
  const seesMoney = role === 'owner' || role === 'manager'

  // ── The day as a state machine ─────────────────────────────────────────────
  // The flow strip is not a menu: each step unlocks the next, and every action
  // happens in a popup RIGHT HERE — the operator never leaves the dashboard.
  // flowSession is the authoritative session row (live_expected included);
  // undefined = still loading, null = no session opened today.
  const [flowSession, setFlowSession] = useState<any | undefined>(undefined)
  const [attToday, setAttToday] = useState<{ marked: number; total: number } | null>(null)
  type Popup =
    | { kind: 'open' } | { kind: 'close' } | { kind: 'att' }
    | { kind: 'chooser'; dir: 'in' | 'out'; amount: number }
    | { kind: 'income'; amount?: number }
    | { kind: 'movement'; dir: 'in' | 'out'; type: string; amount?: number }
    | { kind: 'advance'; amount?: number }
    | { kind: 'expense'; amount?: number }
    | { kind: 'paysupplier'; amount?: number }
    | { kind: 'collect'; amount?: number }
  const [popup, setPopup] = useState<Popup | null>(null)
  const [amtIn, setAmtIn] = useState('')
  const [amtOut, setAmtOut] = useState('')

  const refreshFlow = useCallback(async () => {
    try {
      const r = await fetch('/api/vendor/cash-sessions?date=' + colomboToday())
      if (r.ok) { const j = await r.json(); setFlowSession(j.session ?? null) }
    } catch {}
    if (role === 'owner' || role === 'manager') {
      try {
        const r = await fetch('/api/vendor/staff-hr?date=' + colomboToday())
        if (r.ok) {
          const j = await r.json()
          const today = colomboToday()
          const emps = (j.employees || []).filter((e: any) => e.active !== false && (!e.join_date || e.join_date <= today))
          const ids = new Set(emps.map((e: any) => e.id))
          const marked = new Set((j.attendance || []).filter((a: any) => ids.has(a.employee_id)).map((a: any) => a.employee_id)).size
          setAttToday({ marked, total: emps.length })
        }
      } catch {}
    }
  }, [role])
  useEffect(() => { refreshFlow() }, [refreshFlow])

  const closePopup = () => setPopup(null)
  const popupSaved = () => { setPopup(null); setAmtIn(''); setAmtOut(''); refreshFlow(); onDataChanged?.() }

  // Green/red quick boxes: amount first, destination second
  function submitQuick(dir: 'in' | 'out') {
    const raw = dir === 'in' ? amtIn : amtOut
    const amt = Math.round(Number(raw) || 0)
    if (amt <= 0) { showToast('Type the amount first'); return }
    setPopup({ kind: 'chooser', dir, amount: amt })
  }

  // Band rows / chooser destinations that open a popup in place. Rows whose
  // work is genuinely page-sized (allocating a credit payment, picking a
  // supplier invoice, a GRN) still navigate.
  function openDest(key: string, amount?: number) {
    switch (key) {
      case 'income':   setPopup({ kind: 'income', amount }); break
      case 'owner_in': setPopup({ kind: 'movement', dir: 'in', type: 'owner_in', amount }); break
      case 'bank_in':  setPopup({ kind: 'movement', dir: 'in', type: 'bank_in', amount }); break
      case 'expense':  setPopup({ kind: 'expense', amount }); break
      case 'advance':  setPopup({ kind: 'advance', amount }); break
      case 'move_out': setPopup({ kind: 'movement', dir: 'out', type: 'to_bank', amount }); break
      // Both used to navigate to a list where the operator retyped the same
      // amount. Now the list comes to them: pick who, and it's recorded.
      case 'credit':   setPopup({ kind: 'collect', amount }); break
      case 'supplier': setPopup({ kind: 'paysupplier', amount }); break
    }
  }

  // dashboard is undefined during the quick (phase-1) load — render placeholders
  // then, NOT zeros: zeros would flash "Rs.0 / all clear" before real data lands.
  const dashLoading = !dashboard
  const d: Dashboard = dashboard || {
    todaySales: 0, todayCount: 0, cashSession: null, creditOwed: 0, creditCustomers: 0,
    payables: { due: 0, overdueCount: 0, oldestDays: 0 }, grnDrafts: 0, recentActivity: [],
  }
  const num = (v: string) => dashLoading ? '…' : v

  // ── Client-computed product warnings (products are already loaded) ──
  const lowStock = products.filter(p => p.is_active && (p.min_stock_level || 0) > 0 && p.quantity <= p.min_stock_level)
  const lowStockWorst = lowStock.slice().sort((a, b) => a.quantity - b.quantity)[0]

  // Two destinations lead to a LIST, and a list with nothing in it is a dead
  // end — the operator taps, lands on an empty screen and has to find their
  // own way back. Gate them on there actually being something to settle.
  // (Never while the dashboard is still loading: zeros would gate wrongly.)
  const noCredit = !dashLoading && (d.creditOwed || 0) <= 0
  const noPayables = !dashLoading && (d.payables?.due || 0) <= 0
  const destBlocked = (dest: string) =>
    (dest === 'credit' && noCredit) || (dest === 'supplier' && noPayables)
  const destBlockedWhy = (dest: string) =>
    dest === 'credit' ? 'nobody owes you right now' : 'no unpaid supplier bills'


  // ── Today's flow steps — gated, popup-driven ──
  const hour = colomboHour()
  // Until the fresh fetch lands, fall back to the dashboard snapshot so the
  // strip doesn't flash "open the drawer" over an already-open day.
  const sess2: any = flowSession !== undefined ? flowSession : (d.cashSession ? { status: d.cashSession.status, opened_at: d.cashSession.openedAt } : null)
  const sessOpen = !!sess2 && sess2.status === 'open'
  const sessClosed = !!sess2 && sess2.status === 'closed'
  const att = attToday ?? d.attendance ?? null
  const flow: FlowStep[] = []
  flow.push(
    !sess2
      ? { key: 'open', icon: '🗄️', title: 'Open the drawer', sub: 'Count the float, start the day', state: 'now' }
      : { key: 'open', icon: '🗄️', title: 'Drawer opened', sub: sess2.opened_at ? `at ${fmtTime(sess2.opened_at)}` : 'session running', state: 'done' }
  )
  if (!isCashier && (att?.total || 0) > 0) {
    flow.push(
      !sess2
        ? { key: 'att', icon: '🧑‍🔧', title: 'Attendance', sub: 'after the drawer opens', state: 'later' }
        : att!.marked >= att!.total
          ? { key: 'att', icon: '🧑‍🔧', title: 'Attendance marked', sub: `${att!.marked}/${att!.total} staff — tap to edit`, state: 'done' }
          : { key: 'att', icon: '🧑‍🔧', title: `Attendance ${att!.marked}/${att!.total}`, sub: 'Mark today’s staff', state: 'now' }
    )
  }
  flow.push(
    sessClosed
      ? { key: 'close', icon: '💵', title: 'Drawer closed', sub: 'Counted and reconciled', state: 'done' }
      : sessOpen
        ? { key: 'close', icon: '💵', title: 'Count and close', sub: hour >= 17 ? 'End-of-day cash count' : 'when the day ends', state: hour >= 17 ? 'now' : 'later', clickable: true }
        : { key: 'close', icon: '💵', title: 'Count and close', sub: 'after the drawer opens', state: 'later' }
  )
  if (!isCashier) {
    flow.push(
      sessClosed
        ? { key: 'report', icon: '📄', title: 'Send daily report', sub: 'PDF for the owner', state: 'now' }
        : { key: 'report', icon: '📄', title: 'Daily report', sub: 'after the drawer closes', state: 'later' }
    )
  }
  function flowClick(key: string) {
    switch (key) {
      case 'open': sess2 ? onNavigate('cash') : setPopup({ kind: 'open' }); break
      case 'att': if (sess2) setPopup({ kind: 'att' }); break
      case 'close':
        if (sessOpen) setPopup({ kind: 'close' })
        else if (sessClosed) onNavigate('cash')
        break
      case 'report':
        if (sessClosed) { if (onDailyReport) onDailyReport(); else onNavigate('reports') }
        break
    }
  }
  // A step is tappable when its moment has come (or passed)
  const flowClickable = (st: FlowStep) =>
    st.state !== 'later' || (st as any).clickable === true
  const flowDone = flow.every(s => s.state === 'done')

  // ── Needs-attention queue (red = money leaking now, amber = drifting) ──
  type Attn = { icon: string; tone: 'red' | 'amber'; text: string; cta: string; tab: string; sub?: string }
  const attention: Attn[] = []
  if (!isCashier) {
    if (d.staleOpenSessionDate) {
      attention.push({ icon: '🚨', tone: 'red', text: `Drawer from ${d.staleOpenSessionDate} was never closed — cash variance unknown`, cta: 'Review', tab: 'cash' })
    }
    if (d.payables.overdueCount > 0) {
      attention.push({
        icon: '🏭', tone: 'red',
        text: `${d.payables.overdueCount} supplier payment${d.payables.overdueCount !== 1 ? 's' : ''} overdue` +
              (d.payables.oldestDays > 0 ? ` — oldest ${d.payables.oldestDays} days` : ''),
        cta: 'Pay', tab: 'suppliers',
      })
    }
    if ((d.creditOldestDays || 0) > 30) {
      attention.push({
        icon: '⏰', tone: 'red',
        text: `Credit aging: oldest unpaid invoice is ${d.creditOldestDays} days old${d.creditOldestName ? ` (${d.creditOldestName})` : ''}`,
        cta: 'Collect', tab: 'receivables',
      })
    } else if (d.creditOwed > 0) {
      attention.push({
        icon: '📝', tone: 'amber',
        text: `${formatRs(d.creditOwed)} owed by ${d.creditCustomers} customer${d.creditCustomers !== 1 ? 's' : ''} on credit`,
        cta: 'Collect', tab: 'receivables',
      })
    }
    // No missing-cost nag here (owner decision, Aug 2026): no-cost items are a
    // legitimate state — the profit report excludes them honestly and offers
    // inline rough-cost entry where it matters. The Products "Missing cost"
    // filter remains for deliberate cleanup sessions.
    if (lowStock.length > 0) {
      attention.push({
        icon: '📉', tone: 'amber',
        text: `${lowStock.length} product${lowStock.length !== 1 ? 's' : ''} below minimum stock` +
              (lowStockWorst ? ` (${lowStockWorst.name}: ${lowStockWorst.quantity} left)` : ''),
        cta: 'Reorder', tab: 'stocktake',
      })
    }
    if ((d.salaryRaisesDue || 0) > 0) {
      attention.push({
        icon: '💰', tone: 'amber',
        text: d.salaryRaisesDue === 1
          ? `${d.salaryRaiseName}'s salary increase is due — not applied yet`
          : `${d.salaryRaisesDue} salary increases are due — not applied yet`,
        cta: 'Apply', tab: 'staff',
      })
    }
    if (d.grnDrafts > 0) {
      attention.push({
        icon: '📥', tone: 'amber',
        text: `${d.grnDrafts} stock receipt${d.grnDrafts !== 1 ? 's' : ''} (GRN) not yet posted`,
        cta: 'Post', tab: 'stocktake', sub: 'history',
      })
    }
    attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1))
  }

  const cashState =
    dashLoading ? { label: '…', sub: 'Loading', tone: 'slate' as const }
    : !sess2 ? { label: 'No session', sub: 'Open the drawer', tone: 'amber' as const }
    : sessOpen ? { label: 'Open', sub: flowSession?.live_expected != null ? `Float ${formatRs(flowSession.live_expected)}` : 'Session running', tone: 'green' as const }
    : { label: 'Closed', sub: 'Reconciled', tone: 'slate' as const }

  return (
    <div>
      {/* ── Greeting + POS ──────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            {getGreeting()}, <span className="text-orange-500">{vendor.name}</span>
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{getTodayLabel()}</p>
        </div>
        <button
          onClick={() => onNavigate('pos')}
          className="self-start sm:self-auto flex items-center gap-2.5 px-7 py-4 rounded-2xl bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-black text-lg transition-colors shadow-lg shadow-green-900/20"
        >
          <span className="text-2xl leading-none">🛒</span>
          <span>POS</span>
        </button>
      </div>

      {/* ── Today's flow — the anti-omission strip ──────────────────────────── */}
      <div className={`rounded-xl border p-4 mb-5 ${flowDone && !dashLoading ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Today's flow</h3>
          {flowDone && !dashLoading && <span className="text-[11px] font-black text-emerald-600">✓ ALL DONE</span>}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
          {flow.map(step => (
            <button
              key={step.key}
              onClick={() => flowClick(step.key)}
              disabled={dashLoading || !flowClickable(step)}
              className={`text-left rounded-xl border-2 px-3.5 py-3 transition-colors ${
                dashLoading ? 'border-slate-100 bg-slate-50 opacity-60' :
                step.state === 'done' ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300' :
                step.state === 'now' ? 'border-amber-300 bg-amber-50 hover:border-amber-400 animate-[pulse_3s_ease-in-out_infinite]' :
                flowClickable(step) ? 'border-slate-100 bg-slate-50 hover:border-slate-200' :
                'border-slate-100 bg-slate-50 opacity-55 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">{dashLoading ? '⏳' : step.state === 'done' ? '✅' : step.icon}</span>
                <span className={`text-[13px] font-bold leading-tight ${
                  step.state === 'done' ? 'text-emerald-700' : step.state === 'now' ? 'text-amber-800' : 'text-slate-400'
                }`}>{dashLoading ? 'Loading…' : step.title}</span>
              </div>
              <p className={`text-[11px] mt-1 ml-6 ${
                step.state === 'done' ? 'text-emerald-500' : step.state === 'now' ? 'text-amber-600 font-semibold' : 'text-slate-300'
              }`}>{dashLoading ? '' : step.state === 'now' ? step.sub + ' →' : step.sub}</p>
            </button>
          ))}
        </div>

        {/* ── Quick entry: amount first, destination second ──────────────────
            While the drawer is open, "money happened" is one number away: type
            it in the green (came in) or red (went out) box, then pick who —
            the destination popup opens with the amount already filled. */}
        {sessOpen && !dashLoading && (
          <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div className="flex items-center gap-2 rounded-xl border-2 border-emerald-200 bg-emerald-50/60 pl-3 pr-1.5 py-1 focus-within:border-emerald-400 transition-colors">
              <span className="text-xs font-black text-emerald-700 shrink-0">＋ Rs.</span>
              <input
                type="number" min={1} inputMode="numeric"
                value={amtIn}
                onChange={e => setAmtIn(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitQuick('in') }}
                placeholder="income — money came in"
                className="flex-1 min-w-0 bg-transparent py-1.5 text-base font-bold text-emerald-900 placeholder:text-emerald-600/50 placeholder:text-[13px] placeholder:font-semibold outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button onClick={() => submitQuick('in')} aria-label="Record money in"
                className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-white transition-all duration-150 ${
                  Number(amtIn) > 0 ? 'bg-emerald-600 hover:bg-emerald-700 shadow-sm hover:shadow active:scale-95' : 'bg-emerald-300'
                }`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 rounded-xl border-2 border-red-200 bg-red-50/60 pl-3 pr-1.5 py-1 focus-within:border-red-400 transition-colors">
              <span className="text-xs font-black text-red-700 shrink-0">－ Rs.</span>
              <input
                type="number" min={1} inputMode="numeric"
                value={amtOut}
                onChange={e => setAmtOut(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitQuick('out') }}
                placeholder="expense — money went out"
                className="flex-1 min-w-0 bg-transparent py-1.5 text-base font-bold text-red-900 placeholder:text-red-600/50 placeholder:text-[13px] placeholder:font-semibold outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button onClick={() => submitQuick('out')} aria-label="Record money out"
                className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-white transition-all duration-150 ${
                  Number(amtOut) > 0 ? 'bg-red-600 hover:bg-red-700 shadow-sm hover:shadow active:scale-95' : 'bg-red-300'
                }`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h13M13 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Needs attention ─────────────────────────────────────────────────── */}
      {!isCashier && (dashLoading ? (
        <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 mb-5 flex items-center gap-3">
          <span className="text-lg">⏳</span>
          <span className="text-sm font-semibold text-slate-400">Checking for items that need attention…</span>
        </div>
      ) : attention.length > 0 ? (
        <div className="bg-white rounded-xl border-2 border-amber-300 p-4 mb-5">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-3">
            <span>⚠️</span><span>Needs Attention</span>
            <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full">{attention.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {attention.map((a, i) => (
              <button
                key={i}
                onClick={() => onNavigate(a.tab, a.sub)}
                className={`flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border-l-4 border transition-colors ${
                  a.tone === 'red'
                    ? 'bg-red-50 border-red-200 border-l-red-500 hover:bg-red-100'
                    : 'bg-amber-50 border-amber-200 border-l-amber-400 hover:bg-amber-100'
                }`}
              >
                <span className="text-base leading-none shrink-0">{a.icon}</span>
                <span className="flex-1 text-sm font-semibold text-slate-800">{a.text}</span>
                <span className={`text-xs font-black shrink-0 ${a.tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>
                  {a.cta} →
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 mb-5 flex items-center gap-3">
          <span className="text-lg">✅</span>
          <span className="text-sm font-semibold text-emerald-800">All clear — nothing overdue, nothing missing.</span>
        </div>
      ))}

      {/* ── Money in · Money out · Stock ─────────────────────────────────────
          Three horizontal bands, not columns: 3, 4 and 2 actions can never
          balance side-by-side, but as rows they read like lines of different
          length — natural. Label left, actions right, one quiet surface. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-5 divide-y divide-slate-100">
        {([
          {
            dot: 'bg-emerald-500', title: 'Money in', q: 'who is paying you?',
            tint: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
            rows: [
              { icon: 'card', title: 'Customer credit', sub: 'settling what they owe', dest: 'credit' },
              { icon: 'spark', title: 'Service income', sub: 'quick job, no invoice — Proprietor', dest: 'income' },
              { icon: 'user', title: 'From owner', sub: 'own money into the till', dest: 'owner_in' },
              { icon: 'bank', title: 'From bank', sub: 'drawn for the float', dest: 'bank_in' },
            ],
          },
          {
            dot: 'bg-orange-500', title: 'Money out', q: 'who are you paying?',
            tint: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
            rows: [
              { icon: 'receipt', title: 'Bills & expenses', sub: 'electricity, grocery, transport', dest: 'expense' },
              { icon: 'factory', title: 'Supplier', sub: 'money we owe for stock', dest: 'supplier' },
              { icon: 'wallet', title: 'Staff advance', sub: 'cash before payday', dest: 'advance' },
              { icon: 'bankout', title: 'Banking & drawings', sub: 'cash leaving the till', dest: 'move_out' },
            ],
          },
          {
            dot: 'bg-sky-500', title: 'Stock', q: 'goods moving',
            tint: 'bg-sky-50 text-sky-600 group-hover:bg-sky-100',
            rows: [
              { icon: 'boxin', title: 'Stock arrived', sub: 'GRN — payment asked at the end', dest: 'nav:stocktake:receive' },
              { icon: 'ship', title: 'Container', sub: 'Cusdec + import VAT', dest: 'nav:imports' },
            ],
          },
        ] as const).map(band => (
          <div key={band.title} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 py-2.5">
            <div className="flex items-baseline sm:block gap-2 w-44 shrink-0 pt-1 sm:pt-0">
              <span className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full ${band.dot}`} />
                <span className="text-[13px] font-bold text-slate-800 tracking-tight">{band.title}</span>
              </span>
              <span className="block text-[11px] text-slate-400 sm:pl-3.5">{band.q}</span>
            </div>
            <div className="flex flex-wrap gap-1 flex-1">
              {band.rows.map(r => (
                <button
                  key={r.title}
                  disabled={destBlocked(r.dest)}
                  title={destBlocked(r.dest) ? destBlockedWhy(r.dest) : undefined}
                  onClick={() => {
                    if (r.dest.startsWith('nav:')) {
                      const [, t, sub] = r.dest.split(':')
                      onNavigate(t, sub || undefined)
                    } else openDest(r.dest)
                  }}
                  className={`group flex items-center gap-2.5 pl-2 pr-3.5 py-2 rounded-lg text-left transition-colors duration-150 ${
                    destBlocked(r.dest) ? 'opacity-45 cursor-not-allowed' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150 ${
                    destBlocked(r.dest) ? 'bg-slate-100 text-slate-400' : band.tint
                  }`}>
                    <ActionIcon name={r.icon} />
                  </span>
                  <span className="leading-tight">
                    <span className="block text-[13px] font-semibold text-slate-800">{r.title}</span>
                    <span className="block text-[11px] text-slate-400">
                      {destBlocked(r.dest) ? destBlockedWhy(r.dest) : r.sub}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Quick actions removed — everything it held lives in the sidebar and
          the cards above; duplicates on the dashboard were noise. */}

      {/* ── Money at a glance ───────────────────────────────────────────────── */}
      <div className={`grid grid-cols-2 ${seesMoney ? 'lg:grid-cols-4' : ''} gap-3 mb-5`}>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Today's Sales</p>
          <p className="text-2xl font-black text-slate-900 mt-1 leading-tight">{num(formatRs(d.todaySales))}</p>
          <p className="text-xs text-slate-400 mt-0.5">{dashLoading ? 'Loading' : `${d.todayCount} sale${d.todayCount !== 1 ? 's' : ''} today`}</p>
        </div>
        <button
          onClick={() => onNavigate('cash')}
          className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-orange-300 transition-colors"
        >
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Cash Drawer</p>
          <p className={`text-2xl font-black mt-1 leading-tight ${
            cashState.tone === 'green' ? 'text-emerald-600' : cashState.tone === 'amber' ? 'text-amber-600' : 'text-slate-500'
          }`}>{cashState.label}</p>
          <p className="text-xs text-slate-400 mt-0.5">{cashState.sub}</p>
        </button>
        {seesMoney && (
          <>
            <button
              onClick={() => onNavigate('receivables')}
              className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-orange-300 transition-colors"
            >
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Owed to Us</p>
              <p className={`text-2xl font-black mt-1 leading-tight ${d.creditOwed > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {num(formatRs(d.creditOwed))}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">{dashLoading ? 'Loading' : `${d.creditCustomers} customer${d.creditCustomers !== 1 ? 's' : ''}`}</p>
              {!dashLoading && Number(d.creditInternalOwed) > 0 && (
                <p className="text-[10px] text-slate-400 mt-0.5">+ {formatRs(d.creditInternalOwed || 0)} with the workshop — not chased</p>
              )}
            </button>
            <button
              onClick={() => onNavigate('suppliers')}
              className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-orange-300 transition-colors"
            >
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">We Owe Suppliers</p>
              <p className={`text-2xl font-black mt-1 leading-tight ${d.payables.overdueCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
                {num(formatRs(d.payables.due))}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {dashLoading ? 'Loading' : d.payables.overdueCount > 0 ? `${d.payables.overdueCount} overdue` : 'on track'}
              </p>
            </button>
          </>
        )}
      </div>

      {/* ── Today's activity ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Today's activity</h3>
          <button onClick={() => onNavigate('sales')} className="text-xs font-semibold text-orange-500 hover:text-orange-600">
            View all →
          </button>
        </div>
        {dashLoading ? (
          <div className="py-6 text-center"><p className="text-sm text-slate-400">Loading today's sales…</p></div>
        ) : d.recentActivity.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-slate-400">No sales yet today.</p>
            <button onClick={() => onNavigate('pos')} className="mt-2 text-sm font-bold text-green-600 hover:text-green-700">
              Start a sale →
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {d.recentActivity.map((s, i) => (
              <div key={i} className="flex items-center gap-3 py-2.5">
                <span className="text-xs text-slate-400 w-16 shrink-0 tabular-nums">{fmtTime(s.time)}</span>
                <span className="flex-1 text-sm font-semibold text-slate-800 truncate">{s.customer}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 shrink-0">
                  {METHOD_LABEL[s.method] || s.method}
                </span>
                <span className="text-sm font-black text-slate-900 w-24 text-right shrink-0 tabular-nums">{formatRs(s.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Catalog snapshot (muted, reference — owner/manager) ─────────────── */}
      {seesMoney && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { v: stats.totalProducts.toLocaleString(), l: 'Products' },
            { v: stats.activeProducts.toLocaleString(), l: 'Active' },
            { v: stats.totalStock.toLocaleString(), l: 'Stock Units' },
            { v: formatRs(stats.stockValue), l: 'Stock Value' },
          ].map((c) => (
            <div key={c.l} className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2.5">
              <p className="text-base font-black text-slate-600 leading-tight truncate">{c.v}</p>
              <p className="text-[11px] font-semibold text-slate-400">{c.l}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Flow popups — everything happens here, no page-hopping ─────────── */}
      {popup?.kind === 'open' && (
        <OpenDrawerModal onClose={closePopup} onSaved={popupSaved} showToast={showToast} />
      )}
      {popup?.kind === 'close' && flowSession && (
        <CloseDrawerModal session={flowSession} onClose={closePopup} onSaved={popupSaved} showToast={showToast} />
      )}
      {popup?.kind === 'att' && (
        <AttendanceModal onClose={closePopup} showToast={showToast}
          onSaved={(marked, total) => { setAttToday({ marked, total }); setPopup(null) }} />
      )}
      {popup?.kind === 'chooser' && (
        <Modal
          title={`${formatRs(popup.amount)} — ${popup.dir === 'in' ? 'who is paying you?' : 'who are you paying?'}`}
          onClose={closePopup}
        >
          <div className="space-y-1.5">
            {(popup.dir === 'in'
              ? [
                  { icon: 'spark', title: 'Service income', sub: 'quick job, no invoice — Proprietor', dest: 'income' },
                  { icon: 'card', title: 'Customer credit', sub: 'settling what they owe', dest: 'credit' },
                  { icon: 'user', title: 'From owner', sub: 'own money into the till', dest: 'owner_in' },
                  { icon: 'bank', title: 'From bank', sub: 'drawn for the float', dest: 'bank_in' },
                ]
              : [
                  { icon: 'receipt', title: 'Bills & expenses', sub: 'electricity, grocery, transport', dest: 'expense' },
                  { icon: 'factory', title: 'Supplier', sub: 'pick the bill you are paying', dest: 'supplier' },
                  { icon: 'wallet', title: 'Staff advance', sub: 'cash before payday', dest: 'advance' },
                  { icon: 'bankout', title: 'Banking & drawings', sub: 'cash leaving the till', dest: 'move_out' },
                ]
            ).map(r => (
              <button
                key={r.dest}
                disabled={destBlocked(r.dest)}
                onClick={() => openDest(r.dest, popup.amount)}
                className={`group w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-colors ${
                  destBlocked(r.dest) ? 'border-slate-200 opacity-45 cursor-not-allowed'
                    : popup.dir === 'in' ? 'border-slate-200 hover:border-emerald-400 hover:bg-emerald-50'
                    : 'border-slate-200 hover:border-red-300 hover:bg-red-50'
                }`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                  destBlocked(r.dest) ? 'bg-slate-100 text-slate-400'
                    : popup.dir === 'in' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'
                }`}>
                  <ActionIcon name={r.icon} />
                </span>
                <span className="leading-tight">
                  <span className="block text-[13px] font-bold text-slate-800">{r.title}</span>
                  <span className="block text-[11px] text-slate-400">
                    {destBlocked(r.dest) ? destBlockedWhy(r.dest) : r.sub}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {popup?.kind === 'income' && (
        <QuickIncomeModal onClose={closePopup} onSaved={popupSaved} showToast={showToast} initialAmount={popup.amount} />
      )}
      {popup?.kind === 'movement' && (
        <MovementModal onClose={closePopup} onSaved={popupSaved} showToast={showToast}
          initialDir={popup.dir} initialType={popup.type} initialAmount={popup.amount}
          drawerExpected={flowSession?.live_expected ?? null} />
      )}
      {popup?.kind === 'advance' && (
        <AdvanceModal onClose={closePopup} onSaved={popupSaved} showToast={showToast} initialAmount={popup.amount} />
      )}
      {popup?.kind === 'paysupplier' && (
        <SupplierPayModal amount={popup.amount} onClose={closePopup} onSaved={popupSaved} showToast={showToast} />
      )}
      {popup?.kind === 'collect' && (
        <CustomerCollectModal amount={popup.amount} onClose={closePopup} onSaved={popupSaved} showToast={showToast} />
      )}
      {popup?.kind === 'expense' && (
        <ExpenseModal onClose={closePopup} onSaved={popupSaved} showToast={showToast}
          initialAmount={popup.amount}
          openSessionId={sessOpen && flowSession?.id ? flowSession.id : null} />
      )}
    </div>
  )
}
