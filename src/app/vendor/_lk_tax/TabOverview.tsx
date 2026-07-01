'use client'
// ── WHEEL MART ONLY — operator-first dashboard. Never import from _standard/ ──

type Dashboard = {
  todaySales: number
  todayCount: number
  cashSession: { status: string; expected: number } | null
  creditOwed: number
  creditCustomers: number
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
  onNavigate: (tab: string) => void
  showToast: (msg: string) => void
}

function formatRs(amount: number): string {
  return 'Rs.' + Math.round(amount || 0).toLocaleString('en-LK', { maximumFractionDigits: 0 })
}

function getGreeting(): string {
  const hour = new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo', hour: 'numeric', hour12: false })
  const h = parseInt(hour, 10)
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function getTodayLabel(): string {
  return new Date().toLocaleDateString('en-LK', {
    timeZone: 'Asia/Colombo',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
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

export default function TabOverview({ vendor, stats, dashboard, products, onNavigate }: Props) {
  const d: Dashboard = dashboard || {
    todaySales: 0, todayCount: 0, cashSession: null, creditOwed: 0, creditCustomers: 0,
    payables: { due: 0, overdueCount: 0, oldestDays: 0 }, grnDrafts: 0, recentActivity: [],
  }

  // ── Needs-attention items (only show what genuinely needs action) ──
  const attention: { icon: string; tone: 'red' | 'amber'; text: string; cta: string; tab: string }[] = []
  if (d.payables.overdueCount > 0) {
    attention.push({
      icon: '🏭', tone: 'red',
      text: `${d.payables.overdueCount} supplier payment${d.payables.overdueCount !== 1 ? 's' : ''} overdue` +
            (d.payables.oldestDays > 0 ? ` — oldest ${d.payables.oldestDays} days` : ''),
      cta: 'Pay suppliers', tab: 'suppliers',
    })
  }
  if (d.grnDrafts > 0) {
    attention.push({
      icon: '📥', tone: 'amber',
      text: `${d.grnDrafts} stock receipt${d.grnDrafts !== 1 ? 's' : ''} (GRN) not yet posted`,
      cta: 'Post GRN', tab: 'stocktake',
    })
  }
  if (d.creditOwed > 0) {
    attention.push({
      icon: '📝', tone: 'amber',
      text: `${formatRs(d.creditOwed)} owed by ${d.creditCustomers} customer${d.creditCustomers !== 1 ? 's' : ''} on credit`,
      cta: 'Collect', tab: 'receivables',
    })
  }

  const cashState =
    !d.cashSession ? { label: 'No session', sub: 'Open the drawer', tone: 'amber' as const }
    : d.cashSession.status === 'open' ? { label: 'Open', sub: `Expected ${formatRs(d.cashSession.expected)}`, tone: 'green' as const }
    : { label: 'Closed', sub: 'Reconciled', tone: 'slate' as const }

  // ── 6 quick actions ──
  const actions: { icon: string; label: string; tab: string; cls: string }[] = [
    { icon: '🛒', label: 'New Sale (POS)', tab: 'pos', cls: 'bg-green-500 hover:bg-green-600 active:bg-green-700 text-white' },
    { icon: '💰', label: 'Receive Payment', tab: 'receivables', cls: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-800' },
    { icon: '📥', label: 'Receive Stock', tab: 'stocktake', cls: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-800' },
    { icon: '🏭', label: 'Pay Supplier', tab: 'suppliers', cls: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-800' },
    { icon: '➕', label: 'Add Product', tab: 'add', cls: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-800' },
    { icon: '📊', label: "Today's Report", tab: 'reports', cls: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-800' },
    { icon: '💵', label: 'Cash Reconcile', tab: 'cash', cls: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-800' },
  ]

  return (
    <div>
      {/* ── Greeting + New Sale ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">
            {getGreeting()}, <span className="text-orange-500">{vendor.name}</span>
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">{getTodayLabel()}</p>
        </div>
        <button
          onClick={() => onNavigate('pos')}
          className="self-start sm:self-auto flex items-center gap-2.5 px-6 py-3.5 rounded-xl bg-green-500 hover:bg-green-600 active:bg-green-700 text-white font-black text-base transition-colors shadow-lg shadow-green-900/20"
        >
          <span className="text-xl leading-none">🛒</span>
          <span>New Sale</span>
        </button>
      </div>

      {/* ── Pulse strip: today's money at a glance ──────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {/* Today's sales */}
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Today's Sales</p>
          <p className="text-2xl font-black text-slate-900 mt-1 leading-tight">{formatRs(d.todaySales)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{d.todayCount} sale{d.todayCount !== 1 ? 's' : ''} today</p>
        </div>

        {/* Cash drawer */}
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

        {/* Credit owed to us */}
        <button
          onClick={() => onNavigate('receivables')}
          className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-orange-300 transition-colors"
        >
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Credit Owed</p>
          <p className={`text-2xl font-black mt-1 leading-tight ${d.creditOwed > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {formatRs(d.creditOwed)}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">{d.creditCustomers} customer{d.creditCustomers !== 1 ? 's' : ''}</p>
        </button>

        {/* Payables due */}
        <button
          onClick={() => onNavigate('suppliers')}
          className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-orange-300 transition-colors"
        >
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Payables Due</p>
          <p className={`text-2xl font-black mt-1 leading-tight ${d.payables.overdueCount > 0 ? 'text-red-600' : 'text-slate-900'}`}>
            {formatRs(d.payables.due)}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            {d.payables.overdueCount > 0 ? `${d.payables.overdueCount} overdue` : 'on track'}
          </p>
        </button>
      </div>

      {/* ── Needs Attention ─────────────────────────────────────────────────── */}
      {attention.length > 0 ? (
        <div className="bg-white rounded-xl border-2 border-amber-300 p-5 mb-6">
          <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2 mb-3">
            <span>⚠️</span><span>Needs Attention</span>
            <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full">{attention.length}</span>
          </h3>
          <div className="flex flex-col gap-2">
            {attention.map((a, i) => (
              <button
                key={i}
                onClick={() => onNavigate(a.tab)}
                className={`flex items-center gap-3 text-left px-3 py-2.5 rounded-lg border transition-colors ${
                  a.tone === 'red'
                    ? 'bg-red-50 border-red-200 hover:bg-red-100'
                    : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
                }`}
              >
                <span className="text-base leading-none shrink-0">{a.icon}</span>
                <span className="flex-1 text-sm font-semibold text-slate-800">{a.text}</span>
                <span className={`text-xs font-bold shrink-0 ${a.tone === 'red' ? 'text-red-600' : 'text-amber-700'}`}>
                  {a.cta} →
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 mb-6 flex items-center gap-3">
          <span className="text-lg">✅</span>
          <span className="text-sm font-semibold text-emerald-800">All clear — no overdue payments, drafts, or outstanding credit.</span>
        </div>
      )}

      {/* ── Quick Actions ───────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="font-bold text-slate-900 mb-4 text-sm">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {actions.map((a) => (
            <button
              key={a.tab + a.label}
              onClick={() => onNavigate(a.tab)}
              className={`flex items-center gap-2.5 px-4 py-4 rounded-xl font-bold text-sm transition-colors shadow-sm ${a.cls}`}
            >
              <span className="text-xl leading-none">{a.icon}</span>
              <span className="text-left leading-tight">{a.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Today's Activity ────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-900 text-sm">Today's Activity</h3>
          <button onClick={() => onNavigate('sales')} className="text-xs font-semibold text-orange-500 hover:text-orange-600">
            View all →
          </button>
        </div>
        {d.recentActivity.length === 0 ? (
          <div className="py-8 text-center">
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

      {/* ── Catalog snapshot (muted, reference) ─────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { v: stats.totalProducts.toLocaleString(), l: 'Products' },
          { v: stats.activeProducts.toLocaleString(), l: 'Active' },
          { v: stats.totalStock.toLocaleString(), l: 'Stock Units' },
          { v: formatRs(stats.stockValue), l: 'Stock Value' },
          { v: formatRs(stats.totalSales), l: 'All-time Sales' },
        ].map((c) => (
          <div key={c.l} className="bg-slate-50 rounded-lg border border-slate-100 px-3 py-2.5">
            <p className="text-base font-black text-slate-600 leading-tight truncate">{c.v}</p>
            <p className="text-[11px] font-semibold text-slate-400">{c.l}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
