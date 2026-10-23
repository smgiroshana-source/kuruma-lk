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
  coverageSummary, coverageByLocation, dueStop,
  type CountAge, type CountRules, type LocationFilter,
} from '@/lib/countCoverage'

type Props = {
  products: any[]
  rules: CountRules
  variant: 'card' | 'strip'
  canCount: boolean
  onCount?: (filter: LocationFilter | null, age: CountAge) => void
  onCoverage?: () => void
}

export default function CountReminder({ products, rules, variant, canCount, onCount, onCoverage }: Props) {
  const sum = useMemo(() => coverageSummary(products, rules), [products, rules])
  const top = useMemo(() => (variant === 'card' && sum.remind ? coverageByLocation(products, rules.windowDays).filter(r => r.notConfirmed > 0).slice(0, 3) : []), [products, rules, variant, sum.remind])
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
            <p className="text-xs text-slate-600">{l as string}</p>
          </div>
        ))}
      </div>

      {canCount && top.length > 0 && (
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

      {canCount ? (
        <div className="flex gap-2">
          <button type="button" onClick={() => onCount?.(null, due)} className="flex-[1.4] min-h-12 rounded-xl bg-orange-700 active:bg-orange-800 text-white font-black text-[15px]">Start counting</button>
          <button type="button" onClick={onCoverage} className="flex-1 min-h-12 rounded-xl border-2 border-amber-500 bg-white text-amber-950 font-bold text-sm active:bg-amber-100">By location</button>
        </div>
      ) : (
        <p className="text-sm text-amber-950">Ask a manager to plan a count — counting is done from the Stock tab.</p>
      )}
      <p className="text-xs text-amber-800">Shows for every staff member while more than {100 - rules.goalPct}% of stock is not confirmed.</p>
    </section>
  )
}
