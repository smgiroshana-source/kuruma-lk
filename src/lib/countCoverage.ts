// ── Count coverage: which stock nobody has confirmed lately (owner, 2026-10-13) ──
//
// Both shops. An item is "confirmed" when someone counted it on Browse & Count
// (confirm or correct) or placed it with Quick Assign — both stamp
// products.last_stock_confirmed_at. It goes stale after the shop's window,
// and each shop has its own filter stops (owner, 2026-10-13 — Sakura's yard
// is thousands of slow-moving body parts):
//   WHEEL MART  confirmed 30 days · stops 1 / 3 / 6 months
//   Sakura      confirmed 90 days · stops 3 / 6 / 12 months
// countRules() is the only place that says so.
// Adding an item counts as its first confirmation (owner, 2026-10-13): someone
// just had it in hand. So an item never counted is timed from when it entered
// the system (created_at; added_date is free text in mixed formats and can't
// be trusted) and only becomes due a window later.
// A stop is a plain age ("not counted in 6 months+"); the first stop is the
// shop's window, so it shows exactly what the reminder counts.
// No "Never" stop (owner, 2026-10-13): at Sakura it was the same items as
// "(No location)" (2,826 of 2,861) and at WHEEL MART 7 items already in
// "1 mo+". Each card and the printed sheet still say "Never counted".
//
// Every staff login sees a reminder while the shop is below its goal of
// confirmed stock (countRules().goalPct: WHEEL MART 100%, Sakura 90% — owner,
// 2026-10-23). No dismiss button, by the owner's choice: it clears
// only by counting.
//
// Pure functions over the products the vendor page already loads — no server
// calls, so it costs nothing in Vercel usage.


export type CountAge = 'all' | '1m' | '3m' | '6m' | '12m'
const AGE_DAYS: Record<Exclude<CountAge, 'all'>, number> = { '1m': 30, '3m': 90, '6m': 180, '12m': 365 }
const AGE_MONTHS: Record<Exclude<CountAge, 'all'>, number> = { '1m': 1, '3m': 3, '6m': 6, '12m': 12 }

export type CountRules = { windowDays: number; stops: Exclude<CountAge, 'all'>[]; goalPct: number }

// Each shop's count rules — the ONLY place they live. Fixed objects, so a
// component's useMemo on them doesn't recompute every render.
const WHEEL_MART_RULES: CountRules = { windowDays: 30, stops: ['1m', '3m', '6m'], goalPct: 100 }   // owner, 2026-10-23: every item, every month
const SAKURA_RULES: CountRules = { windowDays: 90, stops: ['3m', '6m', '12m'], goalPct: 90 }
export function countRules(isLkTax: boolean): CountRules {
  return isLkTax ? WHEEL_MART_RULES : SAKURA_RULES
}

/** The filter stop that shows exactly what the reminder counts. */
export function dueStop(rules: CountRules): CountAge {
  return rules.stops[0]
}

export function countAgeStops(rules: CountRules): { v: CountAge; label: string; long: string }[] {
  return [
    { v: 'all', label: 'All', long: 'All' },
    ...rules.stops.map(v => {
      const m = AGE_MONTHS[v]
      return { v, label: `${m} mo+`, long: `Not counted in ${m} month${m === 1 ? '' : 's'}+` }
    }),
  ]
}

const DAY = 86_400_000


/** On the shelf: active, quantity above zero, not a service. What Browse &
 *  Count lists when browsing (sold-out items appear only when searched). */
export function isOnHand(p: any): boolean {
  return !!p && p.is_active !== false && Number(p.quantity) > 0 && p.product_type !== 'service'
}

/** Physical stock that ought to be counted: active, on hand, not a service,
 *  not a consumable. Consumables (valves, patches, weights, shims, nuts, cable
 *  ties) are loose-counted by design — corrected at the next GRN — so they
 *  stay out of the monthly count and its reminder (owner, 2026-10-23). They
 *  still appear on Browse & Count under "All" and in search. */
export function isCountable(p: any): boolean {
  return !!p && p.is_active !== false && Number(p.quantity) > 0
    && p.product_type !== 'service' && p.product_type !== 'consumable'
}

/** Days since the item was last confirmed (or added, if never counted). */
export function countAgeDays(p: any, now = Date.now()): number {
  const t = Date.parse(p?.last_stock_confirmed_at || p?.created_at || '')
  return Number.isFinite(t) ? Math.max(0, (now - t) / DAY) : Infinity
}

export function isConfirmed(p: any, windowDays = 30, now = Date.now()): boolean {
  return countAgeDays(p, now) <= windowDays
}

/** Does a countable item fall under this stop of the filter? */
export function matchesCountAge(p: any, age: CountAge, now = Date.now()): boolean {
  if (age === 'all') return true
  return countAgeDays(p, now) > AGE_DAYS[age]   // plain ages: each stop ⊇ the next
}

/** How many items sit under each stop (countable items only). */
export function countAgeCounts(products: any[], rules: CountRules, now = Date.now()): Record<string, number> {
  const stops: CountAge[] = ['all', ...rules.stops]
  const out: Record<string, number> = Object.fromEntries(stops.map(s => [s, 0]))
  for (const p of products) {
    if (!isCountable(p)) continue
    for (const s of stops) if (matchesCountAge(p, s, now)) out[s]++
  }
  return out
}

export type CoverageSummary = {
  total: number
  notConfirmed: number
  pctNotConfirmed: number   // 0–100, one decimal
  pctConfirmed: number      // 0–100, whole
  remind: boolean
  // splits notConfirmed exactly by how long it has waited, along the shop's
  // stops: WHEEL MART 1–3 / 3–6 / 6+ months, Sakura 3–6 / 6–12 / 12+
  bands: { label: string; n: number; oldest: boolean }[]
}

export function coverageSummary(products: any[], rules: CountRules, now = Date.now()): CoverageSummary {
  const edges = rules.stops.map(s => AGE_DAYS[s])
  const months = rules.stops.map(s => AGE_MONTHS[s])
  const bands = rules.stops.map((_, i) => ({
    label: i < months.length - 1 ? `${months[i]}–${months[i + 1]} months` : `${months[i]} months+`,
    n: 0, oldest: i === months.length - 1,
  }))
  let total = 0, notConfirmed = 0
  for (const p of products) {
    if (!isCountable(p)) continue
    total++
    if (isConfirmed(p, rules.windowDays, now)) continue
    notConfirmed++
    const d = countAgeDays(p, now)
    let i = edges.length - 1
    while (i > 0 && d <= edges[i]) i--
    bands[i].n++
  }
  const pct = total ? (notConfirmed / total) * 100 : 0
  return {
    total, notConfirmed,
    pctNotConfirmed: Math.round(pct * 10) / 10,
    pctConfirmed: total ? Math.floor(((total - notConfirmed) / total) * 100) : 100,
    remind: pct > 100 - rules.goalPct,
    bands,
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

export function coverageByLocation(products: any[], windowDays = 30, now = Date.now()): CoverageRow[] {
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
    if (!isConfirmed(p, windowDays, now)) {
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

// ── Day by day (owner, 2026-10-23) ──────────────────────────────────────────
// How many items were confirmed on each of the last `days` days, and where.
// Only each product's LATEST confirmation is stored, so an item counted twice
// shows on the later day — the list is "items whose last count was that day".
export type CountDay = { date: string; count: number; places: { label: string; n: number }[] }

export function dailyConfirmations(products: any[], days = 10, now = Date.now()): CountDay[] {
  const colDay = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
  const out: CountDay[] = []
  const byDay = new Map<string, Map<string, number>>()
  for (let k = days - 1; k >= 0; k--) { const d = colDay(now - k * DAY); byDay.set(d, new Map()); out.push({ date: d, count: 0, places: [] }) }
  for (const p of products) {
    if (!isCountable(p) || !p.last_stock_confirmed_at) continue
    const m = byDay.get(colDay(Date.parse(p.last_stock_confirmed_at)))
    if (!m) continue
    const label = hasNoLocation(p) ? 'No location' : [p.loc_store, p.loc_floor, p.loc_sub1].filter(Boolean).join(' › ')
    m.set(label, (m.get(label) || 0) + 1)
  }
  for (const d of out) {
    const m = byDay.get(d.date)!
    d.count = [...m.values()].reduce((a, b) => a + b, 0)
    d.places = [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n)
  }
  return out.reverse()   // today first
}
