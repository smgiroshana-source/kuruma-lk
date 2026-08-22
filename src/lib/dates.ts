// "Today" in Asia/Colombo as YYYY-MM-DD. new Date().toISOString() is UTC,
// which is yesterday's date in Sri Lanka between 00:00 and 05:30 local time.
export function colomboToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
}

/**
 * The Colombo calendar day a timestamp falls on, as YYYY-MM-DD.
 *
 * Anything that asks "did this happen on a later day than that?" has to
 * compare Colombo days — comparing raw instants against a UTC window makes the
 * answer depend on how wide the caller's fetch happened to be.
 */
export function colomboDayOf(ts: string | Date): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
}
