'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// Browse & Count's "not confirmed since" control: one row — All plus the
// shop's three stops (WHEEL MART 1/3/6 months, Sakura 3/6/12) — each with how
// many items sit under it, so staff see where the old stock is before they
// tap. Rules: src/lib/countCoverage.ts.
import { countAgeStops, type CountAge, type CountRules } from '@/lib/countCoverage'

export default function CountAgeFilter({ rules, value, counts, onChange, allLast = false }: {
  rules: CountRules
  allLast?: boolean            // phones: the stops first, All at the far right (Sakura, 2026-10-23)
  value: CountAge
  counts: Record<string, number>
  onChange: (v: CountAge) => void
}) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase mb-1.5">Not confirmed since</p>
      <div role="radiogroup" aria-label="Not confirmed since" className="grid grid-cols-4 gap-[3px] p-[3px] rounded-xl bg-slate-200">
        {(allLast ? [...countAgeStops(rules).slice(1), countAgeStops(rules)[0]] : countAgeStops(rules)).map(s => {
          const on = s.v === value
          return (
            <button key={s.v} type="button" role="radio" aria-checked={on} aria-label={`${s.long}: ${counts[s.v] ?? 0}`}
              onClick={() => onChange(s.v)}
              className={`min-h-[52px] rounded-[10px] flex flex-col items-center justify-center gap-0.5 px-0.5 transition ${on ? 'bg-orange-700 text-white shadow-sm' : 'text-slate-700 active:bg-white/60'}`}>
              <span className="text-[13px] font-extrabold leading-none">{s.label}</span>
              <span className={`text-[11px] font-bold leading-none tabular-nums ${on ? 'text-orange-100' : 'text-slate-500'}`}>{(counts[s.v] ?? 0).toLocaleString()}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
