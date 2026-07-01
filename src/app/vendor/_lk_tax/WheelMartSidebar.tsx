'use client'
// ── WHEEL MART ONLY — never import this from _standard/ ──────────────────────
import { useState } from 'react'

type LkTaxTab = 'overview' | 'products' | 'add' | 'bulk' | 'pos' | 'sales' | 'credit' | 'receivables' | 'stocktake' | 'suppliers' | 'supplier-returns' | 'writeoffs' | 'fleet' | 'cash' | 'reports' | 'settings'

type NavItem = {
  id: LkTaxTab | '_signout' | '_coming'
  icon: string
  label: string
  badge?: string
  badgeType?: 'red' | 'amber'
  comingSoon?: boolean
  isPOS?: boolean
}

type NavSection = {
  label?: string
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    items: [
      { id: 'overview',  icon: '🏠', label: 'Dashboard' },
    ],
  },
  {
    items: [
      { id: 'pos', icon: '🛒', label: 'POS', isPOS: true },
    ],
  },
  {
    label: 'SELL',
    items: [
      { id: 'sales',       icon: '📋', label: 'Sales & Invoices' },
      { id: 'credit',      icon: '📝', label: 'Credit Notes' },
      { id: '_coming',     icon: '📅', label: 'Appointments', comingSoon: true },
    ],
  },
  {
    label: 'INVENTORY',
    items: [
      { id: 'products',   icon: '📦', label: 'Products' },
      { id: 'add',        icon: '➕', label: 'Add Product' },
      { id: 'bulk',       icon: '📤', label: 'Bulk Upload' },
      { id: 'stocktake',  icon: '📥', label: 'Stock / GRN / Transfer' },
      { id: 'writeoffs',  icon: '✏️', label: 'Write-offs' },
    ],
  },
  {
    label: 'SUPPLIERS',
    items: [
      { id: 'suppliers', icon: '🏭', label: 'Suppliers & Payables' },
      { id: 'supplier-returns', icon: '↩️', label: 'Supplier Returns' },
    ],
  },
  {
    label: 'CUSTOMERS',
    items: [
      { id: 'receivables', icon: '💰', label: 'Receivables' },
      { id: '_coming',     icon: '👥', label: 'Customers',       comingSoon: true },
      { id: 'fleet',       icon: '🚗', label: 'Fleet & Vehicles' },
    ],
  },
  {
    label: 'FINANCE',
    items: [
      { id: 'cash',    icon: '💵', label: 'Cash & Expenses' },
      { id: 'reports',  icon: '📊', label: 'Reports' },
    ],
  },
]

const BOTTOM_ITEMS: NavItem[] = [
  { id: 'settings',  icon: '⚙️',  label: 'Settings' },
  { id: '_signout',  icon: '🚪',  label: 'Log Out' },
]

export type { LkTaxTab }

type Props = {
  tab: LkTaxTab
  onTabChange: (t: LkTaxTab) => void
  vendorName: string
  staffRole: string
  onSignOut: () => void
}

export default function WheelMartSidebar({ tab, onTabChange, vendorName, staffRole, onSignOut }: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const w = collapsed ? 56 : 220

  function handleItem(item: NavItem) {
    if (item.comingSoon || item.id === '_coming') return
    if (item.id === '_signout') { onSignOut(); return }
    onTabChange(item.id as LkTaxTab)
  }

  const roleLabel = staffRole === 'owner' ? 'Owner' : staffRole === 'manager' ? 'Manager' : staffRole === 'cashier' ? 'Cashier' : staffRole

  // Role gating: cashier → POS only; manager → everything except Settings; owner → all.
  const canSee = (item: NavItem) => {
    if (item.id === '_signout') return true
    if (staffRole === 'cashier') return item.id === 'pos'
    if (staffRole === 'manager') return item.id !== 'settings'
    return true
  }

  return (
    <aside
      className="fixed top-0 left-0 h-screen flex flex-col z-40 overflow-y-auto overflow-x-hidden transition-all duration-200"
      style={{ width: w, background: '#0f172a' }}
    >
      {/* Shop header */}
      <div className="flex items-center gap-2 px-3 py-4 border-b border-slate-700/60 shrink-0">
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <div className="text-orange-400 font-black text-sm leading-tight truncate">WHEEL MART</div>
            <div className="text-slate-400 text-[10px] leading-tight truncate">MacForce Auto Engineering</div>
          </div>
        )}
        {collapsed && <div className="text-orange-400 text-base mx-auto">🔧</div>}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="shrink-0 text-slate-400 hover:text-white transition-colors p-1 rounded hover:bg-slate-700/60"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            {collapsed
              ? <path d="M9 18l6-6-6-6" />
              : <path d="M15 18l-6-6 6-6" />
            }
          </svg>
        </button>
      </div>

      {/* Staff info */}
      {!collapsed ? (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-700/40 shrink-0">
          <div className="w-6 h-6 rounded-full bg-orange-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
            {vendorName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-slate-300 text-xs font-medium truncate">{vendorName.split(' ')[0]}</div>
            <div className="text-slate-500 text-[10px] capitalize truncate">{roleLabel}</div>
          </div>
        </div>
      ) : (
        <div className="flex justify-center py-2.5 border-b border-slate-700/40 shrink-0">
          <div className="w-7 h-7 rounded-full bg-orange-500 flex items-center justify-center text-white text-xs font-bold">
            {vendorName.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Nav sections */}
      <nav className="flex-1 py-1.5 overflow-y-auto overflow-x-hidden">
        {NAV_SECTIONS.map((section, si) => {
          const visibleItems = section.items.filter(canSee)
          if (visibleItems.length === 0) return null
          return (
          <div key={si} className="mb-0.5">
            {section.label && !collapsed && (
              <div className="px-3 pt-3 pb-1 text-[10px] font-semibold tracking-widest text-slate-500 uppercase select-none">
                {section.label}
              </div>
            )}
            {section.label && collapsed && (
              <div className="mx-3 my-1.5 h-px bg-slate-700/50" />
            )}

            {visibleItems.map((item, ii) => {
              const isActive = !item.comingSoon && item.id !== '_coming' && item.id !== '_signout' && tab === item.id

              if (item.isPOS) {
                return (
                  <div key={ii} className={`px-2 py-1 ${collapsed ? 'flex justify-center' : ''}`}>
                    <button
                      onClick={() => handleItem(item)}
                      className={`flex items-center gap-2 rounded-md font-semibold text-[13px] transition-all ${
                        collapsed ? 'w-9 h-9 justify-center' : 'w-full px-3 py-2.5'
                      } ${tab === 'pos'
                        ? 'bg-green-600 text-white shadow-lg shadow-green-900/40'
                        : 'bg-green-500 text-white hover:bg-green-400 shadow-md shadow-green-900/30'
                      }`}
                    >
                      <span className="text-sm shrink-0">{item.icon}</span>
                      {!collapsed && <span>{item.label}</span>}
                    </button>
                  </div>
                )
              }

              return (
                <button
                  key={ii}
                  onClick={() => handleItem(item)}
                  disabled={item.comingSoon}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center text-left transition-colors min-h-[44px] border-l-[3px] ${
                    collapsed ? 'justify-center px-0 gap-0' : 'gap-2.5 px-3'
                  } ${item.comingSoon
                    ? 'opacity-40 cursor-not-allowed border-transparent text-slate-400'
                    : isActive
                      ? 'text-white border-orange-500'
                      : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
                  }`}
                  style={isActive ? { background: '#1e293b' } : {}}
                >
                  <span className="text-sm shrink-0">{item.icon}</span>
                  {!collapsed && (
                    <>
                      <span className="text-[13px] flex-1 truncate leading-snug">{item.label}</span>
                      {item.badge && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${
                          item.badgeType === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {item.badge}
                        </span>
                      )}
                      {item.comingSoon && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-500 font-medium shrink-0 leading-none">
                          SOON
                        </span>
                      )}
                    </>
                  )}
                </button>
              )
            })}
          </div>
          )
        })}
      </nav>

      {/* Bottom items */}
      <div className="border-t border-slate-700/60 py-1 shrink-0">
        {BOTTOM_ITEMS.filter(canSee).map((item) => {
          const isActive = item.id !== '_signout' && tab === item.id
          return (
            <button
              key={item.id}
              onClick={() => handleItem(item)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center text-left transition-colors min-h-[44px] border-l-[3px] ${
                collapsed ? 'justify-center px-0 gap-0' : 'gap-2.5 px-3'
              } ${isActive
                ? 'text-white border-orange-500'
                : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-slate-800/50'
              }`}
              style={isActive ? { background: '#1e293b' } : {}}
            >
              <span className="text-sm shrink-0">{item.icon}</span>
              {!collapsed && <span className="text-[13px]">{item.label}</span>}
            </button>
          )
        })}
      </div>
    </aside>
  )
}
