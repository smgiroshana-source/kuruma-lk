// ── Count coverage: which stock nobody has confirmed lately (owner, 2026-10-13) ──
//
// Both shops. An item is "confirmed" when someone counted it on Browse & Count
// (confirm or correct) or placed it with Quick Assign — both stamp
// products.last_stock_confirmed_at. It goes stale COUNT_WINDOW_DAYS later.
// Adding an item counts as its first confirmation (owner, 2026-10-13): someone
// just had it in hand. So an item never counted is timed from when it entered
// the system (created_at; added_date is free text in mixed formats and can't
// be trusted) and only becomes due 30 days later.
// No "Never" stop (owner, 2026-10-13): at Sakura it was the same items as
// "(No location)" (2,826 of 2,861) and at WHEEL MART 7 items already in
// "1 mo+". Each card and the printed sheet still say "Never counted".
//
// Every staff login sees a reminder while more than REMIND_PCT of the shop's
// stock is not confirmed. No dismiss button, by the owner's choice: it clears
// only by counting.
//
// Pure functions over the products the vendor page already loads — no server
// calls, so it costs nothing in Vercel usage.

export const COUNT_WINDOW_DAYS = 30
export const REMIND_PCT = 20

const DAY = 86_400_000

export type CountAge = 'all' | '1m' | '3m' | '6m'

export const COUNT_AGE_STOPS: { v: CountAge; label: string; long: string }[] = [
  { v: 'all',   label: 'All',    long: 'All' },
  { v: '1m',    label: '1 mo+',  long: 'Not counted in 1 month+' },
  { v: '3m',    label: '3 mo+',  long: 'Not counted in 3 months+' },
  { v: '6m',    label: '6 mo+',  long: 'Not counted in 6 months+' },
]

/** Physical stock that ought to be counted: active, on hand, not a service. */
export function isCountable(p: any): boolean {
  return !!p && p.is_active !== false && Number(p.quantity) > 0 && p.product_type !== 'service'
}

/** Days since the item was last confirmed (or added, if never counted). */
export function countAgeDays(p: any, now = Date.now()): number {
  const t = Date.parse(p?.last_stock_confirmed_at || p?.created_at || '')
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : Infinity
}

export function isConfirmed(p: any, now = Date.now()): boolean {
  return countAgeDays(p, now) <= COUNT_WINDOW_DAYS
}

/** Does a countable item fall under this stop of the filter? */
export function matchesCountAge(p: any, age: CountAge, now = Date.now()): boolean {
  if (age === 'all') return true
  const d = countAgeDays(p, now)
  if (age === '1m') return !isConfirmed(p, now)   // ⊇ 3 mo+ ⊇ 6 mo+
  return age === '3m' ? d > 90 : d > 180
}

/** How many items sit under each stop (countable items only). */
export function countAgeCounts(products: any[], now = Date.now()): Record<CountAge, number> {
  const out: Record<CountAge, number> = { all: 0, '1m': 0, '3m': 0, '6m': 0 }
  for (const p of products) {
    if (!isCountable(p)) continue
    for (const s of COUNT_AGE_STOPS) if (matchesCountAge(p, s.v, now)) out[s.v]++
  }
  return out
}

export type CoverageSummary = {
  total: number
  notConfirmed: number
  pctNotConfirmed: number   // 0–100, one decimal
  pctConfirmed: number      // 0–100, whole
  remind: boolean
  // splits notConfirmed exactly by how long it has waited (the filter's stops)
  older: { m1to3: number; m3to6: number; m6plus: number }
}

export function coverageSummary(products: any[], now = Date.now()): CoverageSummary {
  let total = 0, notConfirmed = 0, m1to3 = 0, m3to6 = 0, m6plus = 0
  for (const p of products) {
    if (!isCountable(p)) continue
    total++
    if (isConfirmed(p, now)) continue
    notConfirmed++
    const d = countAgeDays(p, now)
    if (d <= 90) m1to3++
    else if (d <= 180) m3to6++
    else m6plus++
  }
  const pct = total ? (notConfirmed / total) * 100 : 0
  return {
    total, notConfirmed,
    pctNotConfirmed: Math.round(pct * 10) / 10,
    pctConfirmed: total ? Math.floor(((total - notConfirmed) / total) * 100) : 100,
    remind: pct > REMIND_PCT,
    older: { m1to3, m3to6, m6plus },
  }
}

// ── By location ─────────────────────────────────────────────────────────────
// Grouped by store › floor › sub location 1 (sub 2 is usually a bin — too fine
// for a to-do list). The values are the exact stored spellings, so a row can
// set the Browse & Count dropdowns directly. NO_LOCATION marks items with no
// location at all.

export const NO_LOCATION = '__none__'

export type LocationFilter = { store: string; floor: string; sub1: string; sub2: string }

export function hasNoLocation(p: any): boolean {
  return !p?.loc_store && !p?.loc_floor && !p?.loc_sub1 && !p?.loc_sub2
}

export type CoverageRow = {
  key: string
  label: string
  filter: LocationFilter
  total: number
  notConfirmed: number
  neverCounted: number
  oldestDays: number        // among the not-confirmed; 0 when none
}

export function coverageByLocation(products: any[], now = Date.now()): CoverageRow[] {
  const rows = new Map<string, CoverageRow>()
  for (const p of products) {
    if (!isCountable(p)) continue
    const none = hasNoLocation(p)
    const store = p.loc_store || '', floor = p.loc_floor || '', sub1 = p.loc_sub1 || ''
    const key = none ? NO_LOCATION : [store, floor, sub1].join('\u0000')
    let r = rows.get(key)
    if (!r) {
      r = {
        key,
        label: none ? 'No location set' : [store || '(no store)', floor, sub1].filter(Boolean).join(' · '),
        filter: none ? { store: NO_LOCATION, floor: '', sub1: '', sub2: '' } : { store, floor, sub1, sub2: '' },
        total: 0, notConfirmed: 0, neverCounted: 0, oldestDays: 0,
      }
      rows.set(key, r)
    }
    r.total++
    const d = countAgeDays(p, now)
    if (!isConfirmed(p, now)) {
      r.notConfirmed++
      if (!p.last_stock_confirmed_at) r.neverCounted++
      r.oldestDays = Math.max(r.oldestDays, Number.isFinite(d) ? Math.floor(d) : 0)
    }
  }
  return [...rows.values()].sort((a, b) => b.notConfirmed - a.notConfirmed || b.total - a.total)
}

/** Does a product sit at this location filter? Understands NO_LOCATION. */
export function matchesLocation(p: any, f: LocationFilter): boolean {
  if (f.store === NO_LOCATION) return hasNoLocation(p)
  if (f.store && p.loc_store !== f.store) return false
  if (f.floor && p.loc_floor !== f.floor) return false
  if (f.sub1 && p.loc_sub1 !== f.sub1) return false
  if (f.sub2 && p.loc_sub2 !== f.sub2) return false
  return true
}

export function lastCountedLabel(p: any, now = Date.now()): string {
  if (!p?.last_stock_confirmed_at) return 'Never counted'
  const d = Math.floor(countAgeDays(p, now))
  if (d === 0) return 'Counted today'
  if (d < 60) return `Last counted ${d}d ago`
  return `Last counted ${Math.round(d / 30)} months ago`
}
