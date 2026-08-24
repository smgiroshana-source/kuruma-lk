// Effective-dated tax rates and VAT period locks — shared by every route that
// mints a tax document or computes a period's liability.
//
// Rates: tax_rate_history holds (key, value, effective_from). The rate for a
// date is the newest row not after it; tax_config remains the fallback so the
// system keeps working even before the history table is migrated/seeded.
//
// Locks: a locked month accepts no new tax documents dated into it. The
// documents this system creates are always dated NOW, so the guard reduces
// to "is the current Colombo month locked" — which happens when the owner
// locks a month early by mistake, and the error says exactly that.

export type RateHistory = Record<string, { value: number; effective_from: string }[]>

const RATE_KEYS = ['vat_rate', 'sscl_rate', 'liable_base_part', 'liable_base_svc']

export async function loadRateHistory(admin: any, vendorId: string): Promise<RateHistory> {
  const hist: RateHistory = {}
  const { data: rows } = await admin.from('tax_rate_history')
    .select('key, value, effective_from')
    .eq('vendor_id', vendorId).in('key', RATE_KEYS)
    .order('effective_from', { ascending: false })
  for (const r of (rows || [])) {
    if (!hist[r.key]) hist[r.key] = []
    hist[r.key].push({ value: parseFloat(r.value), effective_from: r.effective_from })
  }
  // Fallback: flat config (also covers a not-yet-migrated database)
  const { data: cfg } = await admin.from('tax_config')
    .select('key, value').eq('vendor_id', vendorId).in('key', RATE_KEYS)
  for (const c of (cfg || [])) {
    if (!hist[c.key] || hist[c.key].length === 0) {
      hist[c.key] = [{ value: parseFloat(c.value), effective_from: '2000-01-01' }]
    }
  }
  return hist
}

/** Rate in force on `date` (YYYY-MM-DD or YYYY-MM, month treated as its end). */
export function rateAsOf(hist: RateHistory, key: string, date: string, fallback: number): number {
  const d = /^\d{4}-\d{2}$/.test(date) ? date + '-31' : date
  for (const row of (hist[key] || [])) {
    if (row.effective_from <= d) return row.value
  }
  return fallback
}

export async function isPeriodLocked(admin: any, vendorId: string, period: string): Promise<boolean> {
  const { data } = await admin.from('vat_period_locks')
    .select('id').eq('vendor_id', vendorId).eq('period', period).maybeSingle()
  return !!data
}

export function colomboMonthNow(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' }).slice(0, 7)
}

/** Guard for anything about to mint a tax document dated now. Returns an error
 *  message when blocked, null when clear. */
export async function lockedNowMessage(admin: any, vendorId: string): Promise<string | null> {
  const now = colomboMonthNow()
  if (await isPeriodLocked(admin, vendorId, now)) {
    return `The current period ${now} is locked (VAT return filed). Unlock it in Tax → Period locks before issuing tax documents, or check the lock was not set by mistake.`
  }
  return null
}
