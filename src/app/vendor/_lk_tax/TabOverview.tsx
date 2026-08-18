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

function ActionIcon({ name }: { name: string }) {
  const P = { width: 17, height: 17, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'card': return <svg {...P}><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
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

      {/* ── Money in · Money out · Stock ─────────────────────────────────────
          One quiet surface, three columns, rows instead of tile soup. Every
          row answers exactly its column's question; the in/out/goods split is
          carried by a coloured dot and the icon tint, not by shouting boxes. */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm mb-5 grid grid-cols-1 lg:grid-cols-[3fr_4fr_2fr] divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
        {([
          {
            dot: 'bg-emerald-500', title: 'Money in', q: 'who is paying you?',
            tint: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100',
            rows: [
              { icon: 'card', title: 'Customer credit', sub: 'settling what they owe', tab: 'receivables', tabSub: undefined },
              { icon: 'user', title: 'From owner', sub: 'own money into the till', tab: 'cash', tabSub: 'movement-in' },
              { icon: 'bank', title: 'From bank', sub: 'drawn for the float', tab: 'cash', tabSub: 'movement-in' },
            ],
          },
          {
            dot: 'bg-orange-500', title: 'Money out', q: 'who are you paying?',
            tint: 'bg-orange-50 text-orange-600 group-hover:bg-orange-100',
            rows: [
              { icon: 'receipt', title: 'Bills & expenses', sub: 'electricity, grocery, transport', tab: 'cash', tabSub: 'add-expense' },
              { icon: 'factory', title: 'Supplier', sub: 'money we owe for stock', tab: 'suppliers', tabSub: undefined },
              { icon: 'wallet', title: 'Staff advance', sub: 'cash before payday', tab: 'cash', tabSub: 'advance' },
              { icon: 'bankout', title: 'Banking & drawings', sub: 'cash leaving the till', tab: 'cash', tabSub: 'movement-out' },
            ],
          },
          {
            dot: 'bg-sky-500', title: 'Stock', q: 'goods moving', 
            tint: 'bg-sky-50 text-sky-600 group-hover:bg-sky-100',
            rows: [
              { icon: 'boxin', title: 'Stock arrived', sub: 'GRN — payment asked at the end', tab: 'stocktake', tabSub: 'receive' },
              { icon: 'ship', title: 'Container', sub: 'Cusdec + import VAT', tab: 'imports', tabSub: undefined },
            ],
          },
        ] as const).map(col => (
          <div key={col.title} className="py-2">
            <div className="flex items-baseline gap-2 px-4 pt-2 pb-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${col.dot} self-center`} />
              <span className="text-[12px] font-bold text-slate-800 tracking-tight">{col.title}</span>
              <span className="text-[11px] text-slate-400">{col.q}</span>
            </div>
            <div>
              {col.rows.map(r => (
                <button
                  key={r.title}
                  onClick={() => onNavigate(r.tab, r.tabSub)}
                  className="group w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-slate-50 transition-colors duration-150"
                >
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-150 ${col.tint}`}>
                    <ActionIcon name={r.icon} />
                  </span>
                  <span className="flex-1 min-w-0 leading-tight">
                    <span className="block text-[13px] font-semibold text-slate-800">{r.title}</span>
                    <span className="block text-[11px] text-slate-400 truncate">{r.sub}</span>
                  </span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="text-slate-300 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 shrink-0">
                    <path d="M9 18l6-6-6-6" />
                  </svg>
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
