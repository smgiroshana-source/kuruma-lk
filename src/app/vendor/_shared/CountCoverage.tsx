'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// Count coverage by location (owner, 2026-10-13): the whole shop's confirmed %,
// then every store › floor › rack with how many items still wait, most first.
// Tapping a row opens Browse & Count on that spot, filtered to "1 mo+".
// Rules: src/lib/countCoverage.ts. Phone-first bottom sheet.
import { useEffect, useMemo } from 'react'
import {
  coverageSummary, coverageByLocation, REMIND_PCT, COUNT_WINDOW_DAYS,
  type CountAge, type LocationFilter,
} from '@/lib/countCoverage'

export default function CountCoverage({ products, onClose, onPick, canCount = true }: {
  products: any[]
  onClose: () => void
  onPick?: (filter: LocationFilter, age: CountAge) => void
  canCount?: boolean
}) {
  const sum = useMemo(() => coverageSummary(products), [products])
  const rows = useMemo(() => coverageByLocation(products), [products])
  const goal = 100 - REMIND_PCT

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Count coverage"
        className="bg-slate-50 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 bg-white border-b border-slate-200">
          <div>
            <h3 className="text-lg font-black text-slate-900">Count coverage</h3>
            <p className="text-xs text-slate-500">Confirmed = counted in the last {COUNT_WINDOW_DAYS} days</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-1 rounded-xl flex items-center justify-center text-slate-500 active:bg-slate-100">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 py-3 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-bold text-slate-600">Whole shop</span>
              <span className={`text-3xl font-black tabular-nums ${sum.remind ? 'text-red-700' : 'text-emerald-700'}`}>{sum.pctConfirmed}%</span>
            </div>
            <div className="relative h-2.5 rounded-full bg-slate-200 overflow-hidden mt-2">
              <div className="absolute inset-y-0 left-0 bg-emerald-600" style={{ width: `${sum.pctConfirmed}%` }} />
              <div className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${goal}%` }} />
            </div>
            <p className="text-xs text-slate-600 mt-2">
              {(sum.total - sum.notConfirmed).toLocaleString()} of {sum.total.toLocaleString()} confirmed · the reminder clears at {goal}%
            </p>
          </div>

          <p className="text-[11px] font-black tracking-wider text-slate-500 uppercase">By location · most to do first</p>
          {rows.length === 0 && <p className="text-sm text-slate-500 bg-white rounded-xl border border-slate-200 p-4">No stock on hand.</p>}
          <div className="space-y-2">
            {rows.map(r => {
              const pct = r.total ? Math.floor(((r.total - r.notConfirmed) / r.total) * 100) : 100
              const note = r.notConfirmed === 0 ? 'All confirmed'
                : r.neverCounted === r.notConfirmed ? 'Never counted'
                : `Oldest: ${r.oldestDays} days ago${r.neverCounted ? ` · ${r.neverCounted} never counted` : ''}`
              const body = (
                <>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm font-bold text-slate-900 text-left">{r.label}</span>
                    <span className="text-sm font-black tabular-nums whitespace-nowrap">{r.notConfirmed.toLocaleString()} <span className="font-semibold text-slate-500">/ {r.total.toLocaleString()}</span></span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden mt-1.5"><div className="h-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>
                  <span className="block text-xs text-slate-500 mt-1 text-left">{note}</span>
                </>
              )
              return canCount && onPick && r.notConfirmed > 0 ? (
                <button key={r.key} type="button" onClick={() => onPick(r.filter, '1m')}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2.5 active:bg-orange-50 active:border-orange-300">{body}</button>
              ) : (
                <div key={r.key} className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">{body}</div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
