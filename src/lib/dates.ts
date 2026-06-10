// "Today" in Asia/Colombo as YYYY-MM-DD. new Date().toISOString() is UTC,
// which is yesterday's date in Sri Lanka between 00:00 and 05:30 local time.
export function colomboToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Colombo' })
}
