'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// Stock count reminder (owner, 2026-10-13): every staff login sees it while
// the shop is below its goal (countRules().goalPct) of stock confirmed within the
// shop's window (countRules: WHEEL MART 30 days, Sakura 90). No dismiss button, by the owner's choice — it clears only
// by counting. The dashboard shows the card; every other tab the one-line
// strip. Cashiers (POS only) see it without a "count" action they can't open.
// Rules: src/lib/countCoverage.ts.
import { useMemo } from 'react'
import {
  coverageSummary, coverageByLocation, dueStop, countAgeStops, isCountable, isConfirmed, countAgeDays, lastCountedLabel,
  type CountAge, type CountRules, type LocationFilter,
} from '@/lib/countCoverage'

type Props = {
  products: any[]
  rules: CountRules
  variant: 'card' | 'strip'
  canCount: boolean
  onCount?: (filter: LocationFilter | null, age: CountAge) => void
  onCoverage?: () => void
  // When this few items are due, the card lists them by name (WHEEL MART: 10,
  // owner 2026-10-23); tapping one opens it on Browse & Count.
  listUpTo?: number
  onOpenItem?: (p: any) => void
  // Just the figures: no Start-here list, no buttons, no footer (Sakura's
  // dashboard — owner, 2026-10-23: staff count from the Stock tab)
  minimal?: boolean
}

export default function CountReminder({ products, rules, variant, canCount, onCount, onCoverage, listUpTo, onOpenItem, minimal = false }: Props) {
  const sum = useMemo(() => coverageSummary(products, rules), [products, rules])
  const top = useMemo(() => (variant === 'card' && sum.remind ? coverageByLocation(products, rules.windowDays).filter(r => r.notConfirmed > 0).slice(0, 3) : []), [products, rules, variant, sum.remind])
  const dueItems = useMemo(() => {
    if (variant !== 'card' || !listUpTo || !sum.remind) return null
    const now = Date.now()
    const list = products.filter(p => isCountable(p) && !isConfirmed(p, rules.windowDays, now))
    return list.length > 0 && list.length <= listUpTo ? list.sort((a, b) => countAgeDays(b, now) - countAgeDays(a, now)) : null
  }, [products, rules, variant, listUpTo, sum.remind])
  if (!sum.remind) return null
  const due = dueStop(rules)
  const windowDays = rules.windowDays
  // How long the waiting items have waited, along the shop's stops
  const tiles: [string, number, boolean][] = sum.bands.map(b => [b.label, b.n, b.oldest])
  const pct = Math.round(sum.pctNotConfirmed)
  const goal = rules.goalPct

  if (variant === 'strip') {
    const text = (
      <>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
        <span className="flex-1 text-[13px] leading-snug text-amber-900"><b>{pct}% of stock not confirmed</b> in {windowDays} days{canCount ? '' : ' — please help count when you can'}</span>
      </>
    )
    return canCount && onCount ? (
      <button type="button" onClick={() => onCount(null, due)}
        className="w-full flex items-center gap-2.5 min-h-12 px-4 py-2 mb-4 rounded-xl bg-amber-100 border border-amber-300 text-left active:bg-amber-200">
        {text}<span className="text-[13px] font-black text-orange-700 whitespace-nowrap">Count now</span>
      </button>
    ) : (
      <div role="status" className="flex items-center gap-2.5 min-h-12 px-4 py-2 mb-4 rounded-xl bg-amber-100 border border-amber-300">{text}</div>
    )
  }

  // Figures-only card (Sakura's dashboard) is an ALARM, not a note (owner,
  // 2026-10-23: "make it more alarming"): red, the waiting count huge, what is
  // still needed for the goal. The icon pulses only for motion-OK devices.
  if (minimal) {
    const goalItems = Math.ceil(sum.total * goal / 100)
    const need = Math.max(0, goalItems - (sum.total - sum.notConfirmed))
    return (
      <section role="alert" aria-label="Stock count overdue"
        className="bg-red-50 border-[3px] border-red-600 rounded-2xl p-4 sm:p-5 mb-5 space-y-4 shadow-[0_0_0_5px_rgba(220,38,38,0.12)]">
        <div className="flex gap-3 items-center">
          <div className="w-12 h-12 shrink-0 rounded-full bg-red-600 flex items-center justify-center motion-safe:animate-pulse">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-black text-red-700 uppercase tracking-wide leading-tight">Stock check overdue</h2>
            <p className="text-sm font-bold text-red-900">Only {sum.pctConfirmed}% confirmed — goal {goal}%</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <p className="text-5xl sm:text-6xl font-black text-red-700 tabular-nums leading-none">{sum.notConfirmed.toLocaleString()}</p>
          <p className="text-base font-black text-red-900 leading-tight pb-1">items NOT confirmed<br />in the last {windowDays} days ({pct}%)</p>
        </div>

        <div>
          <div className="relative h-4 rounded-full bg-red-200 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-emerald-700 rounded-full" style={{ width: `${sum.pctConfirmed}%` }} />
            <div className="absolute inset-y-0 w-1 bg-red-950" style={{ left: `${goal}%` }} />
          </div>
          <div className="flex justify-between text-xs font-black text-red-900 mt-1.5">
            <span>{sum.pctConfirmed}% confirmed</span><span>Goal {goal}%</span>
          </div>
        </div>

        {need > 0 && (
          <p className="bg-white border-2 border-red-300 rounded-xl px-3 py-2.5 text-sm sm:text-base font-bold text-red-900">
            <b className="text-red-700 text-lg">{need.toLocaleString()}</b> more items must be counted to reach {goal}%.
          </p>
        )}

        <div className={`grid gap-2 ${tiles.length === 3 ? 'grid-cols-3' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {tiles.map(([l, n]) => (
            <div key={l as string} className="bg-white border border-red-200 rounded-xl px-2.5 py-2">
              <p className="text-xl font-black tabular-nums text-red-700">{(n as number).toLocaleString()}</p>
              <p className="text-xs text-slate-700">not counted for {l as string}</p>
            </div>
          ))}
        </div>
        <p className="text-xs font-semibold text-red-900 -mt-1">
          Together <b>{sum.notConfirmed.toLocaleString()}</b> — the same as “{countAgeStops(rules).find(s => s.v === due)?.label}” on Browse &amp; Count.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Stock count reminder" className="bg-amber-50 border-2 border-amber-500 rounded-2xl p-4 mb-5 space-y-3.5">
      <div className="flex gap-3 items-start">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-amber-500 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        </div>
        <div>
          <h2 className="text-lg font-black text-amber-950">Stock check overdue</h2>
          <p className="text-sm leading-snug text-amber-950"><b>{pct}%</b> of items in stock ({sum.notConfirmed.toLocaleString()} of {sum.total.toLocaleString()}) have not been confirmed in the last {windowDays} days.</p>
        </div>
      </div>

      <div>
        <div className="relative h-3 rounded-full bg-amber-200 overflow-hidden">
          <div className="absolute inset-y-0 left-0 bg-emerald-700 rounded-full" style={{ width: `${sum.pctConfirmed}%` }} />
          <div className="absolute -inset-y-0.5 w-0.5 bg-amber-950" style={{ left: `${goal}%` }} />
        </div>
        <div className="flex justify-between text-xs font-bold text-amber-950 mt-1.5">
          <span>{sum.pctConfirmed}% confirmed</span><span>Goal: {goal}% confirmed</span>
        </div>
      </div>

      <div className={`grid gap-2 ${tiles.length === 3 ? 'grid-cols-3' : tiles.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {tiles.map(([l, n, red]) => (
          <div key={l as string} className="bg-white rounded-xl px-2.5 py-2">
            <p className={`text-xl font-black tabular-nums ${red ? 'text-red-700' : 'text-slate-900'}`}>{(n as number).toLocaleString()}</p>
            <p className="text-xs text-slate-600">not counted for {l as string}</p>
          </div>
        ))}
      </div>
      {/* The boxes are separate slices; Browse & Count's stops each include
          everything older — say how they meet (owner, 2026-10-23) */}
      <p className="text-xs text-amber-900 -mt-1">
        Together <b>{sum.notConfirmed.toLocaleString()}</b> — the same as “{countAgeStops(rules).find(s => s.v === due)?.label}” on Browse &amp; Count.
      </p>

      {canCount && !minimal && dueItems && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-black tracking-wider text-amber-800">{dueItems.length === 1 ? 'THE ITEM TO COUNT' : `THE ${dueItems.length} ITEMS TO COUNT`}</p>
          {dueItems.map(p => {
            const where = [p.loc_store, p.loc_floor, p.loc_sub1, p.loc_sub2].filter(Boolean).join(' › ')
            return (
              <button key={p.id} type="button" onClick={() => onOpenItem?.(p)}
                className="w-full text-left min-h-11 px-3 py-2 bg-white rounded-lg active:bg-orange-50 flex items-center gap-3">
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-bold text-slate-900 leading-tight">{p.name}</span>
                  <span className="block text-[11px] text-slate-500 mt-0.5"><span className="font-mono">{p.sku}</span> · {where ? `📍 ${where}` : 'No location'} · qty {Number(p.quantity) || 0}</span>
                </span>
                <span className="shrink-0 text-[11px] font-bold text-red-700 text-right">{lastCountedLabel(p)}</span>
              </button>
            )
          })}
        </div>
      )}

      {canCount && !minimal && !dueItems && top.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-black tracking-wider text-amber-800">START HERE</p>
          {top.map(r => (
            <button key={r.key} type="button" onClick={() => onCount?.(r.filter, due)}
              className="w-full flex justify-between items-center min-h-11 px-3 bg-white rounded-lg text-sm text-slate-900 active:bg-orange-50">
              <span className="text-left">{r.label}</span><b className="tabular-nums">{r.notConfirmed.toLocaleString()}</b>
            </button>
          ))}
        </div>
      )}

      {minimal ? null : canCount ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => onCount?.(null, due)} className="flex-[1.4] min-h-12 rounded-xl bg-orange-700 active:bg-orange-800 text-white font-black text-[15px]">Start counting</button>
          <button type="button" onClick={onCoverage} className="flex-1 min-h-12 rounded-xl border-2 border-amber-500 bg-white text-amber-950 font-bold text-sm active:bg-amber-100">By location</button>
        </div>
      ) : (
        <p className="text-sm text-amber-950">Ask a manager to plan a count — counting is done from the Stock tab.</p>
      )}
      {!minimal && <p className="text-xs text-amber-800">{rules.goalPct >= 100 ? 'Shows for every staff member until every item in stock is confirmed.' : `Shows for every staff member while more than ${100 - rules.goalPct}% of stock is not confirmed.`}</p>}
    </section>
  )
}
