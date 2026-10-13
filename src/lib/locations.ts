// ── Shelf locations keep ONE spelling (owner, 2026-10-13) ───────────────────
//
// Store / floor / rack names are typed by hand. "Sakura Yard", "Sakura yard"
// and "Sakura Yard " were three stores to every filter and to the count
// coverage list. Every server path that saves a location goes through here:
// spaces trimmed and collapsed, and when the vendor already uses the same
// name in another case, the existing spelling is kept.

export const LOC_COLS = ['loc_store', 'loc_floor', 'loc_sub1', 'loc_sub2'] as const
type LocCol = typeof LOC_COLS[number]

export function tidyLocation(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ')
  return s || null
}

// ilike treats % _ and \ as pattern characters — escape them to match literally
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, c => '\\' + c)

/**
 * Returns a function that canonicalises the location fields present on a row.
 * One instance per request: lookups are cached, so a bulk import asks the
 * database once per distinct name, not once per row.
 */
export function locationCanonicalizer(admin: any, vendorId: string) {
  const cache = new Map<string, string>()
  async function canonical(col: LocCol, raw: unknown): Promise<string | null> {
    const v = tidyLocation(raw)
    if (!v) return null
    const key = col + '\u0000' + v.toLowerCase()
    const hit = cache.get(key)
    if (hit) return hit
    const { data, error } = await admin.from('products').select(col)
      .eq('vendor_id', vendorId).ilike(col, likeLiteral(v)).limit(1)
    const existing = !error && data?.[0]?.[col] ? tidyLocation(data[0][col]) : null
    const out = existing || v
    cache.set(key, out)
    return out
  }
  return async function apply<T extends Record<string, any>>(row: T): Promise<T> {
    const out: Record<string, any> = { ...row }
    for (const col of LOC_COLS) if (col in out) out[col] = await canonical(col, out[col])
    return out as T
  }
}
