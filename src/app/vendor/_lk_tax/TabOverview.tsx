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

type Dashboard = {
  todaySales: number
  todayCount: number
  cashSession: { status: string; expected: number; openedAt?: string | null } | null
  staleOpenSessionDate?: string | null
  attendance?: { marked: number; total: number }
  creditOwed: number
  creditCustomers: number
  creditOldestDays?: number
  creditOldestName?: string
  payables: { due: number; overdueCount: number; oldestDays: number }
  grnDrafts: number
  recentActivity: { time: string; customer: string; amount: number; method: string }[]
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
}

export default function TabOverview({ vendor, stats, dashboard, staffRole, products, onNavigate }: Props) {
  const role = staffRole || 'owner'
  const isCashier = role === 'cashier'
  const seesMoney = role === 'owner' || role === 'manager'

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

  // ── Today's flow steps ──
  const hour = colomboHour()
  const sess = d.cashSession
  const flow: FlowStep[] = []
  flow.push(
    !sess
      ? { key: 'open', icon: '🗄️', title: 'Open the drawer', sub: 'Start the cash session', state: 'now', tab: 'cash' }
      : { key: 'open', icon: '🗄️', title: 'Drawer opened', sub: sess.openedAt ? `at ${fmtTime(sess.openedAt)}` : 'session running', state: 'done', tab: 'cash' }
  )
  if (!isCashier && (d.attendance?.total || 0) > 0) {
    const a = d.attendance!
    flow.push(
      a.marked >= a.total
        ? { key: 'att', icon: '🧑‍🔧', title: 'Attendance marked', sub: `${a.marked}/${a.total} staff`, state: 'done', tab: 'staff', tabSub: 'attendance' }
        : { key: 'att', icon: '🧑‍🔧', title: `Attendance ${a.marked}/${a.total}`, sub: a.marked === 0 ? 'Mark today’s staff' : 'Finish marking', state: 'now', tab: 'staff', tabSub: 'attendance' }
    )
  }
  flow.push(
    sess?.status === 'closed'
      ? { key: 'close', icon: '💵', title: 'Drawer closed', sub: 'Counted and reconciled', state: 'done', tab: 'cash' }
      : sess && hour >= 17
        ? { key: 'close', icon: '💵', title: 'Count and close', sub: 'End-of-day cash count', state: 'now', tab: 'cash' }
        : { key: 'close', icon: '💵', title: 'Count and close', sub: 'this evening', state: 'later', tab: 'cash' }
  )
  if (!isCashier) {
    flow.push(
      sess?.status === 'closed'
        ? { key: 'report', icon: '📄', title: 'Send daily report', sub: 'PDF for the owner', state: 'now', tab: 'reports' }
        : { key: 'report', icon: '📄', title: 'Daily report', sub: 'after the drawer closes', state: 'later', tab: 'reports' }
    )
  }
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
    if (d.grnDrafts > 0) {
      attention.push({
        icon: '📥', tone: 'amber',
        text: `${d.grnDrafts} stock receipt${d.grnDrafts !== 1 ? 's' : ''} (GRN) not yet posted`,
        cta: 'Post', tab: 'stocktake', sub: 'history',
      })
    }
    attention.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'red' ? -1 : 1))
  }

  // ── Quick actions (role-trimmed) ──
  type Action = { icon: string; label: string; tab: string; sub?: string }
  const primaryActions: Action[] = isCashier
    ? [
        { icon: '💰', label: 'Receive Payment', tab: 'receivables' },
        { icon: '🧾', label: 'Add Expense', tab: 'cash', sub: 'add-expense' },
        { icon: '📥', label: 'GRN — Receive Stock', tab: 'stocktake', sub: 'receive' },
        { icon: '🏭', label: 'Pay Supplier', tab: 'suppliers' },
        { icon: '💵', label: 'Cash Reconcile', tab: 'cash' },
      ]
    : [
        { icon: '💰', label: 'Receive Payment', tab: 'receivables' },
        { icon: '🧾', label: 'Add Expense', tab: 'cash', sub: 'add-expense' },
        { icon: '📥', label: 'GRN — Receive Stock', tab: 'stocktake', sub: 'receive' },
        { icon: '🧑‍🔧', label: 'Attendance', tab: 'staff', sub: 'attendance' },
        { icon: '💸', label: 'Staff Advance', tab: 'staff', sub: 'advances' },
        { icon: '🏭', label: 'Pay Supplier', tab: 'suppliers' },
      ]

  const secondary: Action[] = isCashier ? [] : [
    { icon: '➕', label: 'Add Product', tab: 'add' },
    { icon: '📦', label: 'Stock Count', tab: 'stocktake' },
    { icon: '🚢', label: 'Import Shipment', tab: 'imports' },
    { icon: '🔀', label: 'Transfer Stock', tab: 'stocktake', sub: 'transfer' },
    { icon: '📝', label: 'Credit Note', tab: 'credit' },
    { icon: '📄', label: 'Daily Report', tab: 'reports' },
    { icon: '💵', label: 'Cash Reconcile', tab: 'cash' },
  ]

  const cashState =
    dashLoading ? { label: '…', sub: 'Loading', tone: 'slate' as const }
    : !sess ? { label: 'No session', sub: 'Open the drawer', tone: 'amber' as const }
    : sess.status === 'open' ? { label: 'Open', sub: `Float ${formatRs(sess.expected)}`, tone: 'green' as const }
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
              onClick={() => step.tab && onNavigate(step.tab, step.tabSub)}
              disabled={dashLoading}
              className={`text-left rounded-xl border-2 px-3.5 py-3 transition-colors ${
                dashLoading ? 'border-slate-100 bg-slate-50 opacity-60' :
                step.state === 'done' ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300' :
                step.state === 'now' ? 'border-amber-300 bg-amber-50 hover:border-amber-400 animate-[pulse_3s_ease-in-out_infinite]' :
                'border-slate-100 bg-slate-50 hover:border-slate-200'
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

      {/* ── Quick actions ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
        <h3 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3">Quick actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {primaryActions.map((a) => (
            <button
              key={a.label}
              onClick={() => onNavigate(a.tab, a.sub)}
              className="flex items-center gap-2.5 px-3.5 py-3.5 rounded-xl font-bold text-[13px] bg-white hover:bg-orange-50 border-2 border-slate-200 hover:border-orange-300 text-slate-800 transition-colors"
            >
              <span className="text-lg leading-none">{a.icon}</span>
              <span className="text-left leading-tight">{a.label}</span>
            </button>
          ))}
        </div>
        {secondary.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-slate-100">
            {secondary.map((a) => (
              <button
                key={a.label}
                onClick={() => onNavigate(a.tab, a.sub)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-slate-500 bg-slate-50 hover:bg-slate-100 hover:text-slate-700 transition-colors"
              >
                <span className="text-sm leading-none">{a.icon}</span>
                <span>{a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

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
    </div>
  )
}
