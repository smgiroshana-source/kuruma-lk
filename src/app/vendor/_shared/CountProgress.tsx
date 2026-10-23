'use client'
// ── Shared by BOTH vendors (used by Sakura first) — keep vendor-neutral ───────
// Stock count progress for staff (owner, 2026-10-23): how many items are not
// confirmed within the shop's window (Sakura: 3 months), how close the shop is
// to its goal (countRules().goalPct), today's count — and, behind "Progress",
// the last 10 days day by day with the racks counted. Computed on the phone
// from the products already loaded: no server calls.
import { useEffect, useMemo } from 'react'
import { coverageSummary, dailyConfirmations, type CountRules } from '@/lib/countCoverage'

const monthsOf = (days: number) => Math.round(days / 30)

/** One line on Browse & Count: still to confirm, % vs goal, today, and a Progress button. */
export function CountProgressBar({ products, rules, onOpen }: { products: any[]; rules: CountRules; onOpen: () => void }) {
  const sum = useMemo(() => coverageSummary(products, rules), [products, rules])
  const today = useMemo(() => dailyConfirmations(products, 1)[0]?.count || 0, [products])
  const good = sum.pctConfirmed >= rules.goalPct
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 mb-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-700 leading-snug">
            <b className={good ? 'text-emerald-700' : 'text-red-700'}>{sum.notConfirmed.toLocaleString()}</b> items not confirmed in {monthsOf(rules.windowDays)} month{monthsOf(rules.windowDays) !== 1 ? 's' : ''}
            <span className="text-slate-400"> · </span>Today <b>{today.toLocaleString()}</b>
          </p>
          <div className="relative h-2 rounded-full bg-slate-200 overflow-hidden mt-1.5" aria-hidden="true">
            <div className={`absolute inset-y-0 left-0 ${good ? 'bg-emerald-600' : 'bg-orange-600'}`} style={{ width: `${sum.pctConfirmed}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-slate-900" style={{ left: `${rules.goalPct}%` }} />
          </div>
          <p className="text-[11px] font-bold text-slate-500 mt-1">{sum.pctConfirmed}% confirmed · goal {rules.goalPct}%</p>
        </div>
        <button type="button" onClick={onOpen} className="shrink-0 min-h-11 px-3 rounded-lg border-2 border-slate-200 text-sm font-bold text-slate-700 active:bg-slate-50">📈 Progress</button>
      </div>
    </div>
  )
}

/** The pop-up: totals, then the last 10 days, today first. */
export default function CountProgress({ products, rules, onClose }: { products: any[]; rules: CountRules; onClose: () => void }) {
  const sum = useMemo(() => coverageSummary(products, rules), [products, rules])
  const days = useMemo(() => dailyConfirmations(products, 10), [products])
  const total = days.reduce((t, d) => t + d.count, 0)
  const max = Math.max(1, ...days.map(d => d.count))
  const goalItems = Math.ceil(sum.total * rules.goalPct / 100)
  const toGoal = Math.max(0, goalItems - (sum.total - sum.notConfirmed))
  const perDay = total / 10
  const daysToGoal = toGoal > 0 && perDay > 0 ? Math.ceil(toGoal / perDay) : null
  const m = monthsOf(rules.windowDays)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey) }
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Stock count progress" onClick={e => e.stopPropagation()}
        className="bg-slate-50 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 bg-white border-b border-slate-200">
          <div>
            <h3 className="text-lg font-black text-slate-900">Stock count progress</h3>
            <p className="text-xs text-slate-500">Confirmed = counted in the last {m} month{m !== 1 ? 's' : ''}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-11 h-11 -mr-1 rounded-xl flex items-center justify-center text-slate-600 bg-slate-100 active:bg-slate-200">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 py-3 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className="text-2xl font-black text-red-700 tabular-nums">{sum.notConfirmed.toLocaleString()}</p>
              <p className="text-xs text-slate-600">not confirmed in {m} month{m !== 1 ? 's' : ''}, of {sum.total.toLocaleString()} in stock</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-xl p-3">
              <p className={`text-2xl font-black tabular-nums ${sum.pctConfirmed >= rules.goalPct ? 'text-emerald-700' : 'text-slate-900'}`}>{sum.pctConfirmed}%</p>
              <p className="text-xs text-slate-600">confirmed · goal {rules.goalPct}%</p>
            </div>
          </div>
          <p className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl p-3">
            {toGoal === 0
              ? <>✅ Goal reached — keep counting so nothing goes past {m} months.</>
              : <><b>{toGoal.toLocaleString()}</b> more items to confirm to reach {rules.goalPct}%.{' '}
                  {daysToGoal != null ? <>At the last 10 days&apos; pace ({Math.round(perDay)} a day) that is about <b>{daysToGoal} day{daysToGoal !== 1 ? 's' : ''}</b>.</> : <>Nothing was counted in the last 10 days.</>}</>}
          </p>

          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-black tracking-wider text-slate-500 uppercase">Last 10 days</p>
            <p className="text-xs font-bold text-slate-600">Total {total.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {days.map((d, k) => {
              const dt = new Date(d.date + 'T00:00:00')
              const label = k === 0 ? 'Today' : k === 1 ? 'Yesterday' : dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
              return (
                <div key={d.date} className="px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm font-semibold text-slate-700">{label}</span>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
                      <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${(d.count / max) * 100}%` }} />
                    </div>
                    <span className={`w-12 text-right text-sm font-black tabular-nums ${d.count ? 'text-slate-900' : 'text-slate-300'}`}>{d.count}</span>
                  </div>
                  {d.places.length > 0 && (
                    <p className="text-[11px] text-slate-500 mt-1 pl-[108px]">{d.places.slice(0, 3).map(p => `${p.label} ${p.n}`).join(' · ')}{d.places.length > 3 ? ` · +${d.places.length - 3} more` : ''}</p>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-[11px] text-slate-500">Each item shows on the day it was last counted — one counted twice shows on the later day.</p>
        </div>
      </div>
    </div>
  )
}
