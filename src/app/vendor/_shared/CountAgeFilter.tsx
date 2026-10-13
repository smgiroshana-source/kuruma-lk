'use client'
// ── Shared by BOTH vendors (Sakura + WHEEL MART) — keep vendor-neutral ────────
// Browse & Count's "not confirmed since" control: one row of four stops, each
// with how many items sit under it, so staff see where the old stock is
// before they tap. Rules: src/lib/countCoverage.ts.
import { COUNT_AGE_STOPS, type CountAge } from '@/lib/countCoverage'

export default function CountAgeFilter({ value, counts, onChange }: {
  value: CountAge
  counts: Record<CountAge, number>
  onChange: (v: CountAge) => void
}) {
  return (
    <div>
      <p className="text-xs font-bold text-slate-400 uppercase mb-1.5">Not confirmed since</p>
      <div role="radiogroup" aria-label="Not confirmed since" className="grid grid-cols-4 gap-[3px] p-[3px] rounded-xl bg-slate-200">
        {COUNT_AGE_STOPS.map(s => {
          const on = s.v === value
          return (
            <button key={s.v} type="button" role="radio" aria-checked={on} aria-label={`${s.long}: ${counts[s.v]}`}
              onClick={() => onChange(s.v)}
              className={`min-h-[52px] rounded-[10px] flex flex-col items-center justify-center gap-0.5 px-0.5 transition ${on ? 'bg-orange-700 text-white shadow-sm' : 'text-slate-700 active:bg-white/60'}`}>
              <span className="text-[13px] font-extrabold leading-none">{s.label}</span>
              <span className={`text-[11px] font-bold leading-none tabular-nums ${on ? 'text-orange-100' : 'text-slate-500'}`}>{counts[s.v].toLocaleString()}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
