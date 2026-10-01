'use client'
// ── WHEEL MART ONLY — "did this cost have VAT on it?" (owner, 2026-10-01) ────
//
// Asked wherever a cost is typed by hand (Add Product, Edit, Bulk Upload).
// The POS grosses the net cost up by this rate for the minimum price — a
// receipt has no VAT to recover, so its price must clear the VAT paid.
// Left blank, it used to count as 0%: P-ITV629 showed Rs.5,118 as its
// minimum instead of Rs.6,039. GRNs set it themselves; transfers set 0%.

export const VAT_ON_COST = 18

export default function CostVatChoice({ value, onChange, compact = false }: {
  value: number | null | undefined
  onChange: (rate: number) => void
  compact?: boolean
}) {
  const opts = [
    { rate: VAT_ON_COST, label: `VAT invoice (+${VAT_ON_COST}%)`, hint: 'bought from a VAT-registered supplier' },
    { rate: 0, label: 'No VAT', hint: 'supplier not VAT-registered / no tax invoice' },
  ]
  const unset = value === null || value === undefined
  return (
    <div className={compact ? 'mt-1' : 'mt-1.5'}>
      <p className={`text-[10px] font-bold mb-1 ${unset ? 'text-red-600' : 'text-slate-500'}`}>
        {unset ? 'Was there VAT on this cost? *' : 'VAT on this cost'}
      </p>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="VAT on this cost">
        {opts.map(o => {
          const on = value === o.rate
          return (
            <button key={o.rate} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.rate)} title={o.hint}
              className={`min-h-9 px-2 py-1.5 rounded-lg border-2 text-[11px] font-bold leading-tight ${on ? 'border-orange-500 bg-orange-50 text-orange-800' : unset ? 'border-red-200 text-slate-600' : 'border-slate-200 text-slate-500'}`}>
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
