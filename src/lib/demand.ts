// ── What sells, what to order, what not to — Sakura, owner 2026-11-13 ───────
// Groups every part by VEHICLE (make + model) × PART TYPE and compares what
// sold with what is on the shelf and what customers searched for. Used parts
// are bought by model and part, so that is the unit of an order.
//
// Part names are free text ("Toyota Aqua NHP10 Head Lamp RHS", "H/L", "Headlight
// LH"), so partType() sorts them into types by keyword, most specific first.
// A model missing on the record is read from the name when the make's known
// models appear in it (544 Sakura sale lines said only "TOYOTA").

export const DEMAND_RULES = {
  windowDays: 180,      // sales history the lists are built from
  recentDays: 90,       // "recent" sales and searches
  fastDays: 30,         // sells within this many days of listing = fast
  slowDays: 180,        // on the shelf this long with no sale of its type = clear out
  orderCoverMonths: 2,  // under this many months of stock left → order more
  dontOrderCoverMonths: 12,
}

import { fetchAllRows, fetchAllByIds } from './fetchAll'

// [type, pattern] — first match wins, so specific before general
const TYPES: [string, RegExp][] = [
  ['Hybrid / EV battery', /hybrid\s*batt|hv\s*batt|\bhv\b.*batt|\bev\s*batt|cell\s*pack/],
  ['Inverter', /inverter/],
  ['Brake accumulator', /accumulat[oe]r/],
  ['ABS actuator', /\babs\b/],
  ['Brake booster / master', /booster|master\s*(cyl|pump)|brake\s*master/],
  ['Brake caliper', /caliper/],
  ['Brake pads / discs', /brake\s*pad|\bpads?\b|disc\b|rotor/],
  ['Engine / CVT oil & fluids', /\boil\b|coolant|fluid|\batf\b|lubric/],
  ['Filter', /filter/],
  ['Spark plug / coil', /spark\s*plug|ignition\s*coil|\bcoil\b/],
  ['Radiator grill', /grill|grille/],
  ['Headlamp', /head\s*(lamp|light)|\bh\/?l\b/],
  ['Tail lamp', /tail\s*(lamp|light)|stop\s*lamp|rear\s*(lamp|light)|\bt\/?l\b/],
  ['Fog lamp', /fog/],
  ['Daylight lamp', /daylight|\bdrl\b/],
  ['Body shell / half cut', /\bshell\b|half\s*cut|chassis|\bfloor\b/],
  ['Inner guard / splash', /inner\s*guard|\bguard\b|liner|splash/],
  ['Bumper retainer / reinforcement', /retainer|reinforcement|bracket/],
  ['Side skirt', /skirt/],
  ['Cowl', /cowl/],
  ['Tailgate / boot', /tail\s*gate|back\s*door|dick(y|ey)|boot\s*lid|\bboot\b|trunk/],
  ['Front bumper', /front\s*(bumper|buffer)|(bumper|buffer).*front/],
  ['Rear bumper', /rear\s*(bumper|buffer)|(bumper|buffer).*rear/],
  ['Bumper', /bumper|buffer/],
  ['Bonnet', /bonnet|\bhood\b/],
  ['Fender', /fender|mud\s*guard/],
  ['Door', /\bdoor\b/],
  ['Side mirror', /mirror/],
  ['Windscreen / glass', /wind\s*(screen|shield)|glass/],
  ['Shock absorber / strut', /shock|strut|absorber/],
  ['Hub / bearing', /\bhub\b|bearing/],
  ['Suspension arm / link', /\barm\b|\blink\b|knuck[el]+|stabil|balance\s*bar|\bbush\b|spring/],
  ['Propeller shaft', /propeller/],
  ['Drive shaft / axle', /drive\s*shaft|\baxle\b|\baxel\b|cv\s*joint/],
  ['Intercooler / oil cooler', /cooler/],
  ['Fuse box / wiring', /fuse|harness|wiring|\bwire\b/],
  ['Steering', /steering|rack/],
  ['Alternator', /alternator|dynamo/],
  ['Starter motor', /starter|self\s*motor/],
  ['A/C compressor', /compressor/],
  ['Condenser', /condens[eo]r/],
  ['Blower', /blower/],
  ['Radiator', /radiator/],
  ['Cooling fan', /\bfan\b/],
  ['Engine mount', /mount|cushion/],
  ['Engine', /\bengine\b/],
  ['Gearbox / CVT', /gear\s*box|transmission|\bcvt\b|\bauto\s*box\b/],
  ['ECU / control unit', /\becu\b|computer|control\s*unit|\bmodule\b|\becm\b/],
  ['Throttle body', /throttle/],
  ['Injector', /injector/],
  ['Sensor', /sensor/],
  ['Pump', /pump/],
  ['Meter cluster', /meter|cluster|speedo/],
  ['Audio / display', /audio|stereo|display|navi|\bscreen\b|camera/],
  ['Airbag', /air\s*bag|srs/],
  ['Seat', /\bseat\b/],
  ['Dashboard', /dash\s*board|\bdash\b/],
  ['Window regulator', /regulator|power\s*window/],
  ['Wiper', /wiper/],
  ['Switch', /switch/],
  ['Handle / lock', /handle|\block\b/],
  ['Garnish / panel', /garnish|panel|moulding|molding|trim/],
  ['Cover', /cover/],
  ['Antenna', /antenna/],
  ['Indicator / other lamp', /lamp|light|winker|bulb/],
  ['Wheel / rim', /\brim\b|alloy|\bwheel\b/],
  ['Tyre / tube', /tyre|tire|\btube\b/],
  ['12V battery', /battery|\bbatt\b/],
  ['Horn', /horn/],
  ['Belt', /belt/],
  ['Hose / pipe', /hose|pipe/],
]

export function partType(name: string, category?: string | null): string {
  const n = ` ${String(name || '').toLowerCase().replace(/[_\-]+/g, ' ')} `
  for (const [type, re] of TYPES) if (re.test(n)) return type
  return category && category !== 'Other' ? `Other ${category.toLowerCase()}` : 'Other'
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** make → its known models (lower case), longest first so "wagon r" beats "r" */
export function knownModels(products: { make?: string | null; model?: string | null }[]): Map<string, string[]> {
  const m = new Map<string, Set<string>>()
  for (const p of products) {
    const mk = norm(p.make), md = norm(p.model)
    if (!mk || !md || md.length < 2) continue
    if (!m.has(mk)) m.set(mk, new Set())
    m.get(mk)!.add(md)
  }
  return new Map([...m].map(([k, v]) => [k, [...v].sort((a, b) => b.length - a.length)]))
}

/** "Toyota Aqua" — the model read from the name when the record has none */
export function vehicleOf(p: { make?: string | null; model?: string | null; name?: string | null }, models: Map<string, string[]>): string {
  const mk = norm(p.make)
  let md = norm(p.model)
  if (!md && mk) {
    const name = ` ${norm(p.name)} `
    md = (models.get(mk) || []).find(x => name.includes(` ${x} `)) || ''
  }
  if (!mk && !md) return 'Unknown vehicle'
  return [mk && title(mk), md ? title(md) : '(model not recorded)'].filter(Boolean).join(' ')
}

/** Every make + model on record with how many products carry it — a search
 *  for "wagon r" goes to the make that most often has that model (one item
 *  recorded as Honda Wagon R must not capture it). */
export function modelIndex(products: { make?: string | null; model?: string | null }[]): { make: string; model: string; n: number }[] {
  const c = new Map<string, number>()
  for (const p of products) {
    const mk = norm(p.make), md = norm(p.model)
    if (!mk || !md || md.length < 3) continue
    c.set(`${mk}|${md}`, (c.get(`${mk}|${md}`) || 0) + 1)
  }
  return [...c].map(([k, n]) => { const [make, model] = k.split('|'); return { make, model, n } })
    .sort((a, b) => b.model.length - a.model.length || b.n - a.n)
}

/** A storefront search → the vehicle and part type it asks for, when both are in it */
export function readSearch(q: string, index: { make: string; model: string; n: number }[]): { vehicle: string; type: string } | null {
  const s = ` ${norm(q)} `
  const type = partType(s)
  if (type.startsWith('Other')) return null
  // Longest model name that appears; among makes with it, one named in the
  // search, else the commonest
  const hits = index.filter(x => s.includes(` ${x.model} `))
  if (hits.length === 0) return null
  const longest = hits[0].model.length
  const same = hits.filter(x => x.model.length === longest)
  const pick = same.find(x => s.includes(` ${x.make} `)) || same.sort((a, b) => b.n - a.n)[0]
  return { vehicle: `${title(pick.make)} ${title(pick.model)}`, type }
}

export type DemandGroup = {
  key: string
  vehicle: string
  type: string
  codes: string[]          // model codes seen (NHP10, MH55S …), most common first
  soldRecent: number       // units, last recentDays
  soldWindow: number       // units, last windowDays
  revenue: number          // Rs., last windowDays
  inStock: number          // units on the shelf now
  listings: number         // in-stock items
  coverMonths: number | null  // months of stock left at the window's pace; null = nothing sold
  medianDays: number | null   // listing → sale, for this window's sales
  searches: number         // storefront searches for it, last recentDays
  notFound: number         // …of which found nothing
  lastSold: string | null
  oldestDays: number | null   // oldest in-stock item, days on the shelf
  examples: string[]
}

export type ClearOutItem = { id: string; sku: string; name: string; vehicle: string; type: string; days: number; quantity: number }

export type DemandReport = {
  rules: typeof DEMAND_RULES
  generatedAt: string
  summary: { saleLines: number; unitsSold: number; revenue: number; groups: number; inStockItems: number; searchesRead: number; searchesMatched: number }
  groups: DemandGroup[]
  orderMore: string[]
  dontOrder: string[]
  clearOut: { count: number; items: ClearOutItem[] }
}

const DAY = 86400000
const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return Math.round(s[Math.floor(s.length / 2)])
}

/** The whole report for one shop. Sales, stock and the storefront's searches;
 *  all read-only. Sold-on rows (sell-through to WHEEL MART) are not Sakura's
 *  own customers' demand and are left out. */
export async function demandReport(admin: any, vendorId: string, now = new Date()): Promise<DemandReport> {
  const R = DEMAND_RULES
  const windowStart = new Date(now.getTime() - R.windowDays * DAY).toISOString()
  const recentStart = new Date(now.getTime() - R.recentDays * DAY).toISOString()

  const products: any[] = await fetchAllRows((f, t) => admin.from('products')
    .select('id, sku, name, category, make, model, model_code, quantity, is_active, created_at')
    .eq('vendor_id', vendorId).order('id').range(f, t))
  const sales: any[] = await fetchAllRows((f, t) => admin.from('sales')
    .select('id, created_at, payment_status, sell_through_of_sale_id')
    .eq('vendor_id', vendorId).gte('created_at', windowStart)
    .neq('payment_status', 'voided').neq('payment_status', 'draft')
    .is('sell_through_of_sale_id', null)
    .order('id').range(f, t))
  const saleDate = new Map(sales.map(s => [s.id, s.created_at as string]))
  const lines: any[] = await fetchAllByIds(sales.map(s => s.id), (chunk, f, t) => admin.from('sale_items')
    .select('id, sale_id, product_id, product_name, quantity, returned_quantity, total')
    .in('sale_id', chunk).order('id').range(f, t))
  const searches: any[] = await fetchAllRows((f, t) => admin.from('search_logs')
    .select('id, query, result_count').gte('created_at', recentStart).order('id').range(f, t))

  const models = knownModels(products)
  const index = modelIndex(products)
  const byId = new Map(products.map(p => [p.id, p]))
  const bySku = new Map(products.filter(p => p.sku).map(p => [String(p.sku).trim().toLowerCase(), p]))
  const groupOf = (p: any) => {
    const vehicle = vehicleOf(p, models), type = partType(p.name, p.category)
    return { key: `${vehicle}|${type}`, vehicle, type }
  }

  const G = new Map<string, DemandGroup & { _days: number[]; _codes: Map<string, number>; _ex: Set<string> }>()
  const get = (g: { key: string; vehicle: string; type: string }) => {
    if (!G.has(g.key)) G.set(g.key, {
      ...g, codes: [], soldRecent: 0, soldWindow: 0, revenue: 0, inStock: 0, listings: 0, coverMonths: null,
      medianDays: null, searches: 0, notFound: 0, lastSold: null, oldestDays: null, examples: [],
      _days: [], _codes: new Map(), _ex: new Set(),
    })
    return G.get(g.key)!
  }
  const code = (p: any, g: any) => { const c = String(p?.model_code || '').trim().toUpperCase(); if (c) g._codes.set(c, (g._codes.get(c) || 0) + 1) }

  // Sales
  let unitsSold = 0, revenue = 0
  for (const l of lines) {
    const units = (Number(l.quantity) || 0) - (Number(l.returned_quantity) || 0)
    if (units <= 0) continue
    const p = byId.get(l.product_id) || { name: l.product_name }
    const g = get(groupOf(p))
    const when = saleDate.get(l.sale_id)!
    const share = (Number(l.total) || 0) * units / (Number(l.quantity) || 1)
    g.soldWindow += units; g.revenue += share
    if (when >= recentStart) g.soldRecent += units
    if (!g.lastSold || when > g.lastSold) g.lastSold = when
    // (a part relisted after a sale reads negative — count it as same-day)
    if (p.created_at) g._days.push(Math.max(0, (new Date(when).getTime() - new Date(p.created_at).getTime()) / DAY))
    code(p, g); if (g._ex.size < 3) g._ex.add(String(p.name || '').trim())
    unitsSold += units; revenue += share
  }

  // Stock
  const inStock = products.filter(p => p.is_active && Number(p.quantity) > 0)
  for (const p of inStock) {
    const g = get(groupOf(p))
    g.inStock += Number(p.quantity) || 0; g.listings++
    const age = (now.getTime() - new Date(p.created_at).getTime()) / DAY
    if (g.oldestDays === null || age > g.oldestDays) g.oldestDays = Math.round(age)
    code(p, g); if (g._ex.size < 3) g._ex.add(String(p.name || '').trim())
  }

  // Storefront searches: a part ID (any product, sold or not), else the
  // vehicle + part type read from the words
  let matched = 0
  for (const s of searches) {
    const q = String(s.query || '').trim()
    if (!q) continue
    let g: ReturnType<typeof groupOf> | null = null
    const byPartId = /^\d{4,7}$/.test(q) ? bySku.get(q.toLowerCase()) : null
    if (byPartId) g = groupOf(byPartId)
    else { const r = readSearch(q, index); if (r) g = { key: `${r.vehicle}|${r.type}`, ...r } }
    if (!g) continue
    const row = get(g)
    row.searches++
    if (!(Number(s.result_count) > 0) || (byPartId && !(byPartId.is_active && Number(byPartId.quantity) > 0))) row.notFound++
    matched++
  }

  const perMonth = R.windowDays / 30
  const groups: DemandGroup[] = [...G.values()].map(g => {
    const { _days, _codes, _ex, ...rest } = g
    return {
      ...rest,
      revenue: Math.round(g.revenue),
      coverMonths: g.soldWindow > 0 ? Math.round(g.inStock / (g.soldWindow / perMonth) * 10) / 10 : null,
      medianDays: median(_days),
      codes: [..._codes].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c),
      examples: [..._ex],
    }
  })

  // 🟢 Order more: selling with little left, or asked for and not on the shelf
  const orderMore = groups
    .filter(g => g.vehicle !== 'Unknown vehicle' && (
      (g.soldWindow >= 2 && (g.inStock === 0 || (g.coverMonths !== null && g.coverMonths < R.orderCoverMonths)))
      || (g.inStock === 0 && g.notFound >= 3)))
    .sort((a, b) => (b.soldRecent * 2 + b.soldWindow + b.notFound) - (a.soldRecent * 2 + a.soldWindow + a.notFound) || b.revenue - a.revenue)
    .map(g => g.key)
  // 🔴 Don't order: plenty on the shelf for how slowly it moves
  const dontOrder = groups
    .filter(g => g.inStock >= 3 && (g.soldWindow === 0 || (g.coverMonths !== null && g.coverMonths >= R.dontOrderCoverMonths)))
    .sort((a, b) => b.inStock - a.inStock)
    .map(g => g.key)
  // 🟠 Clear out: items on the shelf past slowDays whose type hasn't sold
  const unsold = new Set(groups.filter(g => g.soldWindow === 0).map(g => g.key))
  const clear: ClearOutItem[] = inStock
    .map(p => ({ p, g: groupOf(p), days: Math.round((now.getTime() - new Date(p.created_at).getTime()) / DAY) }))
    .filter(x => x.days >= R.slowDays && unsold.has(x.g.key))
    .sort((a, b) => b.days - a.days)
    .map(x => ({ id: x.p.id, sku: x.p.sku || '', name: x.p.name, vehicle: x.g.vehicle, type: x.g.type, days: x.days, quantity: Number(x.p.quantity) || 0 }))

  return {
    rules: R,
    generatedAt: now.toISOString(),
    summary: { saleLines: lines.length, unitsSold, revenue: Math.round(revenue), groups: groups.length, inStockItems: inStock.length, searchesRead: searches.length, searchesMatched: matched },
    groups: groups.sort((a, b) => b.revenue - a.revenue || b.inStock - a.inStock),
    orderMore, dontOrder,
    clearOut: { count: clear.length, items: clear.slice(0, 500) },
  }
}
