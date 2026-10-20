// ── VAT and SSCL deadlines — WHEEL MART (owner, 2026-10-20) ─────────────────
//
// The owner pays VAT and SSCL and files the returns; the dashboard reminds
// them from REMIND_DAYS before each due date until it is ticked Done
// (tax_obligations_done, supabase-tax-deadlines.sql):
//   VAT payment   month M  → 20th of M+1
//   VAT return    month M  → last day of M+1
//   SSCL payment  month M  → 20th of M+1   (IRD: monthly instalments)
//   SSCL return   quarter  → 20th of the month after the quarter
// Due dates per the IRD's SSCL notice and the VAT rules the owner confirmed —
// change them here only. Starts at FIRST_PERIOD: August 2026 and earlier were
// settled before the reminders existed.

export const TAX_FIRST_PERIOD = '2026-09'
export const TAX_REMIND_DAYS = 7

export type TaxKind = 'vat_payment' | 'vat_return' | 'sscl_payment' | 'sscl_return'
export type TaxDue = {
  kind: TaxKind
  period: string        // 2026-09 or 2026-Q3
  periodLabel: string   // September 2026 / Jul–Sep 2026
  due: string           // YYYY-MM-DD
  daysLeft: number      // negative = overdue
}

const pad = (n: number) => String(n).padStart(2, '0')
function addMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`
}
function lastDay(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${pad(new Date(Date.UTC(y, m, 0)).getUTCDate())}`
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000)
const monthName = (ym: string) => new Date(ym + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export const TAX_KIND_LABEL: Record<TaxKind, string> = {
  vat_payment: 'VAT payment', vat_return: 'VAT return',
  sscl_payment: 'SSCL payment', sscl_return: 'SSCL return',
}

/** Every obligation from FIRST_PERIOD whose due date is on or before today + REMIND_DAYS. */
export function taxObligationsDue(today: string): TaxDue[] {
  const out: TaxDue[] = []
  const thisMonth = today.slice(0, 7)
  for (let m = TAX_FIRST_PERIOD; m < thisMonth; m = addMonth(m, 1)) {
    const next = addMonth(m, 1)
    const push = (kind: TaxKind, period: string, periodLabel: string, due: string) => {
      const daysLeft = daysBetween(today, due)
      if (daysLeft <= TAX_REMIND_DAYS) out.push({ kind, period, periodLabel, due, daysLeft })
    }
    push('vat_payment', m, monthName(m), `${next}-20`)
    push('sscl_payment', m, monthName(m), `${next}-20`)
    push('vat_return', m, monthName(m), lastDay(next))
    const mm = Number(m.slice(5))
    if (mm % 3 === 0) {
      const q = mm / 3
      const first = addMonth(m, -2)
      const label = `${new Date(first + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}–${new Date(m + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`
      push('sscl_return', `${m.slice(0, 4)}-Q${q}`, label, `${next}-20`)
    }
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft)
}
